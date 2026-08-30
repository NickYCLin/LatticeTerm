//! Tauri bridge for the isolated Lattice RDP engine.
//!
//! The password is written once to the child process stdin. It is never placed
//! in process arguments, session state, events, or logs.

use crate::sidecar::{
    boxed_sidecar_stdin, desktop_sidecar_admission, terminate_sidecar, wait_for_sidecar_exit,
    wait_for_stop, write_json_line_timeboxed, write_locked_json_line_timeboxed, BoxedSidecarStdin,
    SidecarCloseCancellationGuard, MAX_DESKTOP_SIDECARS, SIDECAR_COMMAND_TIMEOUT,
    SIDECAR_EXIT_TIMEOUT,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt as _, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{watch, Mutex as AsyncMutex, OwnedSemaphorePermit, Semaphore};
use tokio::time::{sleep, timeout};

static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);
static NEXT_GENERATION: AtomicU64 = AtomicU64::new(1);
static NEXT_RESERVATION: AtomicU64 = AtomicU64::new(1);

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
#[serde(
    tag = "outcome",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
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
    generation: u64,
    stdin: AsyncMutex<BoxedSidecarStdin>,
    stop: watch::Sender<bool>,
}

#[derive(Default)]
struct RdpRegistryState {
    sessions: HashMap<String, Arc<RdpSessionRecord>>,
    closing: HashMap<u64, watch::Sender<bool>>,
    pending: HashMap<u64, watch::Sender<bool>>,
    shutting_down: bool,
}

pub struct RdpRegistry {
    state: Mutex<RdpRegistryState>,
    admission: Arc<Semaphore>,
}

impl Default for RdpRegistry {
    fn default() -> Self {
        Self {
            state: Mutex::new(RdpRegistryState::default()),
            admission: desktop_sidecar_admission(),
        }
    }
}

pub(crate) struct RdpConnectReservation {
    registry: Arc<RdpRegistry>,
    token: u64,
    stop: watch::Sender<bool>,
    stop_receiver: Option<watch::Receiver<bool>>,
    permit: Option<OwnedSemaphorePermit>,
}

impl RdpConnectReservation {
    async fn stopped(&mut self) {
        if let Some(stop) = self.stop_receiver.as_mut() {
            wait_for_stop(stop).await;
        }
    }
}

impl Drop for RdpConnectReservation {
    fn drop(&mut self) {
        if self.permit.is_none() {
            return;
        }
        if let Ok(mut state) = self.registry.state.lock() {
            state.pending.remove(&self.token);
        }
    }
}

impl RdpRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub(crate) fn with_admission(admission: Arc<Semaphore>) -> Self {
        Self {
            state: Mutex::new(RdpRegistryState::default()),
            admission,
        }
    }

    pub(crate) fn reserve(self: &Arc<Self>) -> Result<RdpConnectReservation, String> {
        if self
            .state
            .lock()
            .map_err(|error| error.to_string())?
            .shutting_down
        {
            return Err("The RDP runtime is shutting down.".to_string());
        }
        let permit = Arc::clone(&self.admission)
            .try_acquire_owned()
            .map_err(|_| {
                format!(
                    "At most {MAX_DESKTOP_SIDECARS} RDP/VNC sessions can be connecting, connected, or closing at once."
                )
            })?;
        let token = NEXT_RESERVATION.fetch_add(1, Ordering::Relaxed);
        let (stop, stop_receiver) = watch::channel(false);
        let mut state = self.state.lock().map_err(|error| error.to_string())?;
        if state.shutting_down {
            return Err("The RDP runtime is shutting down.".to_string());
        }
        state.pending.insert(token, stop.clone());
        drop(state);
        Ok(RdpConnectReservation {
            registry: Arc::clone(self),
            token,
            stop,
            stop_receiver: Some(stop_receiver),
            permit: Some(permit),
        })
    }

    fn commit(
        &self,
        reservation: &mut RdpConnectReservation,
        record: Arc<RdpSessionRecord>,
    ) -> Result<(OwnedSemaphorePermit, watch::Receiver<bool>), String> {
        if !std::ptr::eq(self, Arc::as_ptr(&reservation.registry)) {
            return Err("The RDP reservation belongs to another registry.".to_string());
        }
        let mut state = self.state.lock().map_err(|error| error.to_string())?;
        if state.shutting_down {
            return Err("The RDP runtime is shutting down.".to_string());
        }
        if !state.pending.contains_key(&reservation.token) {
            return Err("The RDP connection reservation is no longer active.".to_string());
        }
        if state.sessions.contains_key(&record.summary.session_id) {
            return Err(format!(
                "RDP session '{}' is already registered.",
                record.summary.session_id
            ));
        }
        if reservation.permit.is_none() || reservation.stop_receiver.is_none() {
            return Err("The RDP connection reservation was already committed.".to_string());
        }

        let permit = reservation.permit.take().expect("permit checked above");
        let stop_receiver = reservation
            .stop_receiver
            .take()
            .expect("stop receiver checked above");
        state.pending.remove(&reservation.token);
        state
            .sessions
            .insert(record.summary.session_id.clone(), record);
        Ok((permit, stop_receiver))
    }

    fn get(&self, session_id: &str) -> Result<Option<Arc<RdpSessionRecord>>, String> {
        Ok(self
            .state
            .lock()
            .map_err(|error| error.to_string())?
            .sessions
            .get(session_id)
            .cloned())
    }

    fn begin_close(&self, session_id: &str) -> Result<Option<Arc<RdpSessionRecord>>, String> {
        let mut state = self.state.lock().map_err(|error| error.to_string())?;
        let Some(record) = state.sessions.remove(session_id) else {
            return Ok(None);
        };
        state.closing.insert(record.generation, record.stop.clone());
        Ok(Some(record))
    }

    fn begin_close_if_current(
        &self,
        session_id: &str,
        generation: u64,
    ) -> Result<Option<Arc<RdpSessionRecord>>, String> {
        let mut state = self.state.lock().map_err(|error| error.to_string())?;
        if state
            .sessions
            .get(session_id)
            .is_some_and(|record| record.generation == generation)
        {
            let record = state
                .sessions
                .remove(session_id)
                .expect("the current RDP record was checked above");
            state.closing.insert(record.generation, record.stop.clone());
            Ok(Some(record))
        } else {
            Ok(None)
        }
    }

    fn finish_worker(
        &self,
        session_id: &str,
        generation: u64,
    ) -> Result<Option<Arc<RdpSessionRecord>>, String> {
        let mut state = self.state.lock().map_err(|error| error.to_string())?;
        let record = if state
            .sessions
            .get(session_id)
            .is_some_and(|record| record.generation == generation)
        {
            state.sessions.remove(session_id)
        } else {
            None
        };
        state.closing.remove(&generation);
        Ok(record)
    }

    pub fn list(&self) -> Vec<RdpSessionSummary> {
        let Ok(state) = self.state.lock() else {
            return Vec::new();
        };
        let mut summaries: Vec<_> = state
            .sessions
            .values()
            .map(|record| record.summary.clone())
            .collect();
        summaries.sort_by(|left, right| left.session_id.cmp(&right.session_id));
        summaries
    }

    /// Permanently seals the registry and signals both handshakes and live
    /// workers. Commit and shutdown share one lock, so a connection cannot be
    /// published after the drain.
    pub fn stop_all(&self) {
        let (pending, closing, records) = match self.state.lock() {
            Ok(mut state) => {
                state.shutting_down = true;
                let pending: Vec<watch::Sender<bool>> =
                    state.pending.drain().map(|(_, stop)| stop).collect();
                let closing: Vec<watch::Sender<bool>> =
                    state.closing.drain().map(|(_, stop)| stop).collect();
                let records: Vec<Arc<RdpSessionRecord>> =
                    state.sessions.drain().map(|(_, record)| record).collect();
                (pending, closing, records)
            }
            Err(poisoned) => {
                let mut state = poisoned.into_inner();
                state.shutting_down = true;
                let pending: Vec<watch::Sender<bool>> =
                    state.pending.drain().map(|(_, stop)| stop).collect();
                let closing: Vec<watch::Sender<bool>> =
                    state.closing.drain().map(|(_, stop)| stop).collect();
                let records: Vec<Arc<RdpSessionRecord>> =
                    state.sessions.drain().map(|(_, record)| record).collect();
                (pending, closing, records)
            }
        };
        for stop in pending {
            let _ = stop.send(true);
        }
        for stop in closing {
            let _ = stop.send(true);
        }
        for record in records {
            let _ = record.stop.send(true);
        }
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

fn spawn_engine() -> Result<(Child, BoxedSidecarStdin, tokio::process::ChildStdout), String> {
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
    Ok((child, boxed_sidecar_stdin(stdin), stdout))
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

    let mut reservation = match registry.reserve() {
        Ok(reservation) => reservation,
        Err(error) => return failed("session", error),
    };

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
    let write_result = tokio::select! {
        biased;
        _ = reservation.stopped() => {
            terminate_sidecar(&mut child).await;
            return failed("session", "The RDP runtime stopped during connection setup.");
        }
        result = write_json_line_timeboxed(
            &mut *stdin,
            &command,
            SIDECAR_COMMAND_TIMEOUT,
            "The RDP engine stdin",
        ) => result,
    };
    if let Err(error) = write_result {
        terminate_sidecar(&mut child).await;
        return failed("engine", error);
    }

    let mut lines = BufReader::new(stdout).lines();
    let first_result = tokio::select! {
        biased;
        _ = reservation.stopped() => {
            terminate_sidecar(&mut child).await;
            return failed("session", "The RDP runtime stopped during connection setup.");
        }
        result = timeout(Duration::from_secs(20), read_event(&mut lines)) => result,
    };
    let first = match first_result {
        Ok(Ok(Some(event))) => event,
        Ok(Ok(None)) => {
            wait_for_sidecar_exit(&mut child).await;
            return failed("engine", "The RDP engine exited before connecting.");
        }
        Ok(Err(error)) => {
            terminate_sidecar(&mut child).await;
            return failed("engine", error);
        }
        Err(_) => {
            terminate_sidecar(&mut child).await;
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
            terminate_sidecar(&mut child).await;
            return RdpConnectOutcome::CertificateUnknown {
                fingerprint_sha256,
                detail,
            };
        }
        EngineEvent::Failed { stage: _, detail } => {
            terminate_sidecar(&mut child).await;
            return failed("connect", detail);
        }
        EngineEvent::Closed { reason } => {
            terminate_sidecar(&mut child).await;
            return failed("connect", reason);
        }
        EngineEvent::Frame { .. } => {
            terminate_sidecar(&mut child).await;
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
    let generation = NEXT_GENERATION.fetch_add(1, Ordering::Relaxed);
    let record = Arc::new(RdpSessionRecord {
        summary: summary.clone(),
        generation,
        stdin: AsyncMutex::new(stdin),
        stop: reservation.stop.clone(),
    });
    let (admission, mut stop_receiver) = match registry.commit(&mut reservation, record) {
        Ok(committed) => committed,
        Err(error) => {
            terminate_sidecar(&mut child).await;
            return failed("session", error);
        }
    };

    let task_summary = summary.clone();
    let task_registry = Arc::clone(&registry);
    let task_app = app.clone();
    tokio::spawn(async move {
        // The permit follows the actual worker through process reap, so rapid
        // connect/disconnect calls cannot bypass the cap.
        let _admission = admission;
        let mut reaped = false;
        let reason = loop {
            let event = tokio::select! {
                biased;
                _ = wait_for_stop(&mut stop_receiver) => None,
                event = read_event(&mut lines) => Some(event),
            };
            let Some(event) = event else {
                terminate_sidecar(&mut child).await;
                reaped = true;
                break "The RDP engine was stopped.".to_string();
            };
            match event {
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
        if !reaped {
            wait_for_sidecar_exit(&mut child).await;
        }
        if matches!(
            task_registry.finish_worker(&task_summary.session_id, generation),
            Ok(Some(_))
        ) {
            let _ = task_app.emit(
                "rdp://closed",
                RdpClosedEvent {
                    session_id: task_summary.session_id,
                    reason,
                },
            );
        }
    });
    RdpConnectOutcome::Connected { session: summary }
}

pub async fn input(
    app: &AppHandle,
    registry: &RdpRegistry,
    session_id: &str,
    request: RdpInputRequest,
) -> Result<(), String> {
    let record = registry
        .get(session_id)?
        .ok_or_else(|| "RDP session not found.".to_string())?;
    let result = write_locked_json_line_timeboxed(
        &record.stdin,
        &request,
        SIDECAR_COMMAND_TIMEOUT,
        "The RDP engine stdin",
    )
    .await;
    if let Err(error) = result {
        let removed = registry.begin_close_if_current(session_id, record.generation);
        let _ = record.stop.send(true);
        match removed {
            Ok(Some(_)) => {
                let _ = app.emit(
                    "rdp://closed",
                    RdpClosedEvent {
                        session_id: session_id.to_string(),
                        reason: format!("The RDP input channel failed: {error}"),
                    },
                );
            }
            Ok(None) => {}
            Err(remove_error) => {
                return Err(format!(
                    "{error}; the failed RDP session could not be removed: {remove_error}"
                ));
            }
        }
        return Err(error);
    }
    Ok(())
}

pub async fn disconnect(
    app: &AppHandle,
    registry: &RdpRegistry,
    session_id: &str,
) -> Result<(), String> {
    if let Some(record) = registry.begin_close(session_id)? {
        let cancellation_guard = SidecarCloseCancellationGuard::new(record.stop.clone());
        let close_result = write_locked_json_line_timeboxed(
            &record.stdin,
            &EngineCommand::Close,
            SIDECAR_COMMAND_TIMEOUT,
            "The RDP engine stdin",
        )
        .await;
        if close_result.is_err() {
            let _ = record.stop.send(true);
        } else {
            let stop = record.stop.clone();
            tokio::spawn(async move {
                sleep(SIDECAR_EXIT_TIMEOUT).await;
                let _ = stop.send(true);
            });
        }
        cancellation_guard.disarm();
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

    fn test_record(
        session_id: &str,
        generation: u64,
        stop: watch::Sender<bool>,
    ) -> Arc<RdpSessionRecord> {
        Arc::new(RdpSessionRecord {
            summary: RdpSessionSummary {
                session_id: session_id.to_string(),
                profile_id: format!("profile-{session_id}"),
                host: "rdp.test".to_string(),
                port: 3389,
                username: "tester".to_string(),
                width: 1280,
                height: 720,
                interactive: true,
            },
            generation,
            stdin: AsyncMutex::new(Box::new(tokio::io::sink())),
            stop,
        })
    }

    #[test]
    fn rdp_session_ids_are_distinct_and_namespaced() {
        let first = session_id();
        let second = session_id();
        assert!(first.starts_with("rdp-"));
        assert_ne!(first, second);
    }

    /// The interface reads these payloads by field name, and a mismatch
    /// fails silently: a certificate fingerprint that arrives as
    /// `fingerprint_sha256` is simply `undefined` to the dialog, which then
    /// offers to trust an empty fingerprint forever. Pin the wire shape.
    #[test]
    fn connect_outcomes_use_the_field_names_the_interface_reads() {
        let unknown = serde_json::to_value(RdpConnectOutcome::CertificateUnknown {
            fingerprint_sha256: "AA:BB".into(),
            detail: "self-signed".into(),
        })
        .expect("serialize outcome");

        assert_eq!(unknown["outcome"], "certificateUnknown");
        assert_eq!(unknown["fingerprintSha256"], "AA:BB");
        assert!(unknown.get("fingerprint_sha256").is_none());

        let failed = serde_json::to_value(RdpConnectOutcome::Failed {
            stage: "connect",
            detail: "refused".into(),
        })
        .expect("serialize outcome");
        assert_eq!(failed["outcome"], "failed");
        assert_eq!(failed["stage"], "connect");
    }

    #[test]
    fn input_json_uses_the_sidecar_protocol_tag() {
        let encoded = serde_json::to_string(&RdpInputRequest::MouseMove { x: 3, y: 4 })
            .expect("serialize input");
        assert!(encoded.contains("\"kind\":\"mouseMove\""));
    }

    #[test]
    fn admission_caps_connecting_and_connected_sidecars() {
        let registry = Arc::new(RdpRegistry::new());
        let reservations: Vec<_> = (0..MAX_DESKTOP_SIDECARS)
            .map(|_| registry.reserve().expect("admission slot"))
            .collect();
        let error = registry.reserve().err().expect("the cap rejects overflow");
        assert!(error.contains("At most 8"));
        assert_eq!(
            registry.state.lock().unwrap().pending.len(),
            MAX_DESKTOP_SIDECARS
        );

        drop(reservations);
        assert!(registry.state.lock().unwrap().pending.is_empty());
        assert_eq!(registry.admission.available_permits(), MAX_DESKTOP_SIDECARS);
    }

    #[test]
    fn rdp_and_vnc_share_one_global_sidecar_cap() {
        let shared = Arc::new(Semaphore::new(MAX_DESKTOP_SIDECARS));
        let rdp = Arc::new(RdpRegistry::with_admission(Arc::clone(&shared)));
        let vnc = Arc::new(crate::vnc::VncRegistry::with_admission(Arc::clone(&shared)));
        let vnc_reservations: Vec<_> = (0..crate::sidecar::MAX_VNC_SIDECARS)
            .map(|_| vnc.reserve().expect("VNC shared admission slot"))
            .collect();
        let rdp_reservations: Vec<_> = (crate::sidecar::MAX_VNC_SIDECARS..MAX_DESKTOP_SIDECARS)
            .map(|_| rdp.reserve().expect("RDP shared admission slot"))
            .collect();

        assert_eq!(shared.available_permits(), 0);
        assert!(rdp.reserve().is_err());
        assert!(vnc.reserve().is_err());

        drop(vnc_reservations);
        drop(rdp_reservations);
        assert_eq!(shared.available_permits(), MAX_DESKTOP_SIDECARS);
    }

    #[tokio::test]
    async fn registry_rejects_collisions_and_shutdown_signals_pending_and_live_workers() {
        let registry = Arc::new(RdpRegistry::new());
        let mut first = registry.reserve().unwrap();
        let first_record = test_record("rdp-collision", 1, first.stop.clone());
        let (_first_permit, mut first_stop) = registry.commit(&mut first, first_record).unwrap();

        let mut duplicate = registry.reserve().unwrap();
        let duplicate_record = test_record("rdp-collision", 2, duplicate.stop.clone());
        let error = match registry.commit(&mut duplicate, duplicate_record) {
            Ok(_) => panic!("a duplicate session id must be rejected"),
            Err(error) => error,
        };
        assert!(error.contains("already registered"));
        assert_eq!(registry.list().len(), 1);

        let closing_record = registry.begin_close("rdp-collision").unwrap().unwrap();
        assert_eq!(registry.state.lock().unwrap().closing.len(), 1);
        registry.stop_all();
        assert!(registry.list().is_empty());
        first_stop.changed().await.unwrap();
        assert!(*first_stop.borrow());
        drop(closing_record);
        duplicate.stopped().await;
        assert!(*duplicate.stop_receiver.as_ref().unwrap().borrow());
        assert!(registry.reserve().err().unwrap().contains("shutting down"));
    }

    #[test]
    fn removing_a_record_does_not_release_the_worker_admission_early() {
        let shared = Arc::new(Semaphore::new(1));
        let registry = Arc::new(RdpRegistry::with_admission(Arc::clone(&shared)));
        let mut reservation = registry.reserve().unwrap();
        let record = test_record("rdp-worker", 7, reservation.stop.clone());
        let (worker_permit, _stop) = registry.commit(&mut reservation, record).unwrap();

        assert!(registry.begin_close("rdp-worker").unwrap().is_some());
        assert!(registry.reserve().is_err());
        drop(worker_permit);
        assert!(registry.reserve().is_ok());
    }

    #[test]
    fn generation_check_allows_only_one_close_owner() {
        let registry = Arc::new(RdpRegistry::new());
        let mut reservation = registry.reserve().unwrap();
        let record = test_record("rdp-owner", 11, reservation.stop.clone());
        let (_permit, _stop) = registry.commit(&mut reservation, record).unwrap();

        assert!(registry
            .begin_close_if_current("rdp-owner", 10)
            .unwrap()
            .is_none());
        assert!(registry
            .begin_close_if_current("rdp-owner", 11)
            .unwrap()
            .is_some());
        assert!(registry
            .begin_close_if_current("rdp-owner", 11)
            .unwrap()
            .is_none());
        assert_eq!(registry.state.lock().unwrap().closing.len(), 1);
        assert!(registry.finish_worker("rdp-owner", 11).unwrap().is_none());
        assert!(registry.state.lock().unwrap().closing.is_empty());
    }
}
