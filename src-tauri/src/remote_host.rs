//! Lifecycle bridge for the bundled Lattice Remote Agent.
//!
//! Hosting is always user-initiated. The generated pairing code lives only in
//! this process and the WebView state; it is never written to disk or logs.

use serde::{Deserialize, Serialize};
use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt as _, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex as AsyncMutex;
use tokio::time::timeout;

static NEXT_HOST: AtomicU64 = AtomicU64::new(1);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHostStartRequest {
    pub bind_address: String,
    pub port: u16,
    pub fps: u32,
    /// When true, the paired viewer may control this machine's mouse and
    /// keyboard. Defaults to false so an unset field stays view-only.
    #[serde(default)]
    pub allow_input: bool,
    /// File access is independently authorised from keyboard/mouse control.
    #[serde(default)]
    pub allow_files: bool,
    /// Empty means the current user's home folder when file sharing is enabled.
    #[serde(default)]
    pub file_root: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHostStatus {
    pub host_id: String,
    pub address: String,
    pub pairing_code: String,
    pub expires_at: u64,
    pub view_only: bool,
    pub file_transfer: bool,
    pub file_root: Option<String>,
    pub state: &'static str,
    pub peer: Option<String>,
    pub attempts_remaining: u32,
}

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum AgentEvent {
    Ready {
        address: String,
        pairing_code: String,
        expires_in_seconds: u64,
        view_only: bool,
        file_transfer: bool,
        file_root: Option<String>,
    },
    PairingRequest {
        peer: String,
    },
    PairingRejected {
        attempts_remaining: u32,
    },
    Paired {
        peer: String,
    },
    Failed {
        stage: String,
        detail: String,
    },
    Stopped {
        reason: String,
    },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteHostClosedEvent {
    host_id: String,
    reason: String,
}

struct RemoteHostRecord {
    status: Mutex<RemoteHostStatus>,
    child: AsyncMutex<Child>,
}

#[derive(Default)]
pub struct RemoteHostRegistry {
    current: Mutex<Option<Arc<RemoteHostRecord>>>,
    start_lock: AsyncMutex<()>,
}

impl RemoteHostRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    fn current(&self) -> Result<Option<Arc<RemoteHostRecord>>, String> {
        Ok(self
            .current
            .lock()
            .map_err(|error| error.to_string())?
            .clone())
    }

    fn insert(&self, record: Arc<RemoteHostRecord>) -> Result<(), String> {
        *self.current.lock().map_err(|error| error.to_string())? = Some(record);
        Ok(())
    }

    fn take(&self) -> Result<Option<Arc<RemoteHostRecord>>, String> {
        Ok(self
            .current
            .lock()
            .map_err(|error| error.to_string())?
            .take())
    }

    fn remove_if(&self, host_id: &str) -> Result<bool, String> {
        let mut current = self.current.lock().map_err(|error| error.to_string())?;
        let matches = current
            .as_ref()
            .and_then(|record| record.status.lock().ok())
            .map(|status| status.host_id == host_id)
            .unwrap_or(false);
        if matches {
            current.take();
        }
        Ok(matches)
    }

    pub fn status(&self) -> Result<Option<RemoteHostStatus>, String> {
        self.current()?
            .map(|record| {
                record
                    .status
                    .lock()
                    .map(|status| status.clone())
                    .map_err(|error| error.to_string())
            })
            .transpose()
    }
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn host_id() -> String {
    let sequence = NEXT_HOST.fetch_add(1, Ordering::Relaxed);
    format!("host-{}-{sequence}", now_seconds())
}

fn executable_name() -> &'static str {
    if cfg!(windows) {
        "lattice-agent.exe"
    } else {
        "lattice-agent"
    }
}

fn agent_path() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("LATTICE_REMOTE_AGENT") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
        return Err("LATTICE_REMOTE_AGENT does not point to a file.".to_string());
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
            .join("../crates/lattice-remote/target/debug")
            .join(executable_name()),
    );
    candidates.push(
        manifest
            .join("../crates/lattice-remote/target/release")
            .join(executable_name()),
    );

    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| {
            "Lattice Remote Agent is not built. Run `npm run build:remote` or set LATTICE_REMOTE_AGENT."
                .to_string()
        })
}

fn bind_target(request: &RemoteHostStartRequest) -> Result<SocketAddr, String> {
    let address: IpAddr = request
        .bind_address
        .trim()
        .parse()
        .map_err(|_| "The bind address must be an IP address.".to_string())?;
    if address.is_unspecified() || address.is_multicast() {
        return Err("Choose a specific loopback or network interface address.".to_string());
    }
    if request.port == 0 {
        return Err("The host port must be between 1 and 65535.".to_string());
    }
    if !(1..=10).contains(&request.fps) {
        return Err("Frame rate must be between 1 and 10 FPS.".to_string());
    }
    Ok(SocketAddr::new(address, request.port))
}

fn spawn_agent(
    target: SocketAddr,
    fps: u32,
    allow_input: bool,
    file_root: Option<&Path>,
) -> Result<(Child, tokio::process::ChildStdout), String> {
    let mut command = Command::new(agent_path()?);
    command
        .arg("--json")
        .arg("--bind")
        .arg(target.to_string())
        .arg("--fps")
        .arg(fps.to_string());
    if allow_input {
        command.arg("--allow-input");
    }
    if let Some(file_root) = file_root {
        command.arg("--file-root").arg(file_root);
    }
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| error.to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "The Lattice Agent event stream is unavailable.".to_string())?;
    Ok((child, stdout))
}

fn parse_event(line: &str) -> Result<AgentEvent, String> {
    serde_json::from_str(line).map_err(|error| format!("Invalid Agent event: {error}"))
}

fn emit_status(app: &AppHandle, status: &RemoteHostStatus) {
    let _ = app.emit("remote-host://status", status.clone());
}

pub async fn start(
    app: AppHandle,
    registry: Arc<RemoteHostRegistry>,
    request: RemoteHostStartRequest,
) -> Result<RemoteHostStatus, String> {
    let _start_guard = registry.start_lock.lock().await;
    if registry.current()?.is_some() {
        return Err("This device is already sharing its display.".to_string());
    }

    let target = bind_target(&request)?;
    let file_root = if request.allow_files {
        let requested = request.file_root.trim();
        let path = if requested.is_empty() {
            app.path()
                .home_dir()
                .map_err(|error| format!("Cannot locate the home folder: {error}"))?
        } else {
            PathBuf::from(requested)
        };
        let canonical = std::fs::canonicalize(&path)
            .map_err(|error| format!("Cannot open the shared folder: {error}"))?;
        if !canonical.is_dir() {
            return Err("The shared file root must be a folder.".to_string());
        }
        Some(canonical)
    } else {
        None
    };
    let (mut child, stdout) = spawn_agent(
        target,
        request.fps,
        request.allow_input,
        file_root.as_deref(),
    )?;
    let mut lines = BufReader::new(stdout).lines();
    let first = match timeout(Duration::from_secs(12), lines.next_line()).await {
        Ok(Ok(Some(line))) => parse_event(&line),
        Ok(Ok(None)) => Err("The Lattice Agent exited before it was ready.".to_string()),
        Ok(Err(error)) => Err(error.to_string()),
        Err(_) => Err("The Lattice Agent did not become ready within 12 seconds.".to_string()),
    };

    let (address, pairing_code, expires_in_seconds, view_only, file_transfer, file_root) =
        match first {
            Ok(AgentEvent::Ready {
                address,
                pairing_code,
                expires_in_seconds,
                view_only,
                file_transfer,
                file_root,
            }) => (
                address,
                pairing_code,
                expires_in_seconds,
                view_only,
                file_transfer,
                file_root,
            ),
            Ok(AgentEvent::Failed { stage, detail }) => {
                let _ = child.kill().await;
                return Err(format!("{stage}: {detail}"));
            }
            Ok(_) => {
                let _ = child.kill().await;
                return Err("The Lattice Agent did not report a ready event first.".to_string());
            }
            Err(error) => {
                let _ = child.kill().await;
                return Err(error);
            }
        };

    let status = RemoteHostStatus {
        host_id: host_id(),
        address,
        pairing_code,
        expires_at: now_seconds().saturating_add(expires_in_seconds),
        view_only,
        file_transfer,
        file_root,
        state: "waiting",
        peer: None,
        attempts_remaining: 5,
    };
    let record = Arc::new(RemoteHostRecord {
        status: Mutex::new(status.clone()),
        child: AsyncMutex::new(child),
    });
    registry.insert(Arc::clone(&record))?;

    let watcher_app = app.clone();
    let watcher_registry = Arc::clone(&registry);
    let watcher_host_id = status.host_id.clone();
    tokio::spawn(async move {
        let mut reason = "The Lattice Agent exited.".to_string();
        loop {
            let line = match lines.next_line().await {
                Ok(Some(line)) => line,
                Ok(None) => break,
                Err(error) => {
                    reason = error.to_string();
                    break;
                }
            };
            match parse_event(&line) {
                Ok(AgentEvent::PairingRequest { peer }) => {
                    if let Ok(mut status) = record.status.lock() {
                        status.state = "pairing";
                        status.peer = Some(peer);
                        emit_status(&watcher_app, &status);
                    }
                }
                Ok(AgentEvent::PairingRejected { attempts_remaining }) => {
                    if let Ok(mut status) = record.status.lock() {
                        status.state = "waiting";
                        status.peer = None;
                        status.attempts_remaining = attempts_remaining;
                        emit_status(&watcher_app, &status);
                    }
                }
                Ok(AgentEvent::Paired { peer }) => {
                    if let Ok(mut status) = record.status.lock() {
                        status.state = "streaming";
                        status.peer = Some(peer);
                        status.pairing_code.clear();
                        emit_status(&watcher_app, &status);
                    }
                }
                Ok(AgentEvent::Failed { stage, detail }) => {
                    reason = format!("{stage}: {detail}");
                    break;
                }
                Ok(AgentEvent::Stopped {
                    reason: stopped_reason,
                }) => {
                    reason = stopped_reason;
                    break;
                }
                Ok(AgentEvent::Ready { .. }) => {
                    reason = "The Lattice Agent sent a second ready event.".to_string();
                    break;
                }
                Err(error) => {
                    reason = error;
                    break;
                }
            }
        }
        let mut child = record.child.lock().await;
        if !matches!(child.try_wait(), Ok(Some(_))) {
            let _ = child.kill().await;
        }
        drop(child);
        if watcher_registry
            .remove_if(&watcher_host_id)
            .unwrap_or(false)
        {
            let _ = watcher_app.emit(
                "remote-host://closed",
                RemoteHostClosedEvent {
                    host_id: watcher_host_id,
                    reason,
                },
            );
        }
    });

    Ok(status)
}

pub async fn stop(app: &AppHandle, registry: &RemoteHostRegistry) -> Result<(), String> {
    if let Some(record) = registry.take()? {
        let host_id = record
            .status
            .lock()
            .map_err(|error| error.to_string())?
            .host_id
            .clone();
        let _ = record.child.lock().await.kill().await;
        let _ = app.emit(
            "remote-host://closed",
            RemoteHostClosedEvent {
                host_id,
                reason: "Sharing was stopped on this device.".to_string(),
            },
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_specific_ipv4_and_ipv6_bind_addresses() {
        let ipv4 = bind_target(&RemoteHostStartRequest {
            bind_address: "192.168.1.20".to_string(),
            port: 44_900,
            fps: 5,
            allow_input: false,
            allow_files: false,
            file_root: String::new(),
        })
        .unwrap();
        assert_eq!(ipv4.to_string(), "192.168.1.20:44900");

        let ipv6 = bind_target(&RemoteHostStartRequest {
            bind_address: "::1".to_string(),
            port: 44_900,
            fps: 10,
            allow_input: true,
            allow_files: false,
            file_root: String::new(),
        })
        .unwrap();
        assert_eq!(ipv6.to_string(), "[::1]:44900");
    }

    #[test]
    fn refuses_broad_or_invalid_host_bindings() {
        for bind_address in ["0.0.0.0", "::", "example.com"] {
            assert!(bind_target(&RemoteHostStartRequest {
                bind_address: bind_address.to_string(),
                port: 44_900,
                fps: 5,
                allow_input: false,
                allow_files: false,
                file_root: String::new(),
            })
            .is_err());
        }
    }
}
