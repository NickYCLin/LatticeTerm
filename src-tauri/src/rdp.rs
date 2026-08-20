//! Tauri bridge for the isolated Lattice RDP engine.
//!
//! The password is written once to the child process stdin. It is never placed
//! in process arguments, session state, events, or logs.

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
pub struct RdpConnectRequest {
    pub profile_id: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    /// One-time secret sent to the engine over stdin.
    pub password: String,
    #[serde(default)]
    pub use_saved_password: bool,
    #[serde(default)]
    pub remember_password: bool,
    pub domain: Option<String>,
    pub width: u16,
    pub height: u16,
    pub trusted_certificate_sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpSessionSummary {
    pub session_id: String,
    pub profile_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub width: u16,
    pub height: u16,
    pub interactive: bool,
}

#[derive(Debug, Serialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub enum RdpConnectOutcome {
    Connected {
        #[serde(flatten)]
        session: RdpSessionSummary,
    },
    CertificateUnknown {
        fingerprint_sha256: String,
        detail: String,
    },
    Failed {
        stage: &'static str,
        detail: String,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RdpInputRequest {
    MouseMove { x: u16, y: u16 },
    MouseButton { button: u8, pressed: bool },
    Wheel { horizontal: bool, units: i16 },
    Key { scancode: u16, pressed: bool },
    Unicode { character: char, pressed: bool },
    ReleaseAll,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum EngineCommand {
    Connect {
        hostname: String,
        port: u16,
        username: String,
        password: String,
        domain: Option<String>,
        width: u16,
        height: u16,
        trusted_certificate_sha256: Option<String>,
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
    CertificateUnknown {
        fingerprint_sha256: String,
        detail: String,
    },
    Frame {
        frame_id: u64,
        width: u16,
        height: u16,
        mime_type: String,
        base64: String,
    },
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
struct RdpFrameEvent {
    session_id: String,
    frame_id: u64,
    width: u16,
    height: u16,
    mime_type: String,
    base64: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RdpClosedEvent {
    session_id: String,
    reason: String,
}

struct RdpSessionRecord {
    summary: RdpSessionSummary,
    stdin: AsyncMutex<ChildStdin>,
    abort: AbortHandle,
}

#[derive(Default)]
pub struct RdpRegistry {
    sessions: Mutex<HashMap<String, Arc<RdpSessionRecord>>>,
}

impl RdpRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    fn insert(&self, record: Arc<RdpSessionRecord>) -> Result<(), String> {
        self.sessions
            .lock()
            .map_err(|error| error.to_string())?
            .insert(record.summary.session_id.clone(), record);
        Ok(())
    }

    fn get(&self, session_id: &str) -> Result<Option<Arc<RdpSessionRecord>>, String> {
        Ok(self
            .sessions
            .lock()
            .map_err(|error| error.to_string())?
            .get(session_id)
            .cloned())
    }

    fn remove(&self, session_id: &str) -> Result<Option<Arc<RdpSessionRecord>>, String> {
        Ok(self
            .sessions
            .lock()
            .map_err(|error| error.to_string())?
            .remove(session_id))
    }

    pub fn list(&self) -> Vec<RdpSessionSummary> {
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
    format!("rdp-{timestamp}-{sequence}")
}

fn executable_name() -> &'static str {
    if cfg!(windows) {
        "lattice-rdp-engine.exe"
    } else {
        "lattice-rdp-engine"
    }
}

fn engine_path() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("LATTICE_RDP_ENGINE") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
        return Err("LATTICE_RDP_ENGINE does not point to a file.".to_string());
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
            .join("../crates/lattice-rdp/target/debug")
            .join(executable_name()),
    );
    candidates.push(
        manifest
            .join("../crates/lattice-rdp/target/release")
            .join(executable_name()),
    );

    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| {
            "RDP engine is not built. Run `npm run build:rdp` or set LATTICE_RDP_ENGINE."
                .to_string()
        })
}

fn failed(stage: &'static str, detail: impl Into<String>) -> RdpConnectOutcome {
    RdpConnectOutcome::Failed {
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
        .ok_or_else(|| "The RDP engine stdin is unavailable.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "The RDP engine stdout is unavailable.".to_string())?;
    Ok((child, stdin, stdout))
}

pub async fn connect(
    app: AppHandle,
    registry: Arc<RdpRegistry>,
    request: RdpConnectRequest,
) -> RdpConnectOutcome {
    if request.profile_id.trim().is_empty()
        || request.hostname.trim().is_empty()
        || request.username.trim().is_empty()
    {
        return failed("connect", "The RDP target or username is incomplete.");
    }

    let (mut child, mut stdin, stdout) = match spawn_engine() {
        Ok(parts) => parts,
        Err(error) => return failed("engine", error),
    };
    let command = EngineCommand::Connect {
        hostname: request.hostname.clone(),
        port: request.port,
        username: request.username.clone(),
        password: request.password,
        domain: request.domain,
        width: request.width.clamp(640, 1920),
        height: request.height.clamp(480, 1200),
        trusted_certificate_sha256: request.trusted_certificate_sha256,
    };
    if let Err(error) = write_line(&mut stdin, &command).await {
        let _ = child.kill().await;
        return failed("engine", error);
    }

    let mut lines = BufReader::new(stdout).lines();
    let first = match timeout(Duration::from_secs(20), read_event(&mut lines)).await {
        Ok(Ok(Some(event))) => event,
        Ok(Ok(None)) => return failed("engine", "The RDP engine exited before connecting."),
        Ok(Err(error)) => return failed("engine", error),
        Err(_) => {
            let _ = child.kill().await;
            return failed(
                "connect",
                "The RDP server did not answer within 20 seconds.",
            );
        }
    };

    let (width, height) = match first {
        EngineEvent::Connected { width, height } => (width, height),
        EngineEvent::CertificateUnknown {
            fingerprint_sha256,
            detail,
        } => {
            let _ = child.kill().await;
            return RdpConnectOutcome::CertificateUnknown {
                fingerprint_sha256,
                detail,
            };
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
                "The RDP engine sent a frame before it connected.",
            );
        }
    };

    let summary = RdpSessionSummary {
        session_id: session_id(),
        profile_id: request.profile_id,
        host: request.hostname,
        port: request.port,
        username: request.username,
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
                        "rdp://frame",
                        RdpFrameEvent {
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
                Ok(Some(EngineEvent::CertificateUnknown { detail, .. })) => break detail,
                Ok(None) => break "The RDP engine exited.".to_string(),
                Err(error) => break error,
            }
        };
        let _ = child.wait().await;
        let _ = task_registry.remove(&task_summary.session_id);
        let _ = task_app.emit(
            "rdp://closed",
            RdpClosedEvent {
                session_id: task_summary.session_id,
                reason,
            },
        );
    });
    let record = Arc::new(RdpSessionRecord {
        summary: summary.clone(),
        stdin: AsyncMutex::new(stdin),
        abort: task.abort_handle(),
    });
    if let Err(error) = registry.insert(record) {
        task.abort();
        return failed("session", error);
    }
    RdpConnectOutcome::Connected { session: summary }
}

pub async fn input(
    registry: &RdpRegistry,
    session_id: &str,
    request: RdpInputRequest,
) -> Result<(), String> {
    let record = registry
        .get(session_id)?
        .ok_or_else(|| "RDP session not found.".to_string())?;
    let mut stdin = record.stdin.lock().await;
    write_line(&mut stdin, &request).await
}

pub async fn disconnect(
    app: &AppHandle,
    registry: &RdpRegistry,
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
            "rdp://closed",
            RdpClosedEvent {
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
    fn rdp_session_ids_are_distinct_and_namespaced() {
        let first = session_id();
        let second = session_id();
        assert!(first.starts_with("rdp-"));
        assert_ne!(first, second);
    }

    #[test]
    fn input_json_uses_the_sidecar_protocol_tag() {
        let encoded = serde_json::to_string(&RdpInputRequest::MouseMove { x: 3, y: 4 })
            .expect("serialize input");
        assert!(encoded.contains("\"kind\":\"mouseMove\""));
    }
}
