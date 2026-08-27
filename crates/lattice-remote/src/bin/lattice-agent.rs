use image::{imageops::FilterType, DynamicImage};
use lattice_remote::relay::{
    format_device_id, parse_relay_address, read_server_message, write_client_message,
    DeviceIdentity, RelayClientMessage, RelayServerMessage,
};
use lattice_remote::{
    frame_messages, generate_pairing_code, host_files::HostUpload, host_files::SharedFiles,
    host_input::InputInjector, normalize_pairing_code, FrameFormat, RemoteFileRequest,
    RemoteFileResponse, RemoteHello, RemoteMessage, SecureConnection, DEFAULT_PORT,
    FILE_CHUNK_SIZE, MAX_FILE_ERROR_BYTES, PROTOCOL_VERSION,
};
use serde::Serialize;
use std::collections::{hash_map::Entry, HashMap};
use std::env;
use std::io::{Cursor, Write as _};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
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
Usage: lattice-agent [--bind ADDRESS:PORT] [--relay HOST[:PORT]] [--identity FILE]\n\
                     [--pair-code 1234-5678] [--fps 1-10] [--allow-input]\n\
                     [--file-root PATH] [--json]\n\n\
Direct mode (default): the safe default listens on 127.0.0.1 only. To receive\n\
a LAN connection, pass the machine's LAN address explicitly, for example\n\
--bind 192.168.1.20:44900. The agent accepts one successfully paired\n\
connection, streams the primary display over an encrypted channel, then exits.\n\n\
Relay mode: --relay connects outward to a lattice-relay server and registers\n\
this machine's permanent nine-digit device ID (kept in --identity, default\n\
under the user data folder). A viewer then reaches this machine by ID alone;\n\
the pairing code still authenticates every session end to end, the relay only\n\
forwards ciphertext, and the agent keeps serving sessions until stopped.\n\n\
By default the session is view-only. Pass --allow-input to let the paired\n\
viewer control this machine's mouse and keyboard; without it, input messages\n\
are ignored. File access stays disabled unless --file-root explicitly shares\n\
one folder; every remote path is then confined to that folder.\n"
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
    let mut arguments = env::args().skip(1);

    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--relay" => {
                let address = arguments
                    .next()
                    .ok_or_else(|| "--relay needs HOST or HOST:PORT".to_string())?;
                parse_relay_address(&address).map_err(|error| error.to_string())?;
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
                pairing_code = Some(
                    normalize_pairing_code(
                        &arguments
                            .next()
                            .ok_or_else(|| "--pair-code needs eight digits".to_string())?,
                    )
                    .map_err(|error| error.to_string())?,
                );
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
    mut inputs: mpsc::UnboundedReceiver<lattice_remote::RemoteInput>,
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

async fn serve(
    connection: SecureConnection,
    fps: u32,
    allow_input: bool,
    file_root: Option<PathBuf>,
) -> Result<(), String> {
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

    writer_half
        .send(&RemoteMessage::Hello(RemoteHello {
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
        }))
        .await
        .map_err(|error| error.to_string())?;

    // One bounded writer queue serialises frames and file responses on the
    // Noise send state while applying backpressure to large downloads.
    let (outgoing, mut outgoing_rx) = mpsc::channel::<RemoteMessage>(128);
    let writer = tokio::spawn(async move {
        while let Some(message) = outgoing_rx.recv().await {
            if writer_half.send(&message).await.is_err() {
                break;
            }
        }
    });

    // Receiving runs on its own task. Input remains independently authorised;
    // file messages are accepted only when an explicit shared root exists.
    let (input_tx, input_thread) = if allow_input {
        let (tx, rx) = mpsc::unbounded_channel();
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

    let receiver_files = shared_files.clone();
    let receiver_outgoing = outgoing.clone();
    let active_downloads = Arc::new(Mutex::new(HashMap::<u64, Arc<AtomicBool>>::new()));
    let receiver_downloads = Arc::clone(&active_downloads);
    let receiver = tokio::spawn(async move {
        let mut uploads = HashMap::<u64, HostUpload>::new();
        loop {
            match reader.receive().await {
                Ok(RemoteMessage::Input(input)) => {
                    if let Some(tx) = &input_tx {
                        if tx.send(input).is_err() {
                            break;
                        }
                    }
                }
                Ok(RemoteMessage::FileRequest(request)) => match request {
                    RemoteFileRequest::List { request_id, path } => {
                        if let Some(files) = &receiver_files {
                            spawn_directory_list(
                                Arc::clone(files),
                                request_id,
                                path,
                                receiver_outgoing.clone(),
                            );
                        } else {
                            let _ = receiver_outgoing
                                .send(file_error(request_id, "File sharing is not enabled."))
                                .await;
                        }
                    }
                    RemoteFileRequest::Download { transfer_id, path } => {
                        if let Some(files) = &receiver_files {
                            let cancelled = Arc::new(AtomicBool::new(false));
                            let inserted = receiver_downloads
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
                                    receiver_outgoing.clone(),
                                    cancelled,
                                    Arc::clone(&receiver_downloads),
                                );
                            } else {
                                let _ = receiver_outgoing
                                    .send(file_error(
                                        transfer_id,
                                        "The download identifier is already active.",
                                    ))
                                    .await;
                            }
                        } else {
                            let _ = receiver_outgoing
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
                        let result = receiver_files
                            .as_ref()
                            .ok_or_else(|| "File sharing is not enabled.".to_string())
                            .and_then(|files| {
                                if uploads.contains_key(&transfer_id) {
                                    return Err(
                                        "The upload identifier is already active.".to_string()
                                    );
                                }
                                files.begin_upload(transfer_id, &path, size, overwrite)
                            });
                        match result {
                            Ok(upload) => {
                                uploads.insert(transfer_id, upload);
                                let _ = receiver_outgoing
                                    .send(RemoteMessage::FileResponse(
                                        RemoteFileResponse::UploadReady { transfer_id },
                                    ))
                                    .await;
                            }
                            Err(error) => {
                                let _ =
                                    receiver_outgoing.send(file_error(transfer_id, error)).await;
                            }
                        }
                    }
                    RemoteFileRequest::UploadChunk { transfer_id, bytes } => {
                        let result = uploads
                            .get_mut(&transfer_id)
                            .ok_or_else(|| "The upload is not active.".to_string())
                            .and_then(|upload| upload.write_chunk(&bytes).map(|_| ()));
                        if let Err(error) = result {
                            uploads.remove(&transfer_id);
                            let _ = receiver_outgoing.send(file_error(transfer_id, error)).await;
                        }
                    }
                    RemoteFileRequest::UploadFinish { transfer_id } => {
                        let result = uploads
                            .remove(&transfer_id)
                            .ok_or_else(|| "The upload is not active.".to_string())
                            .and_then(HostUpload::finish);
                        let response = match result {
                            Ok(()) => RemoteMessage::FileResponse(RemoteFileResponse::Complete {
                                transfer_id,
                            }),
                            Err(error) => file_error(transfer_id, error),
                        };
                        let _ = receiver_outgoing.send(response).await;
                    }
                    RemoteFileRequest::Cancel { transfer_id } => {
                        uploads.remove(&transfer_id);
                        if let Some(cancelled) = receiver_downloads
                            .lock()
                            .ok()
                            .and_then(|mut active| active.remove(&transfer_id))
                        {
                            cancelled.store(true, Ordering::Relaxed);
                        }
                        let _ = receiver_outgoing
                            .send(RemoteMessage::FileResponse(RemoteFileResponse::Complete {
                                transfer_id,
                            }))
                            .await;
                    }
                },
                Ok(RemoteMessage::Close(_)) | Err(_) => break,
                Ok(_) => {}
            }
        }
        // Dropping the sender ends the input thread and releases held keys.
        drop(input_tx);
        if let Ok(mut active) = receiver_downloads.lock() {
            for (_, cancelled) in active.drain() {
                cancelled.store(true, Ordering::Relaxed);
            }
        }
        if let Some(handle) = input_thread {
            let _ = handle.join();
        }
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
        for message in frame_messages(frame_id, width, height, FrameFormat::Jpeg, &capture.jpeg)
            .map_err(|error| error.to_string())?
        {
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
        capture = capture_jpeg(&monitor)?;
        width = capture.stream_width;
        height = capture.stream_height;
    };

    receiver.abort();
    drop(outgoing);
    writer.abort();
    stream_result
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
    relay_host: String,
    relay_port: u16,
    channel_id: String,
    identity: DeviceIdentity,
    options: Options,
) -> SessionOutcome {
    let mut stream = match TcpStream::connect((relay_host.as_str(), relay_port)).await {
        Ok(stream) => stream,
        Err(error) => return SessionOutcome::Ended(format!("Could not reach the relay: {error}")),
    };
    let _ = stream.set_nodelay(true);
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
    let secure = match timeout(
        Duration::from_secs(10),
        SecureConnection::accept(stream, &options.pairing_code),
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
    match serve(secure, options.fps, options.allow_input, options.file_root).await {
        Ok(()) => SessionOutcome::Ended("Remote session completed.".to_string()),
        Err(error) => SessionOutcome::Ended(format!("Session ended: {error}")),
    }
}

/// Relay mode: register the permanent device ID, then keep serving sessions
/// until stopped. The control link reconnects with backoff; a session in
/// flight rides its own connection and survives a control drop.
async fn run_relay(options: &Options) -> String {
    let relay_raw = options.relay.clone().expect("relay mode requires --relay");
    let (relay_host, relay_port) = match parse_relay_address(&relay_raw) {
        Ok(address) => address,
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
            let stream = TcpStream::connect((relay_host.as_str(), relay_port))
                .await
                .map_err(|error| error.to_string())?;
            let _ = stream.set_nodelay(true);
            let (mut read_half, mut write_half) = stream.into_split();
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
                        relay_host.clone(),
                        relay_port,
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
        break match serve(
            secure,
            options.fps,
            options.allow_input,
            options.file_root.clone(),
        )
        .await
        {
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
}
