//! Tauri bridge for Lattice Remote.
//!
//! Pairing secrets cross IPC for one call and are never placed in the
//! registry. The registry retains only public session metadata, bounded writer
//! state, file-transfer progress, and an abort handle. Frames and files are
//! already encrypted on the wire before they reach here.

use crate::remote_files::{RemoteDirectory, RemoteFileTransfer, RemoteFilesClient};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use lattice_remote::relay::{
    dial, format_device_id, normalize_device_id, normalize_relay_endpoint, RelayError,
};
use lattice_remote::{
    normalize_pairing_code, FrameAssembler, PointerButton, RemoteHello, RemoteInput, RemoteMessage,
    SecureConnection, MAX_WHEEL_UNITS, PROTOCOL_VERSION,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::{mpsc, oneshot};
use tokio::task::AbortHandle;
use tokio::time::timeout;

static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);
const MAX_REMOTE_SESSIONS: usize = 32;
const REMOTE_TERMINAL_TAIL_BYTES: usize = 256 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteConnectRequest {
    pub profile_id: String,
    #[serde(default)]
    pub hostname: String,
    #[serde(default)]
    pub port: u16,
    /// One-time secret. Never copied into a session record or event.
    pub pairing_code: String,
    /// When set, the connection goes through a relay by nine-digit device ID
    /// instead of dialing hostname:port directly.
    #[serde(default)]
    pub device_id: String,
    #[serde(default)]
    pub relay_address: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSessionSummary {
    pub session_id: String,
    pub profile_id: String,
    pub host: String,
    pub port: u16,
    /// True when the session reached the host by device ID over a relay.
    pub via_relay: bool,
    pub agent_name: String,
    pub width: u32,
    pub height: u32,
    pub view_only: bool,
    pub file_transfer: bool,
    pub file_root_label: String,
    /// True when the agent shares a shell (headless host) instead of a display.
    pub terminal: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteTerminalSnapshot {
    pub session_id: String,
    pub start_offset: u64,
    pub end_offset: u64,
    pub base64: String,
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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteTerminalEvent {
    session_id: String,
    /// Absolute byte offset of the first byte in this chunk.
    offset: u64,
    /// Raw PTY bytes; base64 keeps multi-byte characters split across reads
    /// intact until the frontend decodes them.
    base64: String,
}

#[derive(Debug, Default)]
struct RemoteTerminalOutput {
    start_offset: u64,
    end_offset: u64,
    bytes: VecDeque<u8>,
}

impl RemoteTerminalOutput {
    fn append(&mut self, bytes: &[u8]) -> Result<u64, String> {
        let offset = self.end_offset;
        let chunk_len = u64::try_from(bytes.len())
            .map_err(|_| "The remote terminal chunk is too large.".to_string())?;
        let end_offset = self
            .end_offset
            .checked_add(chunk_len)
            .ok_or_else(|| "The remote terminal output offset overflowed.".to_string())?;
        self.end_offset = end_offset;
        self.bytes.extend(bytes.iter().copied());

        let overflow = self.bytes.len().saturating_sub(REMOTE_TERMINAL_TAIL_BYTES);
        if overflow > 0 {
            self.bytes.drain(..overflow);
        }
        // The retained length is capped at 256 KiB and therefore always fits.
        self.start_offset = self.end_offset - self.bytes.len() as u64;
        Ok(offset)
    }

    fn snapshot(&self, session_id: String) -> RemoteTerminalSnapshot {
        RemoteTerminalSnapshot {
            session_id,
            start_offset: self.start_offset,
            end_offset: self.end_offset,
            base64: BASE64.encode(self.bytes.iter().copied().collect::<Vec<_>>()),
        }
    }
}

struct RemoteReaderStart {
    sender: oneshot::Sender<()>,
}

struct RemoteReaderGate {
    receiver: oneshot::Receiver<()>,
}

fn remote_reader_start_gate() -> (RemoteReaderStart, RemoteReaderGate) {
    let (sender, receiver) = oneshot::channel();
    (RemoteReaderStart { sender }, RemoteReaderGate { receiver })
}

impl RemoteReaderStart {
    fn open(self) -> Result<(), ()> {
        self.sender.send(())
    }
}

impl RemoteReaderGate {
    async fn wait(self) -> Result<(), ()> {
        self.receiver.await.map_err(|_| ())
    }
}

struct RemoteSessionRecord {
    summary: RemoteSessionSummary,
    abort: AbortHandle,
    outbound: mpsc::Sender<RemoteMessage>,
    files: Option<Arc<RemoteFilesClient>>,
    terminal_output: Option<RemoteTerminalOutput>,
}

#[derive(Clone)]
struct RemoteSessionAccess {
    summary: RemoteSessionSummary,
    outbound: mpsc::Sender<RemoteMessage>,
    files: Option<Arc<RemoteFilesClient>>,
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
        outbound: mpsc::Sender<RemoteMessage>,
        files: Option<Arc<RemoteFilesClient>>,
    ) -> Result<(), String> {
        let mut sessions = self.sessions.lock().map_err(|error| error.to_string())?;
        if sessions.contains_key(&summary.session_id) {
            return Err(format!(
                "Lattice Remote session '{}' is already connected.",
                summary.session_id
            ));
        }
        if sessions.len() >= MAX_REMOTE_SESSIONS {
            return Err(format!(
                "At most {MAX_REMOTE_SESSIONS} Lattice Remote sessions can be connected at once."
            ));
        }

        let terminal_output = summary.terminal.then(RemoteTerminalOutput::default);
        sessions.insert(
            summary.session_id.clone(),
            RemoteSessionRecord {
                summary,
                abort,
                outbound,
                files,
                terminal_output,
            },
        );
        Ok(())
    }

    fn append_terminal(&self, session_id: &str, bytes: &[u8]) -> Result<u64, String> {
        let mut sessions = self.sessions.lock().map_err(|error| error.to_string())?;
        let record = sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("Lattice Remote session '{session_id}' is not connected."))?;
        let output = record.terminal_output.as_mut().ok_or_else(|| {
            "The Agent sent terminal data without advertising a terminal session.".to_string()
        })?;
        output.append(bytes)
    }

    fn access(&self, session_id: &str) -> Result<RemoteSessionAccess, String> {
        self.sessions
            .lock()
            .map_err(|error| error.to_string())?
            .get(session_id)
            .map(|record| RemoteSessionAccess {
                summary: record.summary.clone(),
                outbound: record.outbound.clone(),
                files: record.files.clone(),
            })
            .ok_or_else(|| format!("Lattice Remote session '{session_id}' is not connected."))
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

    pub fn terminal_snapshots(&self) -> Result<Vec<RemoteTerminalSnapshot>, String> {
        let sessions = self.sessions.lock().map_err(|error| error.to_string())?;
        let mut snapshots: Vec<_> = sessions
            .iter()
            .filter_map(|(session_id, record)| {
                record
                    .terminal_output
                    .as_ref()
                    .map(|output| output.snapshot(session_id.clone()))
            })
            .collect();
        snapshots.sort_by(|left, right| left.session_id.cmp(&right.session_id));
        Ok(snapshots)
    }

    pub fn transfers(&self) -> Vec<RemoteFileTransfer> {
        let Ok(sessions) = self.sessions.lock() else {
            return Vec::new();
        };
        let mut transfers: Vec<_> = sessions
            .values()
            .filter_map(|record| record.files.as_ref())
            .flat_map(|files| files.transfers())
            .collect();
        transfers.sort_by(|left, right| left.transfer_id.cmp(&right.transfer_id));
        transfers
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

struct RelayPinCandidate {
    path: PathBuf,
    device_id: String,
    static_key: Vec<u8>,
}

/// Waits for the first PSK-authenticated protocol message before committing a
/// relay device's TOFU pin. With Noise XXpsk3, the initiator can finish its
/// local handshake after sending message 3 even when the responder will reject
/// that message because the pairing code is wrong. The responder's encrypted
/// Hello is therefore the first proof available to the viewer that the peer
/// actually accepted the PSK.
async fn receive_authenticated_hello<S>(
    connection: &mut SecureConnection<S>,
    relay_pin: Option<RelayPinCandidate>,
) -> Result<RemoteHello, (&'static str, String)>
where
    S: AsyncRead + AsyncWrite + Unpin + Send,
{
    let hello = match timeout(Duration::from_secs(30), connection.receive()).await {
        Ok(Ok(RemoteMessage::Hello(hello))) => hello,
        Ok(Ok(_)) => {
            return Err((
                "protocol",
                "The Agent did not send its identity first.".to_string(),
            ))
        }
        Ok(Err(_)) => {
            return Err((
                "pairing",
                "The pairing code was rejected by the Agent.".to_string(),
            ))
        }
        Err(_) => {
            return Err((
                "protocol",
                "The Agent did not start screen sharing in time.".to_string(),
            ))
        }
    };
    if hello.protocol_version != PROTOCOL_VERSION {
        return Err((
            "protocol",
            "The Agent uses an incompatible protocol.".to_string(),
        ));
    }

    if let Some(candidate) = relay_pin {
        crate::remote_pins::verify_or_pin(
            &candidate.path,
            &candidate.device_id,
            &candidate.static_key,
        )
        .map_err(|detail| ("pinning", detail))?;
    }
    Ok(hello)
}

pub async fn connect(
    app: AppHandle,
    registry: Arc<RemoteRegistry>,
    request: RemoteConnectRequest,
) -> RemoteConnectOutcome {
    let device_id = if request.device_id.trim().is_empty() {
        None
    } else {
        match normalize_device_id(&request.device_id) {
            Ok(device_id) => Some(device_id),
            Err(error) => return failed("connect", error.to_string()),
        }
    };
    let via_relay = device_id.is_some();
    if request.profile_id.trim().is_empty() || (!via_relay && request.hostname.trim().is_empty()) {
        return failed("connect", "The connection target is incomplete.");
    }
    let pairing_code = match normalize_pairing_code(&request.pairing_code) {
        Ok(code) => code,
        Err(error) => return failed("pairing", error.to_string()),
    };

    let mut connection = if let Some(device_id) = &device_id {
        let relay_endpoint = match normalize_relay_endpoint(&request.relay_address) {
            Ok(endpoint) => endpoint,
            Err(error) => return failed("connect", error.to_string()),
        };
        let stream = match timeout(Duration::from_secs(15), dial(&relay_endpoint, device_id)).await
        {
            Ok(Ok((stream, _agent_name))) => stream,
            Ok(Err(RelayError::Rejected { detail, .. })) => return failed("connect", detail),
            Ok(Err(error)) => return failed("connect", error.to_string()),
            Err(_) => return failed("connect", "The relay did not answer within 15 seconds."),
        };
        match timeout(
            Duration::from_secs(12),
            SecureConnection::initiate(stream, &pairing_code),
        )
        .await
        {
            Ok(Ok(connection)) => connection,
            Ok(Err(error)) => return failed("pairing", error.to_string()),
            Err(_) => return failed("connect", "The Agent did not answer within 12 seconds."),
        }
    } else {
        match timeout(
            Duration::from_secs(12),
            SecureConnection::connect(request.hostname.as_str(), request.port, &pairing_code),
        )
        .await
        {
            Ok(Ok(connection)) => connection,
            Ok(Err(error)) => return failed("pairing", error.to_string()),
            Err(_) => return failed("connect", "The Agent did not answer within 12 seconds."),
        }
    };

    // Keep the presented relay identity in memory until an encrypted Hello
    // proves that the responder accepted the pairing code. In particular, do
    // not persist a first-use pin merely because the initiator produced Noise
    // handshake message 3.
    let relay_pin = if let Some(device_id) = &device_id {
        let Some(static_key) = connection.remote_static_key() else {
            return failed("pinning", "The Agent did not present an identity key.");
        };
        let pins_path = match app.path().app_data_dir() {
            Ok(base) => base.join(crate::remote_pins::PINS_FILE),
            Err(error) => {
                return failed(
                    "pinning",
                    format!("Cannot locate the app data folder: {error}"),
                )
            }
        };
        Some(RelayPinCandidate {
            path: pins_path,
            device_id: device_id.clone(),
            static_key,
        })
    } else {
        None
    };

    let hello = match receive_authenticated_hello(&mut connection, relay_pin).await {
        Ok(hello) => hello,
        Err((stage, detail)) => return failed(stage, detail),
    };

    let session = RemoteSessionSummary {
        session_id: session_id(),
        profile_id: request.profile_id,
        host: match &device_id {
            Some(device_id) => format_device_id(device_id),
            None => request.hostname,
        },
        port: request.port,
        via_relay,
        agent_name: hello.agent_name,
        width: hello.width,
        height: hello.height,
        view_only: hello.view_only,
        file_transfer: hello.file_transfer,
        file_root_label: hello.file_root_label,
        terminal: hello.terminal,
    };

    // Input and file requests share one bounded encrypted writer queue. File
    // access remains available to a view-only display session only when the
    // host advertised its independently authorised shared root.
    let (mut reader, mut writer_half) = connection.split();
    let (outbound, mut outbound_rx) = mpsc::channel::<RemoteMessage>(128);
    let writer = tokio::spawn(async move {
        while let Some(message) = outbound_rx.recv().await {
            if writer_half.send(&message).await.is_err() {
                break;
            }
        }
    });
    let files = session.file_transfer.then(|| {
        Arc::new(RemoteFilesClient::new(
            session.session_id.clone(),
            app.clone(),
            outbound.clone(),
        ))
    });

    let task_session_id = session.session_id.clone();
    let task_registry = Arc::clone(&registry);
    let task_app = app.clone();
    let task_files = files.clone();
    let writer_abort = writer.abort_handle();
    let (reader_start, reader_gate) = remote_reader_start_gate();
    let task = tokio::spawn(async move {
        if reader_gate.wait().await.is_err() {
            return;
        }
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
                Ok(RemoteMessage::TerminalData { bytes }) => {
                    let offset = match task_registry.append_terminal(&task_session_id, &bytes) {
                        Ok(offset) => offset,
                        Err(error) => break error,
                    };
                    let payload = RemoteTerminalEvent {
                        session_id: task_session_id.clone(),
                        offset,
                        base64: BASE64.encode(bytes),
                    };
                    if task_app.emit("remote://terminal-data", payload).is_err() {
                        break "The application window is no longer available.".to_string();
                    }
                }
                Ok(RemoteMessage::Input(_))
                | Ok(RemoteMessage::TerminalInput { .. })
                | Ok(RemoteMessage::TerminalResize { .. }) => {
                    break "The Agent echoed an input message.".to_string()
                }
                Ok(RemoteMessage::FileResponse(response)) => {
                    if let Some(files) = &task_files {
                        files.handle_response(response);
                    } else {
                        break "The Agent sent file data without advertising file sharing."
                            .to_string();
                    }
                }
                Ok(RemoteMessage::FileRequest(_)) => {
                    break "The Agent sent a viewer-only file request.".to_string()
                }
                Ok(RemoteMessage::Hello(_)) => {
                    break "The Agent sent a second identity message.".to_string()
                }
                Err(error) => break error.to_string(),
            }
        };
        writer_abort.abort();
        if let Some(files) = &task_files {
            files.close(&reason);
        }
        // Only the path that actually removes the live record owns the closed
        // event. A concurrent local disconnect removes first and emits its own
        // reason, so the reader must not send a later duplicate.
        if matches!(task_registry.remove(&task_session_id), Ok(Some(_))) {
            let _ = task_app.emit(
                "remote://closed",
                RemoteClosedEvent {
                    session_id: task_session_id,
                    reason,
                },
            );
        }
    });
    if let Err(error) = registry.insert(session.clone(), task.abort_handle(), outbound, files) {
        task.abort();
        writer.abort();
        return failed("session", error);
    }
    if reader_start.open().is_err() {
        let _ = registry.remove(&session.session_id);
        task.abort();
        writer.abort();
        return failed("session", "The remote reader could not be started.");
    }

    RemoteConnectOutcome::Connected { session }
}

/// Sends one viewer control action to an interactive session. A view-only
/// session (no input channel) or a closed session is a no-op — the frontend
/// already gates on `viewOnly`, so this stays quiet rather than erroring.
pub async fn input(
    registry: &RemoteRegistry,
    session_id: &str,
    request: RemoteInputRequest,
) -> Result<(), String> {
    let access = registry.access(session_id)?;
    if access.summary.view_only {
        return Ok(());
    }
    if let Some(input) = resolve_input(request) {
        access
            .outbound
            .send(RemoteMessage::Input(input))
            .await
            .map_err(|_| "The remote session is no longer connected.".to_string())?;
    }
    Ok(())
}

/// Sends viewer keystrokes to a terminal-mode session. Mirrors `input`'s
/// quiet handling of view-only sessions.
pub async fn terminal_input(
    registry: &RemoteRegistry,
    session_id: &str,
    data: String,
) -> Result<(), String> {
    let access = registry.access(session_id)?;
    if access.summary.view_only || !access.summary.terminal || data.is_empty() {
        return Ok(());
    }
    // A large paste must not exceed the protocol's per-message payload limit.
    for chunk in data.into_bytes().chunks(32 * 1024) {
        access
            .outbound
            .send(RemoteMessage::TerminalInput {
                bytes: chunk.to_vec(),
            })
            .await
            .map_err(|_| "The remote session is no longer connected.".to_string())?;
    }
    Ok(())
}

pub async fn terminal_resize(
    registry: &RemoteRegistry,
    session_id: &str,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let access = registry.access(session_id)?;
    if access.summary.view_only || !access.summary.terminal {
        return Ok(());
    }
    access
        .outbound
        .send(RemoteMessage::TerminalResize { cols, rows })
        .await
        .map_err(|_| "The remote session is no longer connected.".to_string())
}

fn file_access(registry: &RemoteRegistry, session_id: &str) -> Result<RemoteSessionAccess, String> {
    let access = registry.access(session_id)?;
    if access.files.is_none() {
        return Err("The remote host did not enable file sharing.".to_string());
    }
    Ok(access)
}

pub async fn file_list(
    registry: &RemoteRegistry,
    session_id: &str,
    path: String,
) -> Result<RemoteDirectory, String> {
    let access = file_access(registry, session_id)?;
    access
        .files
        .expect("file access checked")
        .list(&access.outbound, path)
        .await
}

pub async fn file_download_start(
    registry: &RemoteRegistry,
    session_id: &str,
    path: String,
) -> Result<RemoteFileTransfer, String> {
    let access = file_access(registry, session_id)?;
    access
        .files
        .expect("file access checked")
        .download_start(&access.outbound, path)
        .await
}

pub async fn file_upload_begin(
    registry: &RemoteRegistry,
    session_id: &str,
    parent: String,
    name: String,
    size: u64,
    overwrite: bool,
) -> Result<RemoteFileTransfer, String> {
    let access = file_access(registry, session_id)?;
    access
        .files
        .expect("file access checked")
        .upload_begin(&access.outbound, parent, name, size, overwrite)
        .await
}

pub async fn file_upload_chunk(
    registry: &RemoteRegistry,
    session_id: &str,
    transfer_id: &str,
    data: &str,
) -> Result<(), String> {
    let access = file_access(registry, session_id)?;
    access
        .files
        .expect("file access checked")
        .upload_chunk(&access.outbound, transfer_id, data)
        .await
}

pub async fn file_upload_finish(
    registry: &RemoteRegistry,
    session_id: &str,
    transfer_id: &str,
) -> Result<(), String> {
    let access = file_access(registry, session_id)?;
    access
        .files
        .expect("file access checked")
        .upload_finish(&access.outbound, transfer_id)
        .await
}

pub async fn file_transfer_cancel(
    registry: &RemoteRegistry,
    session_id: &str,
    transfer_id: &str,
) -> Result<(), String> {
    let access = file_access(registry, session_id)?;
    access
        .files
        .expect("file access checked")
        .cancel(&access.outbound, transfer_id)
        .await
}

pub fn file_transfer_dismiss(
    registry: &RemoteRegistry,
    session_id: &str,
    transfer_id: &str,
) -> Result<(), String> {
    let access = file_access(registry, session_id)?;
    access
        .files
        .expect("file access checked")
        .dismiss(transfer_id)
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

pub async fn disconnect(
    app: &AppHandle,
    registry: &RemoteRegistry,
    session_id: &str,
) -> Result<(), String> {
    if let Some(record) = registry.remove(session_id)? {
        if let Some(files) = &record.files {
            files.close("Disconnected by the local user.");
        }
        let _ = record
            .outbound
            .send(RemoteMessage::Close(
                "Disconnected by the local user.".to_string(),
            ))
            .await;
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
    use lattice_remote::relay::DeviceIdentity;
    use std::future::pending;
    use tokio::net::{TcpListener, TcpStream};
    use tokio::sync::Barrier;

    fn hello(protocol_version: u16) -> RemoteHello {
        RemoteHello {
            protocol_version,
            agent_name: "Test Agent".to_string(),
            width: 80,
            height: 24,
            view_only: true,
            file_transfer: false,
            file_root_label: String::new(),
            terminal: true,
        }
    }

    fn remote_summary(session_id: impl Into<String>, terminal: bool) -> RemoteSessionSummary {
        RemoteSessionSummary {
            session_id: session_id.into(),
            profile_id: "test-profile".to_string(),
            host: "test-host".to_string(),
            port: 443,
            via_relay: true,
            agent_name: "Test Agent".to_string(),
            width: 80,
            height: 24,
            view_only: false,
            file_transfer: false,
            file_root_label: String::new(),
            terminal,
        }
    }

    fn pin_candidate(path: PathBuf, connection: &SecureConnection<TcpStream>) -> RelayPinCandidate {
        RelayPinCandidate {
            path,
            device_id: "123456789".to_string(),
            static_key: connection
                .remote_static_key()
                .expect("the relay Agent presented its permanent identity"),
        }
    }

    #[test]
    fn session_ids_are_distinct_and_namespaced() {
        let first = session_id();
        let second = session_id();
        assert!(first.starts_with("remote-"));
        assert_ne!(first, second);
    }

    #[test]
    fn terminal_output_tracks_absolute_offsets_and_keeps_a_bounded_tail() {
        let mut output = RemoteTerminalOutput::default();
        assert_eq!(output.append(b"abc").unwrap(), 0);
        assert_eq!(output.append(b"def").unwrap(), 3);

        let snapshot = output.snapshot("remote-test".to_string());
        assert_eq!(snapshot.start_offset, 0);
        assert_eq!(snapshot.end_offset, 6);
        assert_eq!(BASE64.decode(snapshot.base64).unwrap(), b"abcdef");

        let mut output = RemoteTerminalOutput::default();
        let prefix = vec![b'x'; REMOTE_TERMINAL_TAIL_BYTES - 2];
        assert_eq!(output.append(&prefix).unwrap(), 0);
        assert_eq!(
            output.append(b"wxyz").unwrap(),
            u64::try_from(REMOTE_TERMINAL_TAIL_BYTES - 2).unwrap()
        );

        let snapshot = output.snapshot("remote-tail".to_string());
        assert_eq!(snapshot.start_offset, 2);
        assert_eq!(
            snapshot.end_offset,
            u64::try_from(REMOTE_TERMINAL_TAIL_BYTES + 2).unwrap()
        );
        let retained = BASE64.decode(snapshot.base64).unwrap();
        assert_eq!(retained.len(), REMOTE_TERMINAL_TAIL_BYTES);
        assert_eq!(&retained[retained.len() - 4..], b"wxyz");
    }

    #[test]
    fn terminal_output_rejects_offset_overflow_without_mutating_the_tail() {
        let mut output = RemoteTerminalOutput {
            start_offset: u64::MAX,
            end_offset: u64::MAX,
            bytes: VecDeque::new(),
        };

        assert!(output.append(b"x").is_err());
        assert_eq!(output.start_offset, u64::MAX);
        assert_eq!(output.end_offset, u64::MAX);
        assert!(output.bytes.is_empty());
    }

    #[test]
    fn terminal_event_and_snapshot_serialize_with_offsets() {
        let event = RemoteTerminalEvent {
            session_id: "remote-event".to_string(),
            offset: 42,
            base64: "YWJj".to_string(),
        };
        assert_eq!(
            serde_json::to_value(event).unwrap(),
            serde_json::json!({
                "sessionId": "remote-event",
                "offset": 42,
                "base64": "YWJj"
            })
        );

        let snapshot = RemoteTerminalSnapshot {
            session_id: "remote-snapshot".to_string(),
            start_offset: 40,
            end_offset: 43,
            base64: "YWJj".to_string(),
        };
        assert_eq!(
            serde_json::to_value(snapshot).unwrap(),
            serde_json::json!({
                "sessionId": "remote-snapshot",
                "startOffset": 40,
                "endOffset": 43,
                "base64": "YWJj"
            })
        );
    }

    #[tokio::test]
    async fn reader_waits_until_its_start_gate_opens() {
        let (start, gate) = remote_reader_start_gate();
        let passed = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let task_passed = Arc::clone(&passed);
        let waiter = tokio::spawn(async move {
            gate.wait().await.unwrap();
            task_passed.store(true, Ordering::SeqCst);
        });

        tokio::task::yield_now().await;
        assert!(!passed.load(Ordering::SeqCst));
        start.open().unwrap();
        waiter.await.unwrap();
        assert!(passed.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn registry_enforces_the_remote_session_limit_atomically() {
        let registry = Arc::new(RemoteRegistry::new());
        let attempts = MAX_REMOTE_SESSIONS + 16;
        let barrier = Arc::new(Barrier::new(attempts));
        let mut insertions = Vec::with_capacity(attempts);

        for index in 0..attempts {
            let registry = Arc::clone(&registry);
            let barrier = Arc::clone(&barrier);
            insertions.push(tokio::spawn(async move {
                let worker = tokio::spawn(pending::<()>());
                let (outbound, _outbound_rx) = mpsc::channel(1);
                barrier.wait().await;
                let result = registry.insert(
                    remote_summary(format!("remote-limit-{index}"), true),
                    worker.abort_handle(),
                    outbound,
                    None,
                );
                if result.is_err() {
                    worker.abort();
                }
                result
            }));
        }

        let mut connected = 0;
        let mut rejected = 0;
        for insertion in insertions {
            match insertion.await.unwrap() {
                Ok(()) => connected += 1,
                Err(error) => {
                    assert!(error.contains("At most 32"));
                    rejected += 1;
                }
            }
        }

        assert_eq!(connected, MAX_REMOTE_SESSIONS);
        assert_eq!(rejected, attempts - MAX_REMOTE_SESSIONS);
        assert_eq!(registry.list().len(), MAX_REMOTE_SESSIONS);

        for record in registry.sessions.lock().unwrap().values() {
            record.abort.abort();
        }
    }

    #[tokio::test]
    async fn removing_a_closed_session_drops_its_terminal_snapshot() {
        let registry = RemoteRegistry::new();
        let worker = tokio::spawn(pending::<()>());
        let (outbound, _outbound_rx) = mpsc::channel(1);
        registry
            .insert(
                remote_summary("remote-closed", true),
                worker.abort_handle(),
                outbound,
                None,
            )
            .unwrap();
        assert_eq!(
            registry.append_terminal("remote-closed", b"ready").unwrap(),
            0
        );
        assert_eq!(
            registry.terminal_snapshots().unwrap(),
            vec![RemoteTerminalSnapshot {
                session_id: "remote-closed".to_string(),
                start_offset: 0,
                end_offset: 5,
                base64: BASE64.encode(b"ready"),
            }]
        );

        let record = registry.remove("remote-closed").unwrap().unwrap();
        record.abort.abort();
        assert!(registry.terminal_snapshots().unwrap().is_empty());
        assert!(registry.append_terminal("remote-closed", b"late").is_err());
        worker.abort();
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

    #[tokio::test]
    async fn rejected_pairing_code_does_not_create_a_first_use_pin() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let identity = DeviceIdentity::generate().unwrap();
        let key = identity.noise_private_bytes().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            SecureConnection::accept_with_static_key(stream, "11112222", &key).await
        });

        let stream = TcpStream::connect(address).await.unwrap();
        let mut viewer = SecureConnection::initiate(stream, "33334444")
            .await
            .expect("the initiator finishes locally before PSK rejection is observed");
        assert!(server.await.unwrap().is_err());

        let directory = tempfile::tempdir().unwrap();
        let pins_path = directory.path().join(crate::remote_pins::PINS_FILE);
        let candidate = pin_candidate(pins_path.clone(), &viewer);
        let (stage, _) = receive_authenticated_hello(&mut viewer, Some(candidate))
            .await
            .unwrap_err();

        assert_eq!(stage, "pairing");
        assert!(!pins_path.exists());
    }

    #[tokio::test]
    async fn valid_authenticated_hello_commits_the_first_use_pin() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let identity = DeviceIdentity::generate().unwrap();
        let key = identity.noise_private_bytes().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut connection = SecureConnection::accept_with_static_key(stream, "12345678", &key)
                .await
                .unwrap();
            connection
                .send(&RemoteMessage::Hello(hello(PROTOCOL_VERSION)))
                .await
                .unwrap();
        });

        let stream = TcpStream::connect(address).await.unwrap();
        let mut viewer = SecureConnection::initiate(stream, "12345678")
            .await
            .unwrap();
        let directory = tempfile::tempdir().unwrap();
        let pins_path = directory.path().join(crate::remote_pins::PINS_FILE);
        let candidate = pin_candidate(pins_path.clone(), &viewer);
        let presented_key = candidate.static_key.clone();

        let received = receive_authenticated_hello(&mut viewer, Some(candidate))
            .await
            .unwrap();
        server.await.unwrap();

        assert_eq!(received, hello(PROTOCOL_VERSION));
        assert!(pins_path.exists());
        assert_eq!(
            crate::remote_pins::verify_or_pin(&pins_path, "123456789", &presented_key).unwrap(),
            crate::remote_pins::PinOutcome::Matched
        );
    }

    #[tokio::test]
    async fn incompatible_hello_does_not_create_a_first_use_pin() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let identity = DeviceIdentity::generate().unwrap();
        let key = identity.noise_private_bytes().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut connection = SecureConnection::accept_with_static_key(stream, "12345678", &key)
                .await
                .unwrap();
            connection
                .send(&RemoteMessage::Hello(hello(PROTOCOL_VERSION + 1)))
                .await
                .unwrap();
        });

        let stream = TcpStream::connect(address).await.unwrap();
        let mut viewer = SecureConnection::initiate(stream, "12345678")
            .await
            .unwrap();
        let directory = tempfile::tempdir().unwrap();
        let pins_path = directory.path().join(crate::remote_pins::PINS_FILE);
        let candidate = pin_candidate(pins_path.clone(), &viewer);

        let (stage, _) = receive_authenticated_hello(&mut viewer, Some(candidate))
            .await
            .unwrap_err();
        server.await.unwrap();

        assert_eq!(stage, "protocol");
        assert!(!pins_path.exists());
    }
}
