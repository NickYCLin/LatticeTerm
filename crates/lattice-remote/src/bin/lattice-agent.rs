use image::{imageops::FilterType, DynamicImage};
use lattice_remote::relay::{
    format_device_id, normalize_relay_endpoint, read_server_message, write_client_message,
    DeviceIdentity, RelayClientMessage, RelayServerMessage,
};
use lattice_remote::{
    frame_messages, generate_pairing_code, host_files::HostUpload, host_files::SharedFiles,
    host_input::InputInjector, normalize_pairing_code, FrameFormat, RemoteFileRequest,
    RemoteFileResponse, RemoteHello, RemoteMessage, SecureConnection, SecureWriter, Transport,
    DEFAULT_PORT, FILE_CHUNK_SIZE, MAX_FILE_ERROR_BYTES, PROTOCOL_VERSION,
};
use serde::Serialize;
use std::collections::{hash_map::Entry, HashMap};
use std::env;
use std::io::{Cursor, Read as _, Write as _};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, watch};
use tokio::time::{sleep, timeout};
use xcap::Monitor;

const DEFAULT_FPS: u32 = 5;
const MAX_FPS: u32 = 10;
const MAX_WIDTH: u32 = 1280;
const MAX_HEIGHT: u32 = 720;
const MAX_PAIRING_FAILURES: u32 = 5;
const PAIRING_LIFETIME: Duration = Duration::from_secs(5 * 60);
const RELAY_PING_INTERVAL: Duration = Duration::from_secs(25);
const RELAY_RECONNECT_CAP: Duration = Duration::from_secs(60);
const REMOTE_SEND_TIMEOUT: Duration = Duration::from_secs(10);
const REMOTE_INPUT_ENQUEUE_TIMEOUT: Duration = Duration::from_secs(10);
// Preserve every key transition while bounding the amount of work an
// authorised but abusive viewer can queue ahead of the OS input backend.
const SCREEN_INPUT_QUEUE_CAPACITY: usize = 256;
// A terminal input chunk is at most 48 KiB, so 32 queued chunks cap the PTY
// writer backlog at roughly 1.5 MiB while still accommodating large pastes.
const TERMINAL_INPUT_QUEUE_CAPACITY: usize = 32;
#[cfg(unix)]
const TERMINAL_PROCESS_GROUP_GRACE: Duration = Duration::from_millis(100);
#[cfg(unix)]
const TERMINAL_PTY_POLL_INTERVAL_MS: libc::c_int = 50;
#[cfg(target_os = "linux")]
const TERMINAL_SESSION_KILL_ROUNDS: usize = 4;
#[cfg(target_os = "linux")]
const TERMINAL_SESSION_KILL_INTERVAL: Duration = Duration::from_millis(25);

#[derive(Clone)]
struct Options {
    bind: SocketAddr,
    pairing_code: String,
    fps: u32,
    json: bool,
    allow_input: bool,
    file_root: Option<PathBuf>,
    relay: Option<String>,
    identity_file: Option<PathBuf>,
    terminal: bool,
}

#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum AgentEvent<'a> {
    Ready {
        address: String,
        pairing_code: String,
        /// Zero means the code does not expire while sharing stays on.
        expires_in_seconds: u64,
        view_only: bool,
        file_transfer: bool,
        file_root: Option<String>,
        /// Present in relay mode: the permanent nine-digit device ID.
        device_id: Option<String>,
        relay: Option<String>,
        /// True when the agent keeps serving sessions until stopped.
        persistent: bool,
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
    /// Relay mode only: one session ended and the agent waits for the next.
    SessionEnded {
        reason: String,
    },
    /// Relay mode only: the control link dropped or came back.
    RelayState {
        connected: bool,
    },
    Failed {
        stage: &'a str,
        detail: String,
    },
    Stopped {
        reason: String,
    },
}

fn emit_event(json: bool, event: &AgentEvent<'_>) {
    if !json {
        return;
    }
    if let Ok(line) = serde_json::to_string(event) {
        println!("{line}");
        let _ = std::io::stdout().flush();
    }
}

fn help() -> &'static str {
    "Lattice Remote agent\n\n\
Usage: lattice-agent [--bind ADDRESS:PORT] [--relay HOST[:PORT]|WSS_URL] [--identity FILE]\n\
                     [--pair-code CODE|--pair-code-file FILE|--pair-code-stdin]\n\
                     [--fps 1-10] [--allow-input]\n\
                     [--file-root PATH] [--terminal] [--json]\n\n\
Direct mode (default): the safe default listens on 127.0.0.1 only. To receive\n\
a LAN connection, pass the machine's LAN address explicitly, for example\n\
--bind 192.168.1.20:44900. The agent accepts one successfully paired\n\
connection, streams the primary display over an encrypted channel, then exits.\n\n\
Relay mode: --relay connects outward to a lattice-relay server and registers\n\
this machine's permanent nine-digit device ID (kept in --identity, default\n\
under the user data folder). A viewer then reaches this machine by ID alone;\n\
the pairing code still authenticates every session end to end, the relay only\n\
forwards ciphertext, and the agent keeps serving sessions until stopped. Use\n\
wss:// through HTTPS ingress on the public Internet; raw HOST:PORT is for a\n\
trusted private network or VPN only.\n\n\
By default the session is view-only. Pass --allow-input to let the paired\n\
viewer control this machine's mouse and keyboard; without it, input messages\n\
are ignored. File access stays disabled unless --file-root explicitly shares\n\
one folder; every remote path is then confined to that folder.\n\n\
Terminal mode: --terminal shares an encrypted shell session instead of the\n\
display, so a headless host (no desktop) works too. --allow-input lets the\n\
viewer type; without it the terminal is watch-only. --fps is ignored.\n\n\
Unattended access: a fixed eight-digit code lets a trusted viewer reconnect\n\
any time (all modes). Prefer --pair-code-file with an owner-only file, or pipe\n\
the code to --pair-code-stdin, so it does not appear in the process list.\n\
--pair-code remains available for interactive use. Without any of these a\n\
fresh code is generated per run. Five failed pairings in a row stop the agent.\n\
Typical headless setup:\n\
  lattice-agent --relay wss://relay.example.com --terminal --allow-input \\\n\
                --pair-code-file /secure/path/pair-code\n"
}

fn set_pairing_code(slot: &mut Option<String>, input: &str) -> Result<(), String> {
    if slot.is_some() {
        return Err("choose only one pairing-code source".to_string());
    }
    *slot = Some(normalize_pairing_code(input).map_err(|error| error.to_string())?);
    Ok(())
}

fn read_pairing_code_file(path: &Path) -> Result<String, String> {
    let file = std::fs::File::open(path)
        .map_err(|error| format!("cannot read --pair-code-file: {error}"))?;
    let metadata = file
        .metadata()
        .map_err(|error| format!("cannot inspect --pair-code-file: {error}"))?;
    if metadata.len() > 64 {
        return Err("--pair-code-file must be at most 64 bytes".to_string());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o077 != 0 {
            return Err(
                "--pair-code-file must not be accessible by group or other users".to_string(),
            );
        }
    }
    let mut input = String::new();
    file.take(65)
        .read_to_string(&mut input)
        .map_err(|error| format!("cannot read --pair-code-file: {error}"))?;
    if input.len() > 64 {
        return Err("--pair-code-file must be at most 64 bytes".to_string());
    }
    Ok(input)
}

fn read_pairing_code_stdin() -> Result<String, String> {
    let mut input = String::new();
    std::io::stdin()
        .take(65)
        .read_to_string(&mut input)
        .map_err(|error| format!("cannot read --pair-code-stdin: {error}"))?;
    if input.len() > 64 {
        return Err("--pair-code-stdin must be at most 64 bytes".to_string());
    }
    Ok(input)
}

fn parse_options() -> Result<Options, String> {
    let mut bind = format!("127.0.0.1:{DEFAULT_PORT}")
        .parse()
        .expect("default address is valid");
    let mut pairing_code = None;
    let mut fps = DEFAULT_FPS;
    let mut json = false;
    let mut allow_input = false;
    let mut file_root = None;
    let mut relay = None;
    let mut identity_file = None;
    let mut terminal = false;
    let mut arguments = env::args().skip(1);

    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--relay" => {
                let address = arguments.next().ok_or_else(|| {
                    "--relay needs HOST[:PORT], ws://URL, or wss://URL".to_string()
                })?;
                normalize_relay_endpoint(&address).map_err(|error| error.to_string())?;
                relay = Some(address);
            }
            "--identity" => {
                identity_file = Some(PathBuf::from(
                    arguments
                        .next()
                        .ok_or_else(|| "--identity needs a file path".to_string())?,
                ));
            }
            "--bind" => {
                bind = arguments
                    .next()
                    .ok_or_else(|| "--bind needs ADDRESS:PORT".to_string())?
                    .parse()
                    .map_err(|_| "--bind must be a valid IP_ADDRESS:PORT".to_string())?;
            }
            "--pair-code" => {
                let input = arguments
                    .next()
                    .ok_or_else(|| "--pair-code needs eight digits".to_string())?;
                set_pairing_code(&mut pairing_code, &input)?;
            }
            "--pair-code-file" => {
                let path = PathBuf::from(
                    arguments
                        .next()
                        .ok_or_else(|| "--pair-code-file needs a path".to_string())?,
                );
                let input = read_pairing_code_file(&path)?;
                set_pairing_code(&mut pairing_code, &input)?;
            }
            "--pair-code-stdin" => {
                let input = read_pairing_code_stdin()?;
                set_pairing_code(&mut pairing_code, &input)?;
            }
            "--fps" => {
                fps = arguments
                    .next()
                    .ok_or_else(|| "--fps needs a number".to_string())?
                    .parse()
                    .map_err(|_| "--fps must be a number".to_string())?;
                if !(1..=MAX_FPS).contains(&fps) {
                    return Err(format!("--fps must be between 1 and {MAX_FPS}"));
                }
            }
            "--json" => json = true,
            "--allow-input" => allow_input = true,
            "--terminal" => terminal = true,
            "--file-root" => {
                let path = PathBuf::from(
                    arguments
                        .next()
                        .ok_or_else(|| "--file-root needs a folder path".to_string())?,
                );
                file_root = Some(SharedFiles::open(&path)?.root().to_path_buf());
            }
            "--help" | "-h" => {
                print!("{}", help());
                std::process::exit(0);
            }
            unknown => return Err(format!("unknown option: {unknown}")),
        }
    }

    Ok(Options {
        bind,
        pairing_code: pairing_code
            .map(Ok)
            .unwrap_or_else(generate_pairing_code)
            .map_err(|error| error.to_string())?,
        fps,
        json,
        allow_input,
        file_root,
        relay,
        identity_file,
        terminal,
    })
}

fn default_identity_path() -> Option<PathBuf> {
    if cfg!(windows) {
        env::var_os("APPDATA").map(|base| {
            PathBuf::from(base)
                .join("LatticeRemote")
                .join("identity.json")
        })
    } else {
        env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                env::var_os("HOME").map(|home| PathBuf::from(home).join(".local").join("share"))
            })
            .map(|base| base.join("lattice-remote").join("identity.json"))
    }
}

fn target_size(width: u32, height: u32) -> (u32, u32) {
    if width <= MAX_WIDTH && height <= MAX_HEIGHT {
        return (width, height);
    }
    let scale = (MAX_WIDTH as f64 / width as f64).min(MAX_HEIGHT as f64 / height as f64);
    (
        (width as f64 * scale).round().max(1.0) as u32,
        (height as f64 * scale).round().max(1.0) as u32,
    )
}

/// A single capture: the real captured size, the downscaled stream size, and
/// the encoded JPEG at the stream size.
struct Capture {
    display_width: u32,
    display_height: u32,
    stream_width: u32,
    stream_height: u32,
    jpeg: Vec<u8>,
}

fn capture_jpeg(monitor: &Monitor) -> Result<Capture, String> {
    let captured = monitor.capture_image().map_err(|error| error.to_string())?;
    let (display_width, display_height) = (captured.width(), captured.height());
    let (stream_width, stream_height) = target_size(display_width, display_height);
    let image = if display_width == stream_width && display_height == stream_height {
        captured
    } else {
        image::imageops::resize(&captured, stream_width, stream_height, FilterType::Triangle)
    };

    let mut output = Cursor::new(Vec::new());
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output, 68);
    encoder
        .encode_image(&DynamicImage::ImageRgba8(image))
        .map_err(|error| error.to_string())?;
    Ok(Capture {
        display_width,
        display_height,
        stream_width,
        stream_height,
        jpeg: output.into_inner(),
    })
}

/// Runs the OS input backend on its own thread. `enigo::Enigo` is not portable
/// across async await points, so it lives here and consumes decoded inputs off
/// a channel. Returns when the channel closes (viewer gone), releasing keys.
fn spawn_input_thread(
    stream_width: u32,
    stream_height: u32,
    display_width: u32,
    display_height: u32,
    mut inputs: mpsc::Receiver<lattice_remote::RemoteInput>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut injector =
            match InputInjector::new(stream_width, stream_height, display_width, display_height) {
                Ok(injector) => injector,
                Err(error) => {
                    eprintln!("Input control unavailable: {error}");
                    // Drain so the sender never blocks on a full channel.
                    while inputs.blocking_recv().is_some() {}
                    return;
                }
            };
        while let Some(input) = inputs.blocking_recv() {
            let _ = injector.apply(input);
        }
        injector.release_all();
    })
}

fn bounded_input_channel<T>(capacity: usize) -> (mpsc::Sender<T>, mpsc::Receiver<T>) {
    mpsc::channel(capacity)
}

/// Waits for capacity instead of dropping key transitions. The wait stops
/// reading the encrypted stream, propagating bounded transport backpressure
/// to a viewer that sends input faster than the OS or PTY can consume it.
async fn send_input_with_backpressure<T>(
    sender: &mpsc::Sender<T>,
    input: T,
    wait: Duration,
) -> bool {
    matches!(timeout(wait, sender.send(input)).await, Ok(Ok(())))
}

/// Aborting a Tokio task is asynchronous: await its JoinHandle so captured
/// channel endpoints are definitely dropped before joining blocking threads.
async fn abort_and_wait<T>(task: tokio::task::JoinHandle<T>) {
    task.abort();
    let _ = task.await;
}

async fn send_remote_message<S>(
    writer: &mut SecureWriter<S>,
    message: &RemoteMessage,
) -> Result<(), String>
where
    S: AsyncRead + AsyncWrite + Unpin + Send,
{
    match timeout(REMOTE_SEND_TIMEOUT, writer.send(message)).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(error)) => Err(error.to_string()),
        Err(_) => Err("Timed out writing to the remote viewer.".to_string()),
    }
}

#[cfg(unix)]
fn set_pty_nonblocking(file_descriptor: libc::c_int) -> Result<(), String> {
    // SAFETY: file_descriptor is borrowed from the live PTY master. F_GETFL
    // and F_SETFL do not take ownership of it.
    let flags = unsafe { libc::fcntl(file_descriptor, libc::F_GETFL) };
    if flags == -1 {
        return Err(format!(
            "Cannot inspect PTY flags: {}",
            std::io::Error::last_os_error()
        ));
    }
    // portable-pty creates the reader/writer with dup(2), so this file-status
    // flag applies to both pumps and makes every read/write cancellable.
    if unsafe { libc::fcntl(file_descriptor, libc::F_SETFL, flags | libc::O_NONBLOCK) } == -1 {
        return Err(format!(
            "Cannot make PTY I/O cancellable: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

#[cfg(unix)]
fn wait_for_pty_event(
    file_descriptor: libc::c_int,
    events: libc::c_short,
    stopped: &AtomicBool,
) -> bool {
    while !stopped.load(Ordering::Relaxed) {
        let mut descriptor = libc::pollfd {
            fd: file_descriptor,
            events,
            revents: 0,
        };
        // SAFETY: descriptor points to one initialized pollfd for the live
        // PTY master and remains valid for the duration of this call.
        let ready = unsafe { libc::poll(&mut descriptor, 1, TERMINAL_PTY_POLL_INTERVAL_MS) };
        if stopped.load(Ordering::Relaxed) {
            return false;
        }
        if ready > 0 {
            if descriptor.revents & libc::POLLNVAL != 0 {
                return false;
            }
            // A requested readiness bit permits one nonblocking I/O attempt.
            // HUP/ERR without it ends the pump instead of spinning forever on
            // a persistent terminal error followed by WouldBlock.
            return descriptor.revents & events != 0;
        }
        if ready == 0 {
            continue;
        }
        if std::io::Error::last_os_error().kind() != std::io::ErrorKind::Interrupted {
            return false;
        }
    }
    false
}

#[cfg(target_os = "linux")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct LinuxProcessIdentity {
    process_id: libc::pid_t,
    session_id: libc::pid_t,
    start_time: u64,
}

#[cfg(target_os = "linux")]
fn parse_linux_process_identity(
    process_id: libc::pid_t,
    stat: &str,
) -> Option<LinuxProcessIdentity> {
    // comm may contain spaces and closing parentheses; the final ')' is the
    // only reliable boundary before the fixed fields beginning with state.
    let fields = stat
        .get(stat.rfind(')')? + 1..)?
        .split_whitespace()
        .collect::<Vec<_>>();
    Some(LinuxProcessIdentity {
        process_id,
        session_id: fields.get(3)?.parse().ok()?,
        // starttime is field 22; state is field 3 at index zero here.
        start_time: fields.get(19)?.parse().ok()?,
    })
}

#[cfg(target_os = "linux")]
fn read_linux_process_identity(process_id: libc::pid_t) -> Option<LinuxProcessIdentity> {
    let stat = std::fs::read_to_string(format!("/proc/{process_id}/stat")).ok()?;
    parse_linux_process_identity(process_id, &stat)
}

#[cfg(target_os = "linux")]
fn linux_session_processes(session_id: libc::pid_t) -> Vec<LinuxProcessIdentity> {
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| entry.file_name().to_string_lossy().parse().ok())
        .filter(|process_id| *process_id > 1 && *process_id != unsafe { libc::getpid() })
        .filter_map(read_linux_process_identity)
        .filter(|identity| identity.session_id == session_id)
        .collect()
}

#[cfg(target_os = "linux")]
fn open_verified_pidfd(identity: LinuxProcessIdentity) -> Option<std::os::fd::OwnedFd> {
    use std::os::fd::FromRawFd as _;

    // SAFETY: pidfd_open does not borrow userspace pointers. A non-negative
    // result is a newly owned descriptor, transferred to OwnedFd below.
    let descriptor = unsafe { libc::syscall(libc::SYS_pidfd_open, identity.process_id, 0) };
    if descriptor < 0 {
        return None;
    }
    let descriptor = unsafe { std::os::fd::OwnedFd::from_raw_fd(descriptor as libc::c_int) };
    // Close the scan-to-open PID reuse race: a pidfd pins one process, and a
    // second stat read must still match the original start-time identity.
    (read_linux_process_identity(identity.process_id) == Some(identity)).then_some(descriptor)
}

#[cfg(target_os = "linux")]
fn signal_pidfd(descriptor: &std::os::fd::OwnedFd, signal: libc::c_int) -> bool {
    use std::os::fd::AsRawFd as _;

    // SAFETY: the pidfd is owned for this call; a null siginfo with flags zero
    // requests ordinary signal delivery to that pinned process identity.
    unsafe {
        libc::syscall(
            libc::SYS_pidfd_send_signal,
            descriptor.as_raw_fd(),
            signal,
            std::ptr::null::<libc::siginfo_t>(),
            0,
        ) == 0
    }
}

#[cfg(target_os = "linux")]
fn signal_linux_session(session_id: libc::pid_t, signal: libc::c_int) -> bool {
    let mut delivered = false;
    for identity in linux_session_processes(session_id) {
        let Some(descriptor) = open_verified_pidfd(identity) else {
            continue;
        };
        delivered |= signal_pidfd(&descriptor, signal);
    }
    delivered
}

fn agent_name() -> String {
    env::var("COMPUTERNAME")
        .or_else(|_| env::var("HOSTNAME"))
        .ok()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "Lattice Agent".to_string())
}

fn safe_file_error(detail: impl Into<String>) -> String {
    let mut output = String::new();
    for character in detail.into().chars() {
        let character = if character.is_control() {
            ' '
        } else {
            character
        };
        if output.len() + character.len_utf8() > MAX_FILE_ERROR_BYTES {
            break;
        }
        output.push(character);
    }
    if output.trim().is_empty() {
        "Remote file operation failed.".to_string()
    } else {
        output
    }
}

fn file_error(operation_id: u64, detail: impl Into<String>) -> RemoteMessage {
    RemoteMessage::FileResponse(RemoteFileResponse::Error {
        operation_id,
        detail: safe_file_error(detail),
    })
}

fn spawn_directory_list(
    files: Arc<SharedFiles>,
    request_id: u64,
    path: String,
    outgoing: mpsc::Sender<RemoteMessage>,
) {
    tokio::task::spawn_blocking(move || match files.list(&path) {
        Ok((path, entries)) => {
            if outgoing
                .blocking_send(RemoteMessage::FileResponse(RemoteFileResponse::ListStart {
                    request_id,
                    path,
                }))
                .is_err()
            {
                return;
            }
            for entry in entries {
                if outgoing
                    .blocking_send(RemoteMessage::FileResponse(RemoteFileResponse::ListEntry {
                        request_id,
                        entry,
                    }))
                    .is_err()
                {
                    return;
                }
            }
            let _ =
                outgoing.blocking_send(RemoteMessage::FileResponse(RemoteFileResponse::ListDone {
                    request_id,
                }));
        }
        Err(error) => {
            let _ = outgoing.blocking_send(file_error(request_id, error));
        }
    });
}

fn spawn_download(
    files: Arc<SharedFiles>,
    transfer_id: u64,
    path: String,
    outgoing: mpsc::Sender<RemoteMessage>,
    cancelled: Arc<AtomicBool>,
    active_downloads: Arc<Mutex<HashMap<u64, Arc<AtomicBool>>>>,
) {
    tokio::task::spawn_blocking(move || {
        let unregister = || {
            if let Ok(mut active) = active_downloads.lock() {
                active.remove(&transfer_id);
            }
        };
        let mut download = match files.download(&path) {
            Ok(download) => download,
            Err(error) => {
                let _ = outgoing.blocking_send(file_error(transfer_id, error));
                unregister();
                return;
            }
        };
        if cancelled.load(Ordering::Relaxed) {
            unregister();
            return;
        }
        if outgoing
            .blocking_send(RemoteMessage::FileResponse(
                RemoteFileResponse::DownloadStart {
                    transfer_id,
                    name: download.name.clone(),
                    size: download.size,
                },
            ))
            .is_err()
        {
            unregister();
            return;
        }
        let mut buffer = vec![0; FILE_CHUNK_SIZE];
        loop {
            if cancelled.load(Ordering::Relaxed) {
                unregister();
                return;
            }
            match download.read_chunk(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    if outgoing
                        .blocking_send(RemoteMessage::FileResponse(
                            RemoteFileResponse::DownloadChunk {
                                transfer_id,
                                bytes: buffer[..read].to_vec(),
                            },
                        ))
                        .is_err()
                    {
                        unregister();
                        return;
                    }
                }
                Err(error) => {
                    let _ = outgoing.blocking_send(file_error(transfer_id, error));
                    unregister();
                    return;
                }
            }
        }
        let _ = outgoing.blocking_send(RemoteMessage::FileResponse(RemoteFileResponse::Complete {
            transfer_id,
        }));
        unregister();
    });
}

/// Serves the shared-folder side of a session; both the screen stream and the
/// terminal stream accept the same file requests over their receiver loops.
struct FileRequestHandler {
    files: Option<Arc<SharedFiles>>,
    outgoing: mpsc::Sender<RemoteMessage>,
    downloads: Arc<Mutex<HashMap<u64, Arc<AtomicBool>>>>,
    uploads: HashMap<u64, HostUpload>,
}

impl FileRequestHandler {
    fn new(files: Option<Arc<SharedFiles>>, outgoing: mpsc::Sender<RemoteMessage>) -> Self {
        Self {
            files,
            outgoing,
            downloads: Arc::new(Mutex::new(HashMap::new())),
            uploads: HashMap::new(),
        }
    }

    async fn handle(&mut self, request: RemoteFileRequest) {
        match request {
            RemoteFileRequest::List { request_id, path } => {
                if let Some(files) = &self.files {
                    spawn_directory_list(
                        Arc::clone(files),
                        request_id,
                        path,
                        self.outgoing.clone(),
                    );
                } else {
                    let _ = self
                        .outgoing
                        .send(file_error(request_id, "File sharing is not enabled."))
                        .await;
                }
            }
            RemoteFileRequest::Download { transfer_id, path } => {
                if let Some(files) = &self.files {
                    let cancelled = Arc::new(AtomicBool::new(false));
                    let inserted = self
                        .downloads
                        .lock()
                        .map(|mut active| match active.entry(transfer_id) {
                            Entry::Vacant(entry) => {
                                entry.insert(Arc::clone(&cancelled));
                                true
                            }
                            Entry::Occupied(_) => false,
                        })
                        .unwrap_or(false);
                    if inserted {
                        spawn_download(
                            Arc::clone(files),
                            transfer_id,
                            path,
                            self.outgoing.clone(),
                            cancelled,
                            Arc::clone(&self.downloads),
                        );
                    } else {
                        let _ = self
                            .outgoing
                            .send(file_error(
                                transfer_id,
                                "The download identifier is already active.",
                            ))
                            .await;
                    }
                } else {
                    let _ = self
                        .outgoing
                        .send(file_error(transfer_id, "File sharing is not enabled."))
                        .await;
                }
            }
            RemoteFileRequest::UploadStart {
                transfer_id,
                path,
                size,
                overwrite,
            } => {
                let result = self
                    .files
                    .as_ref()
                    .ok_or_else(|| "File sharing is not enabled.".to_string())
                    .and_then(|files| {
                        if self.uploads.contains_key(&transfer_id) {
                            return Err("The upload identifier is already active.".to_string());
                        }
                        files.begin_upload(transfer_id, &path, size, overwrite)
                    });
                match result {
                    Ok(upload) => {
                        self.uploads.insert(transfer_id, upload);
                        let _ = self
                            .outgoing
                            .send(RemoteMessage::FileResponse(
                                RemoteFileResponse::UploadReady { transfer_id },
                            ))
                            .await;
                    }
                    Err(error) => {
                        let _ = self.outgoing.send(file_error(transfer_id, error)).await;
                    }
                }
            }
            RemoteFileRequest::UploadChunk { transfer_id, bytes } => {
                let result = self
                    .uploads
                    .get_mut(&transfer_id)
                    .ok_or_else(|| "The upload is not active.".to_string())
                    .and_then(|upload| upload.write_chunk(&bytes).map(|_| ()));
                if let Err(error) = result {
                    self.uploads.remove(&transfer_id);
                    let _ = self.outgoing.send(file_error(transfer_id, error)).await;
                }
            }
            RemoteFileRequest::UploadFinish { transfer_id } => {
                let result = self
                    .uploads
                    .remove(&transfer_id)
                    .ok_or_else(|| "The upload is not active.".to_string())
                    .and_then(HostUpload::finish);
                let response = match result {
                    Ok(()) => {
                        RemoteMessage::FileResponse(RemoteFileResponse::Complete { transfer_id })
                    }
                    Err(error) => file_error(transfer_id, error),
                };
                let _ = self.outgoing.send(response).await;
            }
            RemoteFileRequest::Cancel { transfer_id } => {
                self.uploads.remove(&transfer_id);
                if let Some(cancelled) = self
                    .downloads
                    .lock()
                    .ok()
                    .and_then(|mut active| active.remove(&transfer_id))
                {
                    cancelled.store(true, Ordering::Relaxed);
                }
                let _ = self
                    .outgoing
                    .send(RemoteMessage::FileResponse(RemoteFileResponse::Complete {
                        transfer_id,
                    }))
                    .await;
            }
        }
    }

    /// Stops in-flight downloads when the session ends.
    fn cancel_all(&mut self) {
        if let Ok(mut active) = self.downloads.lock() {
            for (_, cancelled) in active.drain() {
                cancelled.store(true, Ordering::Relaxed);
            }
        }
    }
}

async fn serve<S>(
    connection: SecureConnection<S>,
    fps: u32,
    allow_input: bool,
    file_root: Option<PathBuf>,
) -> Result<(), String>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let monitors = Monitor::all().map_err(|error| error.to_string())?;
    let monitor = monitors
        .into_iter()
        .find(|monitor| monitor.is_primary().unwrap_or(false))
        .ok_or_else(|| "no primary display is available".to_string())?;
    let mut capture = capture_jpeg(&monitor)?;
    let mut width = capture.stream_width;
    let mut height = capture.stream_height;

    let shared_files = file_root.map(SharedFiles::open).transpose()?.map(Arc::new);
    let (mut reader, mut writer_half) = connection.split();

    send_remote_message(
        &mut writer_half,
        &RemoteMessage::Hello(RemoteHello {
            protocol_version: PROTOCOL_VERSION,
            agent_name: agent_name(),
            width,
            height,
            view_only: !allow_input,
            file_transfer: shared_files.is_some(),
            file_root_label: shared_files
                .as_ref()
                .map(|files| files.label().to_string())
                .unwrap_or_default(),
            terminal: false,
        }),
    )
    .await?;

    // One bounded writer queue serialises frames and file responses on the
    // Noise send state while applying backpressure to large downloads.
    let (outgoing, mut outgoing_rx) = mpsc::channel::<RemoteMessage>(128);
    let writer = tokio::spawn(async move {
        while let Some(message) = outgoing_rx.recv().await {
            if send_remote_message(&mut writer_half, &message)
                .await
                .is_err()
            {
                break;
            }
        }
    });

    // Receiving runs on its own task. Input remains independently authorised;
    // file messages are accepted only when an explicit shared root exists.
    let (input_tx, input_thread) = if allow_input {
        let (tx, rx) = bounded_input_channel(SCREEN_INPUT_QUEUE_CAPACITY);
        let handle = spawn_input_thread(
            capture.stream_width,
            capture.stream_height,
            capture.display_width,
            capture.display_height,
            rx,
        );
        (Some(tx), Some(handle))
    } else {
        (None, None)
    };

    let mut file_handler = FileRequestHandler::new(shared_files.clone(), outgoing.clone());
    let receiver = tokio::spawn(async move {
        loop {
            match reader.receive().await {
                Ok(RemoteMessage::Input(input)) => {
                    if let Some(tx) = &input_tx {
                        if !send_input_with_backpressure(tx, input, REMOTE_INPUT_ENQUEUE_TIMEOUT)
                            .await
                        {
                            break;
                        }
                    }
                }
                Ok(RemoteMessage::FileRequest(request)) => file_handler.handle(request).await,
                Ok(RemoteMessage::Close(_)) | Err(_) => break,
                Ok(_) => {}
            }
        }
        // Dropping the sender ends the input thread and releases held keys.
        drop(input_tx);
        file_handler.cancel_all();
    });

    let interval = Duration::from_millis(1000 / fps as u64);
    let mut frame_id = 0u64;
    let stream_result = loop {
        if receiver.is_finished() {
            break Ok(());
        }
        let started = Instant::now();
        frame_id = frame_id.wrapping_add(1);
        let mut send_error = None;
        let messages =
            match frame_messages(frame_id, width, height, FrameFormat::Jpeg, &capture.jpeg) {
                Ok(messages) => messages,
                Err(error) => break Err(error.to_string()),
            };
        for message in messages {
            if outgoing.send(message).await.is_err() {
                send_error = Some("The encrypted writer stopped.".to_string());
                break;
            }
        }
        if let Some(error) = send_error {
            break Err(error);
        }

        if started.elapsed() < interval {
            sleep(interval - started.elapsed()).await;
        }
        capture = match capture_jpeg(&monitor) {
            Ok(capture) => capture,
            Err(error) => break Err(error),
        };
        width = capture.stream_width;
        height = capture.stream_height;
    };

    // Await each abort so its captured senders/receivers are dropped before
    // joining the blocking input thread or returning to a persistent agent.
    abort_and_wait(receiver).await;
    drop(outgoing);
    abort_and_wait(writer).await;
    if let Some(handle) = input_thread {
        let _ = handle.join();
    }
    stream_result
}

const TERMINAL_COLS: u16 = 120;
const TERMINAL_ROWS: u16 = 32;

/// Owns a PTY child until it has either exited naturally or been terminated
/// and reaped. `portable-pty::Child` has no process-killing `Drop`, so simply
/// returning after `spawn_command` can otherwise orphan the shell.
struct TerminalChildGuard {
    child: Option<Box<dyn portable_pty::Child + Send + Sync>>,
    // portable-pty calls setsid(2) before exec on Unix, making the spawned
    // shell PID both the session and initial process-group leader. Linux uses
    // the ID to terminate every process still in that PTY session; other Unix
    // systems safely fall back to its initial process group.
    #[cfg(unix)]
    process_group: Option<libc::pid_t>,
}

impl TerminalChildGuard {
    fn new(child: Box<dyn portable_pty::Child + Send + Sync>) -> Self {
        #[cfg(unix)]
        let process_group = child
            .process_id()
            .and_then(|process_id| libc::pid_t::try_from(process_id).ok())
            .filter(|process_group| {
                // Never allow a malformed/custom Child implementation to
                // target init or the agent's own process group.
                *process_group > 1 && *process_group != unsafe { libc::getpgrp() }
            });
        Self {
            child: Some(child),
            #[cfg(unix)]
            process_group,
        }
    }

    fn terminate_and_wait(&mut self) {
        let Some(mut child) = self.child.take() else {
            return;
        };

        #[cfg(unix)]
        if let Some(process_group) = self.process_group.take() {
            // SAFETY: process_group is a validated positive PID distinct from
            // the agent's group. The unreaped leader pins this group/session
            // ID until all signalling is complete.
            let _ = unsafe { libc::killpg(process_group, libc::SIGHUP) };

            #[cfg(target_os = "linux")]
            let mut used_pidfd = signal_linux_session(process_group, libc::SIGHUP);
            std::thread::sleep(TERMINAL_PROCESS_GROUP_GRACE);

            #[cfg(target_os = "linux")]
            for _ in 0..TERMINAL_SESSION_KILL_ROUNDS {
                used_pidfd |= signal_linux_session(process_group, libc::SIGKILL);
                std::thread::sleep(TERMINAL_SESSION_KILL_INTERVAL);
            }

            // Keep the leader unreaped until after this final group fallback,
            // so its PID cannot be reused for an unrelated process group.
            let kill_sent = unsafe { libc::killpg(process_group, libc::SIGKILL) } == 0;
            #[cfg(target_os = "linux")]
            let termination_sent = used_pidfd || kill_sent;
            #[cfg(not(target_os = "linux"))]
            let termination_sent = kill_sent;
            if !termination_sent {
                let _ = child.kill();
            }
            let _ = child.wait();
            return;
        }

        if matches!(child.try_wait(), Ok(Some(_))) {
            return;
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

impl Drop for TerminalChildGuard {
    fn drop(&mut self) {
        self.terminate_and_wait();
    }
}

fn default_shell() -> String {
    if cfg!(windows) {
        env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".to_string())
    } else {
        env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
    }
}

/// Terminal mode: instead of streaming the display, the agent runs the user's
/// shell in a PTY and bridges raw bytes both ways. This is what a headless
/// host without any desktop can share; file access rides the same channel.
async fn serve_terminal<S>(
    connection: SecureConnection<S>,
    allow_input: bool,
    file_root: Option<PathBuf>,
) -> Result<(), String>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};

    // Validate the optional shared root before starting a process. The CLI
    // validated it earlier, but it can disappear before a viewer connects.
    let shared_files = file_root.map(SharedFiles::open).transpose()?.map(Arc::new);
    let pty = native_pty_system()
        .openpty(PtySize {
            rows: TERMINAL_ROWS,
            cols: TERMINAL_COLS,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("Cannot open a PTY: {error}"))?;
    let mut command = CommandBuilder::new(default_shell());
    if let Some(home) = env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        command.cwd(home);
    }
    let child = pty
        .slave
        .spawn_command(command)
        .map_err(|error| format!("Cannot start the shell: {error}"))?;
    let mut child = TerminalChildGuard::new(child);
    drop(pty.slave);
    let master = pty.master;
    #[cfg(unix)]
    let pty_poll_fd = master
        .as_raw_fd()
        .ok_or_else(|| "The PTY master has no pollable file descriptor.".to_string())?;
    let mut pty_reader = master
        .try_clone_reader()
        .map_err(|error| error.to_string())?;
    let mut pty_writer = master.take_writer().map_err(|error| error.to_string())?;
    #[cfg(unix)]
    set_pty_nonblocking(pty_poll_fd)?;

    let (mut reader, mut writer_half) = connection.split();
    send_remote_message(
        &mut writer_half,
        &RemoteMessage::Hello(RemoteHello {
            protocol_version: PROTOCOL_VERSION,
            agent_name: agent_name(),
            width: u32::from(TERMINAL_COLS),
            height: u32::from(TERMINAL_ROWS),
            view_only: !allow_input,
            file_transfer: shared_files.is_some(),
            file_root_label: shared_files
                .as_ref()
                .map(|files| files.label().to_string())
                .unwrap_or_default(),
            terminal: true,
        }),
    )
    .await?;

    let (outgoing, mut outgoing_rx) = mpsc::channel::<RemoteMessage>(128);
    // Either side of the PTY-to-wire pump can finish independently of the
    // viewer's read half. A sticky watch signal wakes the receive loop even
    // when the viewer keeps its socket open and sends nothing further.
    let (pump_ended_tx, mut pump_ended_rx) = watch::channel(false);
    let writer_ended_tx = pump_ended_tx.clone();
    let writer = tokio::spawn(async move {
        while let Some(message) = outgoing_rx.recv().await {
            if send_remote_message(&mut writer_half, &message)
                .await
                .is_err()
            {
                break;
            }
        }
        let _ = writer_ended_tx.send(true);
    });

    // Blocking PTY reads run on a plain thread; a closed channel or shell
    // exit ends the pump, and the Close tells the viewer why.
    let pump_stopped = Arc::new(AtomicBool::new(false));
    let output_tx = outgoing.clone();
    let output_ended_tx = pump_ended_tx.clone();
    let output_stopped = Arc::clone(&pump_stopped);
    let output_thread = std::thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        loop {
            #[cfg(unix)]
            if !wait_for_pty_event(pty_poll_fd, libc::POLLIN, &output_stopped) {
                break;
            }
            if output_stopped.load(Ordering::Relaxed) {
                break;
            }
            match pty_reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(length) => {
                    if output_tx
                        .blocking_send(RemoteMessage::TerminalData {
                            bytes: buffer[..length].to_vec(),
                        })
                        .is_err()
                    {
                        break;
                    }
                }
                #[cfg(unix)]
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
                    ) => {}
                Err(_) => break,
            }
        }
        // Never wait for room for the final advisory Close: the separate end
        // signal drives teardown and will close the transport if its queue is
        // already backpressured.
        let _ = output_tx.try_send(RemoteMessage::Close("The shell session ended.".to_string()));
        let _ = output_ended_tx.send(true);
    });

    // Keystrokes reach the PTY through a bounded blocking writer thread. The
    // async sender below waits for room, bounding large-paste memory usage.
    let (keystroke_tx, mut keystroke_rx) =
        bounded_input_channel::<Vec<u8>>(TERMINAL_INPUT_QUEUE_CAPACITY);
    let input_ended_tx = pump_ended_tx.clone();
    #[cfg(unix)]
    let input_stopped = Arc::clone(&pump_stopped);
    let input_thread = std::thread::spawn(move || {
        #[cfg(unix)]
        'input: while let Some(bytes) = keystroke_rx.blocking_recv() {
            let mut remaining = bytes.as_slice();
            while !remaining.is_empty() {
                if !wait_for_pty_event(pty_poll_fd, libc::POLLOUT, &input_stopped) {
                    break 'input;
                }
                match pty_writer.write(remaining) {
                    Ok(0) => break 'input,
                    Ok(length) => remaining = &remaining[length..],
                    Err(error)
                        if matches!(
                            error.kind(),
                            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
                        ) => {}
                    Err(_) => break 'input,
                }
            }
        }
        #[cfg(not(unix))]
        while let Some(bytes) = keystroke_rx.blocking_recv() {
            if pty_writer.write_all(&bytes).is_err() {
                break;
            }
            let _ = pty_writer.flush();
        }
        let _ = input_ended_tx.send(true);
    });
    drop(pump_ended_tx);

    let mut file_handler = FileRequestHandler::new(shared_files, outgoing.clone());
    loop {
        let message = tokio::select! {
            biased;
            _ = pump_ended_rx.changed() => break,
            message = reader.receive() => message,
        };
        match message {
            Ok(RemoteMessage::TerminalInput { bytes }) => {
                if allow_input {
                    let queued = tokio::select! {
                        biased;
                        _ = pump_ended_rx.changed() => false,
                        queued = send_input_with_backpressure(
                            &keystroke_tx,
                            bytes,
                            REMOTE_INPUT_ENQUEUE_TIMEOUT,
                        ) => queued,
                    };
                    if !queued {
                        break;
                    }
                }
            }
            Ok(RemoteMessage::TerminalResize { cols, rows }) => {
                if allow_input {
                    let _ = master.resize(PtySize {
                        rows,
                        cols,
                        pixel_width: 0,
                        pixel_height: 0,
                    });
                }
            }
            Ok(RemoteMessage::FileRequest(request)) => file_handler.handle(request).await,
            Ok(RemoteMessage::Close(_)) | Err(_) => break,
            Ok(_) => {}
        }
    }

    file_handler.cancel_all();
    drop(file_handler);
    drop(keystroke_tx);
    pump_stopped.store(true, Ordering::Relaxed);
    child.terminate_and_wait();
    drop(outgoing);
    // Dropping the async receiver first guarantees a PTY output thread stuck
    // in blocking_send observes closure before we synchronously join it.
    abort_and_wait(writer).await;
    // Unix polling borrows master's raw fd, so keep it alive through both
    // joins. Dropping the ConPTY master is Windows' available I/O wake-up.
    #[cfg(windows)]
    drop(master);
    let _ = output_thread.join();
    let _ = input_thread.join();
    #[cfg(not(windows))]
    drop(master);
    Ok(())
}

/// How one relayed session concluded, reported back to the control loop.
enum SessionOutcome {
    /// The viewer failed the pairing handshake.
    Rejected,
    /// A paired session ran and finished for the given reason.
    Ended(String),
}

/// Serves one invited session over a fresh relay connection. The pairing code
/// still authenticates the viewer end to end; the relay only linked sockets.
async fn run_relay_session(
    relay_endpoint: String,
    channel_id: String,
    identity: DeviceIdentity,
    options: Options,
) -> SessionOutcome {
    let mut stream = match Transport::connect(&relay_endpoint).await {
        Ok(stream) => stream,
        Err(error) => return SessionOutcome::Ended(format!("Could not reach the relay: {error}")),
    };
    if write_client_message(
        &mut stream,
        &RelayClientMessage::Join {
            channel_id,
            device_id: identity.device_id.clone(),
            auth_token: identity.auth_token.clone(),
        },
    )
    .await
    .is_err()
    {
        return SessionOutcome::Ended("The relay dropped the session invite.".to_string());
    }
    match timeout(Duration::from_secs(10), read_server_message(&mut stream)).await {
        Ok(Ok(RelayServerMessage::Linked { .. })) => {}
        _ => return SessionOutcome::Ended("The relay did not link the session.".to_string()),
    }

    emit_event(
        options.json,
        &AgentEvent::PairingRequest {
            peer: "relay".to_string(),
        },
    );
    // The permanent identity key lets returning viewers pin this device.
    let static_key = match identity.noise_private_bytes() {
        Ok(static_key) => static_key,
        Err(error) => return SessionOutcome::Ended(format!("Identity key unavailable: {error}")),
    };
    let secure = match timeout(
        Duration::from_secs(10),
        SecureConnection::accept_with_static_key(stream, &options.pairing_code, &static_key),
    )
    .await
    {
        Ok(Ok(secure)) => secure,
        Ok(Err(_)) | Err(_) => return SessionOutcome::Rejected,
    };
    emit_event(
        options.json,
        &AgentEvent::Paired {
            peer: "relay".to_string(),
        },
    );
    let outcome = if options.terminal {
        serve_terminal(secure, options.allow_input, options.file_root).await
    } else {
        serve(secure, options.fps, options.allow_input, options.file_root).await
    };
    match outcome {
        Ok(()) => SessionOutcome::Ended("Remote session completed.".to_string()),
        Err(error) => SessionOutcome::Ended(format!("Session ended: {error}")),
    }
}

/// Relay mode: register the permanent device ID, then keep serving sessions
/// until stopped. The control link reconnects with backoff; a session in
/// flight rides its own connection and survives a control drop.
async fn run_relay(options: &Options) -> String {
    let relay_raw = options.relay.clone().expect("relay mode requires --relay");
    let relay_endpoint = match normalize_relay_endpoint(&relay_raw) {
        Ok(endpoint) => endpoint,
        Err(error) => {
            emit_event(
                options.json,
                &AgentEvent::Failed {
                    stage: "relay",
                    detail: error.to_string(),
                },
            );
            return "The relay address is invalid.".to_string();
        }
    };
    let identity_path = match options.identity_file.clone().or_else(default_identity_path) {
        Some(path) => path,
        None => {
            let detail = "No identity file location is available.".to_string();
            emit_event(
                options.json,
                &AgentEvent::Failed {
                    stage: "identity",
                    detail: detail.clone(),
                },
            );
            return detail;
        }
    };
    let identity = match DeviceIdentity::load_or_create(&identity_path) {
        Ok(identity) => identity,
        Err(error) => {
            emit_event(
                options.json,
                &AgentEvent::Failed {
                    stage: "identity",
                    detail: error.to_string(),
                },
            );
            return format!("Cannot load the device identity: {error}");
        }
    };

    let formatted_code = format!(
        "{}-{}",
        &options.pairing_code[..4],
        &options.pairing_code[4..]
    );
    let mut failed_pairings = 0u32;
    let mut announced = false;
    let mut link_up = false;
    let mut reconnect_delay = Duration::from_secs(1);

    loop {
        let connected = async {
            let stream = Transport::connect(&relay_endpoint)
                .await
                .map_err(|error| error.to_string())?;
            let (mut read_half, mut write_half) = tokio::io::split(stream);
            write_client_message(
                &mut write_half,
                &RelayClientMessage::Register {
                    device_id: identity.device_id.clone(),
                    auth_token: identity.auth_token.clone(),
                    agent_name: agent_name(),
                },
            )
            .await
            .map_err(|error| error.to_string())?;
            match timeout(Duration::from_secs(10), read_server_message(&mut read_half)).await {
                Ok(Ok(RelayServerMessage::Registered)) => Ok((read_half, write_half, None)),
                Ok(Ok(RelayServerMessage::Error { code, detail })) => {
                    Ok((read_half, write_half, Some((code, detail))))
                }
                _ => Err("The relay did not answer the registration.".to_string()),
            }
        }
        .await;

        let (mut read_half, mut write_half) = match connected {
            Ok((_, _, Some((code, detail)))) => {
                emit_event(
                    options.json,
                    &AgentEvent::Failed {
                        stage: "relay",
                        detail: detail.clone(),
                    },
                );
                return format!("The relay refused this device ({code}): {detail}");
            }
            Ok((read_half, write_half, None)) => (read_half, write_half),
            Err(detail) => {
                if !announced {
                    emit_event(
                        options.json,
                        &AgentEvent::Failed {
                            stage: "relay",
                            detail: detail.clone(),
                        },
                    );
                    return format!("Cannot reach the relay: {detail}");
                }
                if link_up {
                    link_up = false;
                    emit_event(options.json, &AgentEvent::RelayState { connected: false });
                }
                sleep(reconnect_delay).await;
                reconnect_delay = (reconnect_delay * 2).min(RELAY_RECONNECT_CAP);
                continue;
            }
        };
        reconnect_delay = Duration::from_secs(1);

        if !announced {
            announced = true;
            emit_event(
                options.json,
                &AgentEvent::Ready {
                    address: relay_raw.clone(),
                    pairing_code: formatted_code.clone(),
                    expires_in_seconds: 0,
                    view_only: !options.allow_input,
                    file_transfer: options.file_root.is_some(),
                    file_root: options
                        .file_root
                        .as_ref()
                        .map(|path| path.display().to_string()),
                    device_id: Some(identity.device_id.clone()),
                    relay: Some(relay_raw.clone()),
                    persistent: true,
                },
            );
            if !options.json {
                println!("Lattice Remote is ready over the relay {relay_raw}.");
                println!("Device ID: {}", format_device_id(&identity.device_id));
                println!("Pairing code: {formatted_code}");
                println!("The code stays valid until sharing stops.");
            }
        }
        if !link_up {
            link_up = true;
            emit_event(options.json, &AgentEvent::RelayState { connected: true });
        }

        // A writer channel serialises pings; the reader loop below owns
        // invites and session outcomes.
        let (control_tx, mut control_rx) = mpsc::channel::<RelayClientMessage>(4);
        let writer_task = tokio::spawn(async move {
            while let Some(message) = control_rx.recv().await {
                if write_client_message(&mut write_half, &message)
                    .await
                    .is_err()
                {
                    break;
                }
            }
        });
        let ping_tx = control_tx.clone();
        let ping_task = tokio::spawn(async move {
            loop {
                sleep(RELAY_PING_INTERVAL).await;
                if ping_tx.send(RelayClientMessage::Ping).await.is_err() {
                    break;
                }
            }
        });

        // Sessions run inline: pings keep flowing from their own task, so a
        // long session cannot get this device deregistered, and a second
        // viewer's dial simply times out while a session streams. `serve`
        // holds OS capture handles that are not `Send`, which also rules
        // out spawning sessions onto other threads.
        let fatal = loop {
            match read_server_message(&mut read_half).await {
                Ok(RelayServerMessage::Invite { channel_id }) => {
                    let outcome = run_relay_session(
                        relay_endpoint.clone(),
                        channel_id,
                        identity.clone(),
                        options.clone(),
                    )
                    .await;
                    match outcome {
                        SessionOutcome::Rejected => {
                            failed_pairings += 1;
                            let attempts_remaining =
                                MAX_PAIRING_FAILURES.saturating_sub(failed_pairings);
                            emit_event(
                                options.json,
                                &AgentEvent::PairingRejected { attempts_remaining },
                            );
                            if failed_pairings >= MAX_PAIRING_FAILURES {
                                break Some(
                                    "Too many failed pairing attempts; the Agent stopped."
                                        .to_string(),
                                );
                            }
                        }
                        SessionOutcome::Ended(reason) => {
                            failed_pairings = 0;
                            emit_event(options.json, &AgentEvent::SessionEnded { reason });
                        }
                    }
                }
                Ok(_) => {}
                Err(_) => break None,
            }
        };

        ping_task.abort();
        writer_task.abort();
        if let Some(reason) = fatal {
            return reason;
        }
        if link_up {
            link_up = false;
            emit_event(options.json, &AgentEvent::RelayState { connected: false });
        }
        sleep(reconnect_delay).await;
        reconnect_delay = (reconnect_delay * 2).min(RELAY_RECONNECT_CAP);
    }
}

#[tokio::main]
async fn main() {
    let requested_json = env::args().any(|argument| argument == "--json");
    let options = match parse_options() {
        Ok(options) => options,
        Err(error) => {
            emit_event(
                requested_json,
                &AgentEvent::Failed {
                    stage: "options",
                    detail: error.clone(),
                },
            );
            if !requested_json {
                eprintln!("Error: {error}\n\n{}", help());
            }
            std::process::exit(2);
        }
    };

    if options.relay.is_some() {
        let stop_reason = run_relay(&options).await;
        emit_event(
            options.json,
            &AgentEvent::Stopped {
                reason: stop_reason.clone(),
            },
        );
        if !options.json {
            eprintln!("{stop_reason}");
        }
        return;
    }

    let listener = match TcpListener::bind(options.bind).await {
        Ok(listener) => listener,
        Err(error) => {
            let detail = format!("Unable to listen on {}: {error}", options.bind);
            emit_event(
                options.json,
                &AgentEvent::Failed {
                    stage: "listen",
                    detail: detail.clone(),
                },
            );
            if !options.json {
                eprintln!("{detail}");
            }
            std::process::exit(1);
        }
    };

    let formatted_code = format!(
        "{}-{}",
        &options.pairing_code[..4],
        &options.pairing_code[4..]
    );
    emit_event(
        options.json,
        &AgentEvent::Ready {
            address: options.bind.to_string(),
            pairing_code: formatted_code.clone(),
            expires_in_seconds: PAIRING_LIFETIME.as_secs(),
            view_only: !options.allow_input,
            file_transfer: options.file_root.is_some(),
            file_root: options
                .file_root
                .as_ref()
                .map(|path| path.display().to_string()),
            device_id: None,
            relay: None,
            persistent: false,
        },
    );
    if !options.json {
        let mode = if options.allow_input {
            "remote control enabled"
        } else {
            "view-only"
        };
        println!("Lattice Remote is ready ({mode})");
        println!("Address: {}", options.bind);
        println!("Pairing code: {formatted_code}");
        println!("The code is valid for one successful connection and is not saved.");
    }

    let expires_at = Instant::now() + PAIRING_LIFETIME;
    let mut failed_pairings = 0_u32;
    let stop_reason = loop {
        let remaining = expires_at.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break "Pairing code expired after five minutes.".to_string();
        }
        let (stream, peer) = match timeout(remaining, listener.accept()).await {
            Ok(Ok((stream, peer))) => {
                let _ = stream.set_nodelay(true);
                (stream, peer)
            }
            Ok(Err(error)) => {
                if !options.json {
                    eprintln!("Could not accept connection: {error}");
                }
                continue;
            }
            Err(_) => break "Pairing code expired after five minutes.".to_string(),
        };
        emit_event(
            options.json,
            &AgentEvent::PairingRequest {
                peer: peer.to_string(),
            },
        );
        if !options.json {
            eprintln!("Pairing request from {peer}");
        }
        let secure = match timeout(
            Duration::from_secs(10),
            SecureConnection::accept(stream, &options.pairing_code),
        )
        .await
        {
            Ok(Ok(connection)) => connection,
            Ok(Err(_)) | Err(_) => {
                failed_pairings += 1;
                let attempts_remaining = MAX_PAIRING_FAILURES.saturating_sub(failed_pairings);
                emit_event(
                    options.json,
                    &AgentEvent::PairingRejected { attempts_remaining },
                );
                if !options.json {
                    eprintln!("Pairing rejected.");
                }
                if failed_pairings >= MAX_PAIRING_FAILURES {
                    break "Too many failed pairing attempts; the Agent stopped.".to_string();
                }
                sleep(Duration::from_secs(u64::from(failed_pairings))).await;
                continue;
            }
        };

        emit_event(
            options.json,
            &AgentEvent::Paired {
                peer: peer.to_string(),
            },
        );
        if !options.json {
            let stream_kind = if options.allow_input {
                "interactive"
            } else {
                "view-only"
            };
            println!("Paired with {peer}. Starting encrypted {stream_kind} stream.");
        }
        let outcome = if options.terminal {
            serve_terminal(secure, options.allow_input, options.file_root.clone()).await
        } else {
            serve(
                secure,
                options.fps,
                options.allow_input,
                options.file_root.clone(),
            )
            .await
        };
        break match outcome {
            Ok(()) => "Remote session completed.".to_string(),
            Err(error) => format!("Session ended: {error}"),
        };
    };

    emit_event(
        options.json,
        &AgentEvent::Stopped {
            reason: stop_reason.clone(),
        },
    );
    if !options.json {
        eprintln!("{stop_reason}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, Default)]
    struct MockTerminalChildState {
        running: bool,
        try_waits: usize,
        kills: usize,
        waits: usize,
    }

    #[derive(Clone, Debug)]
    struct MockTerminalChild {
        state: Arc<Mutex<MockTerminalChildState>>,
    }

    impl portable_pty::ChildKiller for MockTerminalChild {
        fn kill(&mut self) -> std::io::Result<()> {
            let mut state = self.state.lock().unwrap();
            state.kills += 1;
            state.running = false;
            Ok(())
        }

        fn clone_killer(&self) -> Box<dyn portable_pty::ChildKiller + Send + Sync> {
            Box::new(self.clone())
        }
    }

    impl portable_pty::Child for MockTerminalChild {
        fn try_wait(&mut self) -> std::io::Result<Option<portable_pty::ExitStatus>> {
            let mut state = self.state.lock().unwrap();
            state.try_waits += 1;
            Ok((!state.running).then(|| portable_pty::ExitStatus::with_exit_code(0)))
        }

        fn wait(&mut self) -> std::io::Result<portable_pty::ExitStatus> {
            let mut state = self.state.lock().unwrap();
            state.waits += 1;
            state.running = false;
            Ok(portable_pty::ExitStatus::with_exit_code(0))
        }

        fn process_id(&self) -> Option<u32> {
            None
        }

        #[cfg(windows)]
        fn as_raw_handle(&self) -> Option<std::os::windows::io::RawHandle> {
            None
        }
    }

    fn mock_terminal_child(
        running: bool,
    ) -> (
        Box<dyn portable_pty::Child + Send + Sync>,
        Arc<Mutex<MockTerminalChildState>>,
    ) {
        let state = Arc::new(Mutex::new(MockTerminalChildState {
            running,
            ..MockTerminalChildState::default()
        }));
        (
            Box::new(MockTerminalChild {
                state: Arc::clone(&state),
            }),
            state,
        )
    }

    #[test]
    fn terminal_child_guard_terminates_and_reaps_on_drop() {
        let (child, state) = mock_terminal_child(true);
        {
            let _guard = TerminalChildGuard::new(child);
        }

        let state = state.lock().unwrap();
        assert_eq!(state.try_waits, 1);
        assert_eq!(state.kills, 1);
        assert_eq!(state.waits, 1);
        assert!(!state.running);
    }

    #[test]
    fn terminal_child_guard_explicit_cleanup_is_not_repeated_on_drop() {
        let (child, state) = mock_terminal_child(true);
        let mut guard = TerminalChildGuard::new(child);
        guard.terminate_and_wait();
        drop(guard);

        let state = state.lock().unwrap();
        assert_eq!(state.try_waits, 1);
        assert_eq!(state.kills, 1);
        assert_eq!(state.waits, 1);
    }

    #[test]
    fn terminal_child_guard_does_not_kill_an_already_exited_child() {
        let (child, state) = mock_terminal_child(false);
        drop(TerminalChildGuard::new(child));

        let state = state.lock().unwrap();
        assert_eq!(state.try_waits, 1);
        assert_eq!(state.kills, 0);
        assert_eq!(state.waits, 0);
    }

    #[tokio::test]
    async fn bounded_input_queue_waits_for_room_and_fails_after_receiver_closes() {
        let (sender, mut receiver) = bounded_input_channel::<usize>(TERMINAL_INPUT_QUEUE_CAPACITY);
        assert_eq!(sender.capacity(), TERMINAL_INPUT_QUEUE_CAPACITY);

        for value in 0..TERMINAL_INPUT_QUEUE_CAPACITY {
            assert!(
                send_input_with_backpressure(&sender, value, REMOTE_INPUT_ENQUEUE_TIMEOUT,).await
            );
        }

        let blocked_sender = sender.clone();
        let blocked = tokio::spawn(async move {
            send_input_with_backpressure(
                &blocked_sender,
                TERMINAL_INPUT_QUEUE_CAPACITY,
                REMOTE_INPUT_ENQUEUE_TIMEOUT,
            )
            .await
        });
        tokio::task::yield_now().await;
        assert!(
            !blocked.is_finished(),
            "the capacity + 1 input must wait instead of growing the queue"
        );

        assert_eq!(receiver.recv().await, Some(0));
        assert!(timeout(Duration::from_secs(1), blocked)
            .await
            .expect("backpressured sender should resume")
            .expect("input sender task should not panic"));

        drop(receiver);
        assert!(
            !send_input_with_backpressure(&sender, usize::MAX, REMOTE_INPUT_ENQUEUE_TIMEOUT,).await
        );

        let (timeout_sender, _timeout_receiver) = bounded_input_channel::<usize>(1);
        assert!(
            send_input_with_backpressure(&timeout_sender, 1, REMOTE_INPUT_ENQUEUE_TIMEOUT).await
        );
        assert!(
            !send_input_with_backpressure(&timeout_sender, 2, Duration::from_millis(10)).await,
            "a full input queue must time out instead of pinning the receive task"
        );

        let (screen_sender, _screen_receiver) =
            bounded_input_channel::<usize>(SCREEN_INPUT_QUEUE_CAPACITY);
        assert_eq!(screen_sender.capacity(), SCREEN_INPUT_QUEUE_CAPACITY);
    }

    #[tokio::test]
    async fn abort_and_wait_drops_task_channels_before_returning() {
        let (sender, mut receiver) = mpsc::channel::<()>(1);
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(async move {
            let _ = started_tx.send(());
            std::future::pending::<()>().await;
            drop(sender);
        });
        started_rx.await.expect("task should start");

        abort_and_wait(task).await;

        assert_eq!(receiver.recv().await, None);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn parses_linux_proc_stat_with_spaces_and_closing_parenthesis_in_comm() {
        let mut fields = vec!["0"; 20];
        fields[0] = "R";
        fields[3] = "4242";
        fields[19] = "987654321";
        let stat = format!("4242 (shell worker ) tricky) {}", fields.join(" "));

        assert_eq!(
            parse_linux_process_identity(4242, &stat),
            Some(LinuxProcessIdentity {
                process_id: 4242,
                session_id: 4242,
                start_time: 987654321,
            })
        );
        assert_eq!(parse_linux_process_identity(4242, "truncated"), None);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn verified_pidfd_keeps_current_process_identity_and_accepts_signal_zero() {
        // SAFETY: getpid has no preconditions or side effects.
        let process_id = unsafe { libc::getpid() };
        let identity = read_linux_process_identity(process_id).expect("read current process stat");
        let descriptor = open_verified_pidfd(identity).expect("open current process pidfd");

        assert_eq!(read_linux_process_identity(process_id), Some(identity));
        assert!(signal_pidfd(&descriptor, 0));
    }

    #[test]
    fn downscales_to_the_stream_boundary() {
        assert_eq!(target_size(1920, 1080), (1280, 720));
        assert_eq!(target_size(1280, 1024), (900, 720));
        assert_eq!(target_size(800, 600), (800, 600));
    }

    #[test]
    fn ready_event_is_machine_readable() {
        let event = AgentEvent::Ready {
            address: "127.0.0.1:44900".to_string(),
            pairing_code: "1234-5678".to_string(),
            expires_in_seconds: 300,
            view_only: true,
            file_transfer: false,
            file_root: None,
            device_id: Some("123456789".to_string()),
            relay: Some("relay.example.com".to_string()),
            persistent: true,
        };
        let json = serde_json::to_value(event).expect("serialize agent event");
        assert_eq!(json["kind"], "ready");
        assert_eq!(json["pairingCode"], "1234-5678");
        assert_eq!(json["deviceId"], "123456789");
        assert_eq!(json["persistent"], true);
    }

    #[test]
    fn pairing_code_sources_cannot_override_each_other() {
        let mut code = None;
        set_pairing_code(&mut code, "1234-5678").unwrap();
        assert_eq!(code.as_deref(), Some("12345678"));
        assert!(set_pairing_code(&mut code, "87654321").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn pairing_code_file_requires_owner_only_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let path =
            std::env::temp_dir().join(format!("lattice-agent-pair-code-{}", std::process::id()));
        std::fs::write(&path, "12345678\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(read_pairing_code_file(&path).unwrap(), "12345678\n");

        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(read_pairing_code_file(&path).is_err());
        let _ = std::fs::remove_file(path);
    }
}
