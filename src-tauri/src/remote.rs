//! Tauri bridge for Lattice Remote.
//!
//! Pairing secrets cross IPC for one call and are never placed in the
//! registry. The registry retains only public session metadata and an abort
//! handle. Frames are already encrypted on the wire before they reach here.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use lattice_remote::{
    normalize_pairing_code, FrameAssembler, RemoteMessage, SecureConnection, PROTOCOL_VERSION,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
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
}

#[derive(Default)]
pub struct RemoteRegistry {
    sessions: Mutex<HashMap<String, RemoteSessionRecord>>,
}

impl RemoteRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    fn insert(&self, summary: RemoteSessionSummary, abort: AbortHandle) -> Result<(), String> {
        self.sessions
            .lock()
            .map_err(|error| error.to_string())?
            .insert(
                summary.session_id.clone(),
                RemoteSessionRecord { summary, abort },
            );
        Ok(())
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
    if hello.protocol_version != PROTOCOL_VERSION || !hello.view_only {
        return failed(
            "protocol",
            "The Agent uses an incompatible protocol or permission mode.",
        );
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
    let task_session_id = session.session_id.clone();
    let task_registry = Arc::clone(&registry);
    let task_app = app.clone();
    let task = tokio::spawn(async move {
        let mut assembler = FrameAssembler::new();
        let reason = loop {
            match connection.receive().await {
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
    if let Err(error) = registry.insert(session.clone(), task.abort_handle()) {
        task.abort();
        return failed("session", error);
    }

    RemoteConnectOutcome::Connected { session }
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
}
