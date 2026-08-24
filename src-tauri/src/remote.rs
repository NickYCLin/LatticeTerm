//! Tauri bridge for Lattice Remote.
//!
//! Pairing secrets cross IPC for one call and are never placed in the
//! registry. The registry retains only public session metadata and an abort
//! handle. Frames are already encrypted on the wire before they reach here.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use lattice_remote::{
    normalize_pairing_code, FrameAssembler, PointerButton, RemoteInput, RemoteMessage,
    SecureConnection, MAX_WHEEL_UNITS, PROTOCOL_VERSION,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio::task::AbortHandle;
use tokio::time::timeout;

static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteConnectRequest {
    pub profile_id: String,
    pub hostname: String,
    pub port: u16,
    /// One-time secret. Never copied into a session record or event.
    pub pairing_code: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSessionSummary {
    pub session_id: String,
    pub profile_id: String,
    pub host: String,
    pub port: u16,
    pub agent_name: String,
    pub width: u32,
    pub height: u32,
    pub view_only: bool,
}

#[derive(Debug, Serialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub enum RemoteConnectOutcome {
    Connected {
        #[serde(flatten)]
        session: RemoteSessionSummary,
    },
    Failed {
        stage: &'static str,
        detail: String,
    },
}

/// One control action from the viewer. Mirrors the browser event shapes the
/// RDP/VNC panes already emit, so the same pointer/keyboard handlers apply.
#[derive(Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RemoteInputRequest {
    MouseMove {
        x: u16,
        y: u16,
    },
    /// Browser button numbers: 0 left, 1 middle, 2 right.
    MouseButton {
        button: u8,
        pressed: bool,
    },
    Wheel {
        horizontal: bool,
        units: i32,
    },
    Key {
        keysym: u32,
        pressed: bool,
    },
    ReleaseAll,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteFrameEvent {
    session_id: String,
    frame_id: u64,
    width: u32,
    height: u32,
    mime_type: &'static str,
    base64: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteClosedEvent {
    session_id: String,
    reason: String,
}

struct RemoteSessionRecord {
    summary: RemoteSessionSummary,
    abort: AbortHandle,
    /// Present only for interactive sessions; sending drives the writer task.
    input: Option<mpsc::UnboundedSender<RemoteInput>>,
}

#[derive(Default)]
pub struct RemoteRegistry {
    sessions: Mutex<HashMap<String, RemoteSessionRecord>>,
}

impl RemoteRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    fn insert(
        &self,
        summary: RemoteSessionSummary,
        abort: AbortHandle,
        input: Option<mpsc::UnboundedSender<RemoteInput>>,
    ) -> Result<(), String> {
        self.sessions
            .lock()
            .map_err(|error| error.to_string())?
            .insert(
                summary.session_id.clone(),
                RemoteSessionRecord {
                    summary,
                    abort,
                    input,
                },
            );
        Ok(())
    }

    /// Hands the input channel for a session to the caller, if it is
    /// interactive and still live. Cloning the sender keeps the lock brief.
    fn input_sender(
        &self,
        session_id: &str,
    ) -> Result<Option<mpsc::UnboundedSender<RemoteInput>>, String> {
        Ok(self
            .sessions
            .lock()
            .map_err(|error| error.to_string())?
            .get(session_id)
            .and_then(|record| record.input.clone()))
    }

    fn remove(&self, session_id: &str) -> Result<Option<RemoteSessionRecord>, String> {
        Ok(self
            .sessions
            .lock()
            .map_err(|error| error.to_string())?
            .remove(session_id))
    }

    pub fn list(&self) -> Vec<RemoteSessionSummary> {
        let Ok(sessions) = self.sessions.lock() else {
            return Vec::new();
        };
        let mut summaries: Vec<_> = sessions
            .values()
            .map(|record| record.summary.clone())
            .collect();
        summaries.sort_by(|left, right| left.session_id.cmp(&right.session_id));
        summaries
    }
}

fn session_id() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let sequence = NEXT_SESSION.fetch_add(1, Ordering::Relaxed);
    format!("remote-{timestamp}-{sequence}")
}

fn failed(stage: &'static str, detail: impl Into<String>) -> RemoteConnectOutcome {
    RemoteConnectOutcome::Failed {
        stage,
        detail: detail.into(),
    }
}

pub async fn connect(
    app: AppHandle,
    registry: Arc<RemoteRegistry>,
    request: RemoteConnectRequest,
) -> RemoteConnectOutcome {
    if request.profile_id.trim().is_empty() || request.hostname.trim().is_empty() {
        return failed("connect", "The connection target is incomplete.");
    }
    let pairing_code = match normalize_pairing_code(&request.pairing_code) {
        Ok(code) => code,
        Err(error) => return failed("pairing", error.to_string()),
    };

    let mut connection = match timeout(
        Duration::from_secs(12),
        SecureConnection::connect(&request.hostname, request.port, &pairing_code),
    )
    .await
    {
        Ok(Ok(connection)) => connection,
        Ok(Err(error)) => return failed("pairing", error.to_string()),
        Err(_) => return failed("connect", "The Agent did not answer within 12 seconds."),
    };

    // Waiting for the encrypted Hello proves the responder accepted the PSK.
    let hello = match timeout(Duration::from_secs(30), connection.receive()).await {
        Ok(Ok(RemoteMessage::Hello(hello))) => hello,
        Ok(Ok(_)) => return failed("protocol", "The Agent did not send its identity first."),
        Ok(Err(_)) => return failed("pairing", "The pairing code was rejected by the Agent."),
        Err(_) => {
            return failed(
                "protocol",
                "The Agent did not start screen sharing in time.",
            )
        }
    };
    if hello.protocol_version != PROTOCOL_VERSION {
        return failed("protocol", "The Agent uses an incompatible protocol.");
    }

    let session = RemoteSessionSummary {
        session_id: session_id(),
        profile_id: request.profile_id,
        host: request.hostname,
        port: request.port,
        agent_name: hello.agent_name,
        width: hello.width,
        height: hello.height,
        view_only: hello.view_only,
    };

    // Always split so the frame loop reads through one half. Interactive
    // sessions drive the write half from a channel; view-only sessions hold it
    // open (dropping it would half-close the socket and end the stream early).
    let (mut reader, writer_half) = connection.split();
    let (input, idle_writer) = if hello.view_only {
        (None, Some(writer_half))
    } else {
        let (tx, mut rx) = mpsc::unbounded_channel::<RemoteInput>();
        let mut writer_half = writer_half;
        tokio::spawn(async move {
            while let Some(input) = rx.recv().await {
                if writer_half
                    .send(&RemoteMessage::Input(input))
                    .await
                    .is_err()
                {
                    break;
                }
            }
        });
        (Some(tx), None)
    };

    let task_session_id = session.session_id.clone();
    let task_registry = Arc::clone(&registry);
    let task_app = app.clone();
    let task = tokio::spawn(async move {
        // Keep the write half alive for view-only sessions until the stream ends.
        let _idle_writer = idle_writer;
        let mut assembler = FrameAssembler::new();
        let reason = loop {
            match reader.receive().await {
                Ok(RemoteMessage::Close(reason)) => break reason,
                Ok(RemoteMessage::KeepAlive) => {}
                Ok(message @ RemoteMessage::FrameStart(_))
                | Ok(message @ RemoteMessage::FrameChunk { .. }) => match assembler.push(message) {
                    Ok(Some(frame)) => {
                        let payload = RemoteFrameEvent {
                            session_id: task_session_id.clone(),
                            frame_id: frame.frame_id,
                            width: frame.width,
                            height: frame.height,
                            mime_type: frame.format.mime_type(),
                            base64: BASE64.encode(frame.bytes),
                        };
                        if task_app.emit("remote://frame", payload).is_err() {
                            break "The application window is no longer available.".to_string();
                        }
                    }
                    Ok(None) => {}
                    Err(error) => break format!("Invalid frame stream: {error}"),
                },
                Ok(RemoteMessage::Input(_)) => {
                    break "The Agent echoed an input message.".to_string()
                }
                Ok(RemoteMessage::Hello(_)) => {
                    break "The Agent sent a second identity message.".to_string()
                }
                Err(error) => break error.to_string(),
            }
        };
        let _ = task_registry.remove(&task_session_id);
        let _ = task_app.emit(
            "remote://closed",
            RemoteClosedEvent {
                session_id: task_session_id,
                reason,
            },
        );
    });
    if let Err(error) = registry.insert(session.clone(), task.abort_handle(), input) {
        task.abort();
        return failed("session", error);
    }

    RemoteConnectOutcome::Connected { session }
}

/// Sends one viewer control action to an interactive session. A view-only
/// session (no input channel) or a closed session is a no-op — the frontend
/// already gates on `viewOnly`, so this stays quiet rather than erroring.
pub fn input(
    registry: &RemoteRegistry,
    session_id: &str,
    request: RemoteInputRequest,
) -> Result<(), String> {
    let Some(sender) = registry.input_sender(session_id)? else {
        return Ok(());
    };
    if let Some(input) = resolve_input(request) {
        let _ = sender.send(input);
    }
    Ok(())
}

/// Converts a browser-shaped request into a protocol input, dropping anything
/// the wire cannot carry (unknown button, zero-distance scroll).
fn resolve_input(request: RemoteInputRequest) -> Option<RemoteInput> {
    match request {
        RemoteInputRequest::MouseMove { x, y } => Some(RemoteInput::MouseMove { x, y }),
        RemoteInputRequest::MouseButton { button, pressed } => {
            let button = match button {
                0 => PointerButton::Left,
                1 => PointerButton::Middle,
                2 => PointerButton::Right,
                _ => return None,
            };
            Some(RemoteInput::MouseButton { button, pressed })
        }
        RemoteInputRequest::Wheel { horizontal, units } => {
            if units == 0 {
                return None;
            }
            let limit = i32::from(MAX_WHEEL_UNITS);
            let clamped = units.clamp(-limit, limit) as i8;
            Some(RemoteInput::Wheel {
                horizontal,
                units: clamped,
            })
        }
        RemoteInputRequest::Key { keysym, pressed } => Some(RemoteInput::Key { keysym, pressed }),
        RemoteInputRequest::ReleaseAll => Some(RemoteInput::ReleaseAll),
    }
}

pub fn disconnect(
    app: &AppHandle,
    registry: &RemoteRegistry,
    session_id: &str,
) -> Result<(), String> {
    if let Some(record) = registry.remove(session_id)? {
        record.abort.abort();
        let _ = app.emit(
            "remote://closed",
            RemoteClosedEvent {
                session_id: session_id.to_string(),
                reason: "Disconnected by the local user.".to_string(),
            },
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_ids_are_distinct_and_namespaced() {
        let first = session_id();
        let second = session_id();
        assert!(first.starts_with("remote-"));
        assert_ne!(first, second);
    }

    #[test]
    fn resolves_browser_inputs_and_drops_impossible_ones() {
        assert_eq!(
            resolve_input(RemoteInputRequest::MouseButton {
                button: 2,
                pressed: true
            }),
            Some(RemoteInput::MouseButton {
                button: PointerButton::Right,
                pressed: true
            })
        );
        assert_eq!(
            resolve_input(RemoteInputRequest::MouseButton {
                button: 9,
                pressed: true
            }),
            None
        );
        assert_eq!(
            resolve_input(RemoteInputRequest::Wheel {
                horizontal: false,
                units: 0
            }),
            None
        );
        // Runaway scroll deltas are clamped to the protocol's range.
        assert_eq!(
            resolve_input(RemoteInputRequest::Wheel {
                horizontal: false,
                units: 9_999
            }),
            Some(RemoteInput::Wheel {
                horizontal: false,
                units: MAX_WHEEL_UNITS
            })
        );
    }

    #[test]
    fn input_request_decodes_from_camel_case_wire() {
        let request: RemoteInputRequest =
            serde_json::from_str(r#"{"kind":"mouseMove","x":12,"y":34}"#).unwrap();
        assert!(matches!(
            request,
            RemoteInputRequest::MouseMove { x: 12, y: 34 }
        ));
        let release: RemoteInputRequest = serde_json::from_str(r#"{"kind":"releaseAll"}"#).unwrap();
        assert!(matches!(release, RemoteInputRequest::ReleaseAll));
    }
}
