//! Tauri bridge for the isolated Lattice VNC engine.
//!
//! Mirrors the RDP bridge: one sidecar process per session, commands over its
//! stdin, frames and lifecycle events back over stdout. The password is
//! written once to the child's stdin and never placed in session state,
//! events, or logs.
//!
//! Classic VNC has no transport encryption of its own; the connect flow says
//! so instead of implying otherwise. Use it over trusted networks or an SSH
//! tunnel — which this app can provide.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt as _, AsyncWriteExt as _, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::Mutex as AsyncMutex;
use tokio::task::AbortHandle;
use tokio::time::timeout;

static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VncConnectRequest {
    pub profile_id: String,
    pub hostname: String,
    pub port: u16,
    /// One-time secret sent to the engine over stdin.
    pub password: String,
    #[serde(default)]
    pub use_saved_password: bool,
    #[serde(default)]
    pub remember_password: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VncSessionSummary {
    pub session_id: String,
    pub profile_id: String,
    pub host: String,
    pub port: u16,
    pub width: u16,
    pub height: u16,
    pub interactive: bool,
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "outcome",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum VncConnectOutcome {
    Connected {
        #[serde(flatten)]
        session: VncSessionSummary,
    },
    AuthFailed,
    Failed {
        stage: &'static str,
        detail: String,
    },
}

/// Input the interface forwards into a session. Field names are the sidecar
/// protocol; the enum crosses IPC and stdin with the same shape.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum VncInputRequest {
    MouseMove { x: u16, y: u16 },
    MouseButton { button: u8, pressed: bool },
    Wheel { horizontal: bool, units: i16 },
    Key { keysym: u32, pressed: bool },
    ReleaseAll,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum EngineCommand {
    Connect {
        hostname: String,
        port: u16,
        password: String,
    },
    Close,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum EngineEvent {
    Connected {
        width: u16,
        height: u16,
    },
    Frame {
        frame_id: u64,
        width: u16,
        height: u16,
        mime_type: String,
        base64: String,
    },
    AuthFailed,
    Failed {
        stage: String,
        detail: String,
    },
    Closed {
        reason: String,
    },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VncFrameEvent {
    session_id: String,
    frame_id: u64,
    width: u16,
    height: u16,
    mime_type: String,
    base64: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VncClosedEvent {
    session_id: String,
    reason: String,
}

struct VncSessionRecord {
    summary: VncSessionSummary,
    stdin: AsyncMutex<ChildStdin>,
    abort: AbortHandle,
}

#[derive(Default)]
pub struct VncRegistry {
    sessions: Mutex<HashMap<String, Arc<VncSessionRecord>>>,
}

impl VncRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    fn insert(&self, record: Arc<VncSessionRecord>) -> Result<(), String> {
        self.sessions
            .lock()
            .map_err(|error| error.to_string())?
            .insert(record.summary.session_id.clone(), record);
        Ok(())
    }

    fn get(&self, session_id: &str) -> Result<Option<Arc<VncSessionRecord>>, String> {
        Ok(self
            .sessions
            .lock()
            .map_err(|error| error.to_string())?
            .get(session_id)
            .cloned())
    }

    fn remove(&self, session_id: &str) -> Result<Option<Arc<VncSessionRecord>>, String> {
        Ok(self
            .sessions
            .lock()
            .map_err(|error| error.to_string())?
            .remove(session_id))
    }

    pub fn list(&self) -> Vec<VncSessionSummary> {
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
    format!("vnc-{timestamp}-{sequence}")
}

fn executable_name() -> &'static str {
    if cfg!(windows) {
        "lattice-vnc-engine.exe"
    } else {
        "lattice-vnc-engine"
    }
}

fn engine_path() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("LATTICE_VNC_ENGINE") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
        return Err("LATTICE_VNC_ENGINE does not point to a file.".to_string());
    }

    let mut candidates = Vec::new();
    if let Ok(current) = std::env::current_exe() {
        if let Some(parent) = current.parent() {
            candidates.push(parent.join(executable_name()));
        }
    }
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    candidates.push(
        manifest
            .join("../crates/lattice-vnc/target/debug")
            .join(executable_name()),
    );
    candidates.push(
        manifest
            .join("../crates/lattice-vnc/target/release")
            .join(executable_name()),
    );

    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| {
            "VNC engine is not built. Run `npm run build:vnc` or set LATTICE_VNC_ENGINE."
                .to_string()
        })
}

fn failed(stage: &'static str, detail: impl Into<String>) -> VncConnectOutcome {
    VncConnectOutcome::Failed {
        stage,
        detail: detail.into(),
    }
}

async fn write_line<T: Serialize>(stdin: &mut ChildStdin, value: &T) -> Result<(), String> {
    let mut line = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    line.push(b'\n');
    stdin
        .write_all(&line)
        .await
        .map_err(|error| error.to_string())?;
    stdin.flush().await.map_err(|error| error.to_string())
}

async fn read_event(
    lines: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
) -> Result<Option<EngineEvent>, String> {
    let Some(line) = lines.next_line().await.map_err(|error| error.to_string())? else {
        return Ok(None);
    };
    serde_json::from_str(&line)
        .map(Some)
        .map_err(|error| error.to_string())
}

fn spawn_engine() -> Result<(Child, ChildStdin, tokio::process::ChildStdout), String> {
    let path = engine_path()?;
    let mut child = Command::new(path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| error.to_string())?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "The VNC engine stdin is unavailable.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "The VNC engine stdout is unavailable.".to_string())?;
    Ok((child, stdin, stdout))
}

pub async fn connect(
    app: AppHandle,
    registry: Arc<VncRegistry>,
    request: VncConnectRequest,
) -> VncConnectOutcome {
    if request.profile_id.trim().is_empty() || request.hostname.trim().is_empty() {
        return failed("connect", "The VNC target is incomplete.");
    }

    let (mut child, mut stdin, stdout) = match spawn_engine() {
        Ok(parts) => parts,
        Err(error) => return failed("engine", error),
    };
    let command = EngineCommand::Connect {
        hostname: request.hostname.clone(),
        port: request.port,
        password: request.password,
    };
    if let Err(error) = write_line(&mut stdin, &command).await {
        let _ = child.kill().await;
        return failed("engine", error);
    }

    let mut lines = BufReader::new(stdout).lines();
    let first = match timeout(Duration::from_secs(20), read_event(&mut lines)).await {
        Ok(Ok(Some(event))) => event,
        Ok(Ok(None)) => return failed("engine", "The VNC engine exited before connecting."),
        Ok(Err(error)) => return failed("engine", error),
        Err(_) => {
            let _ = child.kill().await;
            return failed(
                "connect",
                "The VNC server did not answer within 20 seconds.",
            );
        }
    };

    let (width, height) = match first {
        EngineEvent::Connected { width, height } => (width, height),
        EngineEvent::AuthFailed => {
            let _ = child.kill().await;
            return VncConnectOutcome::AuthFailed;
        }
        EngineEvent::Failed { stage: _, detail } => {
            let _ = child.kill().await;
            return failed("connect", detail);
        }
        EngineEvent::Closed { reason } => return failed("connect", reason),
        EngineEvent::Frame { .. } => {
            let _ = child.kill().await;
            return failed(
                "protocol",
                "The VNC engine sent a frame before it connected.",
            );
        }
    };

    let summary = VncSessionSummary {
        session_id: session_id(),
        profile_id: request.profile_id,
        host: request.hostname,
        port: request.port,
        width,
        height,
        interactive: true,
    };
    let task_summary = summary.clone();
    let task_registry = Arc::clone(&registry);
    let task_app = app.clone();
    let task = tokio::spawn(async move {
        let reason = loop {
            match read_event(&mut lines).await {
                Ok(Some(EngineEvent::Frame {
                    frame_id,
                    width,
                    height,
                    mime_type,
                    base64,
                })) => {
                    let _ = task_app.emit(
                        "vnc://frame",
                        VncFrameEvent {
                            session_id: task_summary.session_id.clone(),
                            frame_id,
                            width,
                            height,
                            mime_type,
                            base64,
                        },
                    );
                }
                Ok(Some(EngineEvent::Closed { reason })) => break reason,
                Ok(Some(EngineEvent::Failed { stage, detail })) => {
                    break format!("{stage}: {detail}")
                }
                Ok(Some(EngineEvent::Connected { .. })) => {}
                Ok(Some(EngineEvent::AuthFailed)) => {
                    break "The VNC server rejected the credentials.".to_string()
                }
                Ok(None) => break "The VNC engine exited.".to_string(),
                Err(error) => break error,
            }
        };
        let _ = child.wait().await;
        let _ = task_registry.remove(&task_summary.session_id);
        let _ = task_app.emit(
            "vnc://closed",
            VncClosedEvent {
                session_id: task_summary.session_id,
                reason,
            },
        );
    });
    let record = Arc::new(VncSessionRecord {
        summary: summary.clone(),
        stdin: AsyncMutex::new(stdin),
        abort: task.abort_handle(),
    });
    if let Err(error) = registry.insert(record) {
        task.abort();
        return failed("session", error);
    }
    VncConnectOutcome::Connected { session: summary }
}

pub async fn input(
    registry: &VncRegistry,
    session_id: &str,
    request: VncInputRequest,
) -> Result<(), String> {
    let record = registry
        .get(session_id)?
        .ok_or_else(|| "VNC session not found.".to_string())?;
    let mut stdin = record.stdin.lock().await;
    write_line(&mut stdin, &request).await
}

pub async fn disconnect(
    app: &AppHandle,
    registry: &VncRegistry,
    session_id: &str,
) -> Result<(), String> {
    if let Some(record) = registry.remove(session_id)? {
        let close_failed = {
            let mut stdin = record.stdin.lock().await;
            write_line(&mut stdin, &EngineCommand::Close).await.is_err()
        };
        if close_failed {
            record.abort.abort();
        }
        let _ = app.emit(
            "vnc://closed",
            VncClosedEvent {
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
    fn vnc_session_ids_are_distinct_and_namespaced() {
        let first = session_id();
        let second = session_id();
        assert!(first.starts_with("vnc-"));
        assert_ne!(first, second);
    }

    #[test]
    fn input_json_uses_the_sidecar_protocol_tag() {
        let encoded = serde_json::to_string(&VncInputRequest::Key {
            keysym: 0xFF0D,
            pressed: true,
        })
        .expect("serialize input");
        assert!(encoded.contains("\"kind\":\"key\""));
        assert!(encoded.contains("\"keysym\":65293"));
    }

    /// The interface reads these payloads by field name; pin the wire shape
    /// so a rename never silently strands the frontend.
    #[test]
    fn connect_outcomes_use_the_field_names_the_interface_reads() {
        let connected = serde_json::to_value(VncConnectOutcome::Connected {
            session: VncSessionSummary {
                session_id: "vnc-1".into(),
                profile_id: "profile-1".into(),
                host: "vnc.test".into(),
                port: 5901,
                width: 1280,
                height: 1024,
                interactive: true,
            },
        })
        .expect("serialize outcome");
        assert_eq!(connected["outcome"], "connected");
        assert_eq!(connected["sessionId"], "vnc-1");
        assert_eq!(connected["profileId"], "profile-1");

        let auth = serde_json::to_value(VncConnectOutcome::AuthFailed).unwrap();
        assert_eq!(auth["outcome"], "authFailed");
    }
}
