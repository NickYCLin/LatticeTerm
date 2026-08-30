//! SSH tunnels: local, remote, and dynamic (SOCKS5) port forwarding.
//!
//! Each tunnel owns one authenticated russh session — pure Rust, no external
//! `ssh` binary — and every byte that crosses it really travels through that
//! session. Trust is resolved the same way terminal sessions resolve it: a
//! host whose key is unknown or changed is refused, and the user is pointed at
//! the normal connect flow to settle the fingerprint first.
//!
//! Errors returned to the interface carry a stable `code: detail` prefix
//! (`credential:`, `trust:`, `auth:`, `bind:`, `connect:`, `forward:`) so the
//! frontend can translate the cause without parsing prose.

use crate::hostkeys::{HostKeyRecord, TrustVerdict};
use crate::ssh::TrustingHandler;
use russh::client;
use russh::{Channel, ChannelOpenFailure, Disconnect};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, watch};

const MAX_TUNNEL_ID_BYTES: usize = 128;
const MAX_HOST_BYTES: usize = 253;
const REMOTE_FORWARD_CANCEL_TIMEOUT: Duration = Duration::from_secs(2);
const STOP_WAIT_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TunnelType {
    Local,
    Remote,
    Dynamic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TunnelStatus {
    Stopped,
    Starting,
    Active,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TunnelStatusSummary {
    pub tunnel_id: String,
    pub status: TunnelStatus,
    pub bytes_uploaded: u64,
    pub bytes_downloaded: u64,
    pub active_connections: u32,
    pub started_at: Option<u64>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StartTunnelRequest {
    pub tunnel_id: String,
    pub tunnel_type: TunnelType,
    /// The connection profile whose saved password authenticates the session.
    pub profile_id: String,
    pub local_host: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    #[serde(default)]
    pub ssh_hostname: String,
    #[serde(default)]
    pub ssh_port: u16,
    #[serde(default)]
    pub ssh_username: String,
}

struct ActiveTunnel {
    tunnel_id: String,
    status: TunnelStatus,
    /// Distinguishes this run from an earlier run of the same tunnel id, so a
    /// task left over from before a restart cannot clobber the new state.
    generation: u64,
    bytes_uploaded: Arc<AtomicU64>,
    bytes_downloaded: Arc<AtomicU64>,
    active_connections: Arc<AtomicU32>,
    started_at: Option<u64>,
    /// Shared with the run's tasks so a per-connection failure — a target the
    /// host cannot reach, a refused forward — becomes visible in the status.
    last_error: Arc<Mutex<Option<String>>>,
    stop_tx: Option<broadcast::Sender<()>>,
    /// Becomes true only after the worker has released its listener and SSH
    /// session, so a successful Stop command is a safe restart boundary.
    completion_tx: watch::Sender<bool>,
}

#[derive(Default)]
pub struct TunnelRegistry {
    tunnels: Mutex<HashMap<String, ActiveTunnel>>,
    generations: AtomicU64,
    shutting_down: AtomicBool,
}

/// Atomically claims a tunnel id before any bind, SSH connection, or remote
/// forward is attempted. Dropping an unfinished reservation restores the
/// previous stopped/error summary instead of leaving a phantom Starting row.
struct TunnelStartReservation {
    registry: Arc<TunnelRegistry>,
    tunnel_id: String,
    generation: u64,
    previous: Option<ActiveTunnel>,
    committed: bool,
}

impl TunnelStartReservation {
    fn generation(&self) -> u64 {
        self.generation
    }

    fn commit(mut self, tunnel: ActiveTunnel) -> Result<(), String> {
        if tunnel.tunnel_id != self.tunnel_id || tunnel.generation != self.generation {
            return Err("connect:tunnel start reservation does not match the run".to_string());
        }
        self.registry
            .commit_start(&self.tunnel_id, self.generation, tunnel)?;
        self.previous.take();
        self.committed = true;
        Ok(())
    }
}

impl Drop for TunnelStartReservation {
    fn drop(&mut self) {
        if self.committed {
            return;
        }
        self.registry
            .cancel_start(&self.tunnel_id, self.generation, self.previous.take());
    }
}

impl TunnelRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    fn summarize(tunnel: &ActiveTunnel) -> TunnelStatusSummary {
        TunnelStatusSummary {
            tunnel_id: tunnel.tunnel_id.clone(),
            status: tunnel.status,
            bytes_uploaded: tunnel.bytes_uploaded.load(Ordering::Relaxed),
            bytes_downloaded: tunnel.bytes_downloaded.load(Ordering::Relaxed),
            active_connections: tunnel.active_connections.load(Ordering::Relaxed),
            started_at: tunnel.started_at,
            last_error: tunnel.last_error.lock().ok().and_then(|slot| slot.clone()),
        }
    }

    pub fn status(&self, tunnel_id: &str) -> Option<TunnelStatusSummary> {
        let guard = self.tunnels.lock().ok()?;
        guard.get(tunnel_id).map(Self::summarize)
    }

    pub fn list(&self) -> Vec<TunnelStatusSummary> {
        let guard = match self.tunnels.lock() {
            Ok(g) => g,
            Err(_) => return Vec::new(),
        };
        guard.values().map(Self::summarize).collect()
    }

    fn owns_worker(tunnel: &ActiveTunnel) -> bool {
        tunnel.status == TunnelStatus::Starting || tunnel.stop_tx.is_some()
    }

    fn reserve_start(self: &Arc<Self>, tunnel_id: &str) -> Result<TunnelStartReservation, String> {
        let mut guard = self.tunnels.lock().map_err(|e| e.to_string())?;
        if self.shutting_down.load(Ordering::Acquire) {
            return Err("connect:tunnel registry is shutting down".to_string());
        }
        if guard.get(tunnel_id).is_some_and(Self::owns_worker) {
            return Err(format!("connect:tunnel '{tunnel_id}' is already running"));
        }

        let generation = self.generations.fetch_add(1, Ordering::Relaxed) + 1;
        let previous = guard.remove(tunnel_id);
        let (completion_tx, _) = watch::channel(false);
        guard.insert(
            tunnel_id.to_string(),
            ActiveTunnel {
                tunnel_id: tunnel_id.to_string(),
                status: TunnelStatus::Starting,
                generation,
                bytes_uploaded: Arc::new(AtomicU64::new(0)),
                bytes_downloaded: Arc::new(AtomicU64::new(0)),
                active_connections: Arc::new(AtomicU32::new(0)),
                started_at: None,
                last_error: Arc::new(Mutex::new(None)),
                stop_tx: None,
                completion_tx,
            },
        );

        Ok(TunnelStartReservation {
            registry: Arc::clone(self),
            tunnel_id: tunnel_id.to_string(),
            generation,
            previous,
            committed: false,
        })
    }

    fn commit_start(
        &self,
        tunnel_id: &str,
        generation: u64,
        tunnel: ActiveTunnel,
    ) -> Result<(), String> {
        let mut guard = self.tunnels.lock().map_err(|e| e.to_string())?;
        if self.shutting_down.load(Ordering::Acquire) {
            return Err("connect:tunnel registry is shutting down".to_string());
        }
        let owns_reservation = guard.get(tunnel_id).is_some_and(|current| {
            current.generation == generation && current.status == TunnelStatus::Starting
        });
        if !owns_reservation {
            return Err(format!(
                "connect:tunnel '{tunnel_id}' start reservation was lost"
            ));
        }
        guard.insert(tunnel_id.to_string(), tunnel);
        Ok(())
    }

    fn cancel_start(&self, tunnel_id: &str, generation: u64, previous: Option<ActiveTunnel>) {
        if let Ok(mut guard) = self.tunnels.lock() {
            let owns_reservation = guard.get(tunnel_id).is_some_and(|current| {
                current.generation == generation && current.status == TunnelStatus::Starting
            });
            if !owns_reservation {
                return;
            }
            if let Some(previous) = previous {
                guard.insert(tunnel_id.to_string(), previous);
            } else {
                guard.remove(tunnel_id);
            }
        }
    }

    pub async fn stop(&self, tunnel_id: &str) -> Result<(), String> {
        let mut completion = {
            let mut guard = self.tunnels.lock().map_err(|e| e.to_string())?;
            let Some(tunnel) = guard.get_mut(tunnel_id) else {
                return Err(format!("Tunnel '{tunnel_id}' was not found."));
            };
            if tunnel.status == TunnelStatus::Starting && tunnel.stop_tx.is_none() {
                return Err(format!("connect:tunnel '{tunnel_id}' is still starting"));
            }
            let Some(stop_tx) = tunnel.stop_tx.as_ref() else {
                return Ok(());
            };

            let completion = tunnel.completion_tx.subscribe();
            let _ = stop_tx.send(());
            // Keep stop_tx as the ownership marker until the worker has
            // actually released its listener and SSH session.
            completion
        };

        let already_finished = *completion.borrow();
        if !already_finished {
            tokio::time::timeout(STOP_WAIT_TIMEOUT, completion.changed())
                .await
                .map_err(|_| {
                    format!(
                        "connect:tunnel '{tunnel_id}' did not stop within {} seconds",
                        STOP_WAIT_TIMEOUT.as_secs()
                    )
                })?
                .map_err(|_| format!("connect:tunnel '{tunnel_id}' cleanup signal closed"))?;
        }
        Ok(())
    }

    pub fn stop_all(&self) {
        // Exit cleanup permanently seals this registry. A start which already
        // owns a placeholder may finish its network work, but commit_start
        // will reject it and its reservation will restore the prior summary.
        self.shutting_down.store(true, Ordering::Release);
        if let Ok(mut guard) = self.tunnels.lock() {
            for tunnel in guard.values_mut() {
                if let Some(stop_tx) = tunnel.stop_tx.as_ref() {
                    let _ = stop_tx.send(());
                    tunnel.status = TunnelStatus::Stopped;
                    tunnel.active_connections.store(0, Ordering::Relaxed);
                }
            }
        }
    }

    /// Direct registration is kept for focused registry tests. Production
    /// starts must reserve first so no side effect happens before ownership.
    #[cfg(test)]
    fn register(&self, tunnel: ActiveTunnel) -> Result<u64, String> {
        let generation = tunnel.generation;
        let mut guard = self.tunnels.lock().map_err(|e| e.to_string())?;
        if guard.get(&tunnel.tunnel_id).is_some_and(Self::owns_worker) {
            return Err(format!(
                "connect:tunnel '{}' is already running",
                tunnel.tunnel_id
            ));
        }
        guard.insert(tunnel.tunnel_id.clone(), tunnel);
        Ok(generation)
    }

    /// Marks the end of a run — but only if the entry still belongs to that
    /// run. A tunnel that was restarted in the meantime is left alone.
    fn finish(
        &self,
        tunnel_id: &str,
        generation: u64,
        status: TunnelStatus,
        error: Option<String>,
    ) {
        if let Ok(mut guard) = self.tunnels.lock() {
            if let Some(tunnel) = guard.get_mut(tunnel_id) {
                if tunnel.generation == generation {
                    // The sender is also the registry's running marker. A
                    // worker that ends by itself must clear it; an explicit
                    // Stop also waits for this same cleanup boundary before
                    // allowing a later start.
                    tunnel.stop_tx.take();
                    tunnel.status = status;
                    tunnel.active_connections.store(0, Ordering::Relaxed);
                    if error.is_some() {
                        if let Ok(mut slot) = tunnel.last_error.lock() {
                            *slot = error;
                        }
                    }
                    tunnel.completion_tx.send_replace(true);
                }
            }
        }
    }

    #[cfg(test)]
    fn is_running(&self, tunnel_id: &str) -> bool {
        self.tunnels
            .lock()
            .ok()
            .and_then(|guard| guard.get(tunnel_id).map(Self::owns_worker))
            .unwrap_or(false)
    }
}

fn now_epoch_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Counters and the error slot shared between a tunnel's registry entry and
/// its worker tasks.
#[derive(Clone)]
struct Counters {
    up: Arc<AtomicU64>,
    down: Arc<AtomicU64>,
    connections: Arc<AtomicU32>,
    last_error: Arc<Mutex<Option<String>>>,
    /// The tunnel handler sets this only after russh has shut down the
    /// transport writer (or when the handler is dropped on an error path).
    session_cleanup_tx: watch::Sender<bool>,
}

impl Counters {
    fn new() -> Self {
        let (session_cleanup_tx, _) = watch::channel(false);
        Self {
            up: Arc::new(AtomicU64::new(0)),
            down: Arc::new(AtomicU64::new(0)),
            connections: Arc::new(AtomicU32::new(0)),
            last_error: Arc::new(Mutex::new(None)),
            session_cleanup_tx,
        }
    }

    fn record_error(&self, message: String) {
        if let Ok(mut slot) = self.last_error.lock() {
            *slot = Some(message);
        }
    }

    fn mark_session_cleaned_up(&self) {
        self.session_cleanup_tx.send_replace(true);
    }

    async fn wait_for_session_cleanup(&self) {
        let mut cleanup = self.session_cleanup_tx.subscribe();
        while !*cleanup.borrow_and_update() {
            if cleanup.changed().await.is_err() {
                break;
            }
        }
    }
}

/// Decrements the live-connection count however the connection ends.
struct ConnectionGuard(Arc<AtomicU32>);

impl ConnectionGuard {
    fn open(counter: &Arc<AtomicU32>) -> Self {
        counter.fetch_add(1, Ordering::Relaxed);
        Self(Arc::clone(counter))
    }
}

impl Drop for ConnectionGuard {
    fn drop(&mut self) {
        let _ = self
            .0
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
                Some(current.saturating_sub(1))
            });
    }
}

/// Copies until EOF or error, adding every byte to `counted`.
async fn copy_counted<R, W>(reader: &mut R, writer: &mut W, counted: &AtomicU64)
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut buffer = [0u8; 16384];
    loop {
        match reader.read(&mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                if writer.write_all(&buffer[..n]).await.is_err() {
                    break;
                }
                counted.fetch_add(n as u64, Ordering::Relaxed);
            }
        }
    }
}

/// Moves bytes both ways between a TCP socket and an SSH channel until both
/// directions have closed. Socket-to-channel counts as upload.
async fn pump(socket: TcpStream, channel: Channel<client::Msg>, counters: Counters) {
    let stream = channel.into_stream();
    let (mut channel_read, mut channel_write) = tokio::io::split(stream);
    let (mut socket_read, mut socket_write) = socket.into_split();

    let upload = async {
        copy_counted(&mut socket_read, &mut channel_write, &counters.up).await;
        let _ = channel_write.shutdown().await;
    };
    let download = async {
        copy_counted(&mut channel_read, &mut socket_write, &counters.down).await;
        let _ = socket_write.shutdown().await;
    };

    tokio::join!(upload, download);
}

/// SOCKS5 reply codes, straight from RFC 1928.
const SOCKS_OK: u8 = 0x00;
const SOCKS_GENERAL_FAILURE: u8 = 0x01;
const SOCKS_CONNECTION_REFUSED: u8 = 0x05;
const SOCKS_COMMAND_NOT_SUPPORTED: u8 = 0x07;
const SOCKS_ADDRESS_NOT_SUPPORTED: u8 = 0x08;

async fn socks_reply<S>(socket: &mut S, code: u8) -> bool
where
    S: AsyncWrite + Unpin,
{
    // The bind address in a reply is informational; all-zero IPv4 is standard
    // practice for a proxy that does not expose one.
    socket
        .write_all(&[0x05, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
        .await
        .is_ok()
}

/// Runs the SOCKS5 greeting and CONNECT negotiation, returning the target the
/// client asked for. On protocol violations the appropriate refusal has
/// already been written before `None` is returned.
async fn socks5_read_target<S>(socket: &mut S) -> Option<(String, u16)>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let mut greeting = [0u8; 2];
    socket.read_exact(&mut greeting).await.ok()?;
    if greeting[0] != 0x05 {
        return None;
    }

    let mut methods = vec![0u8; greeting[1] as usize];
    socket.read_exact(&mut methods).await.ok()?;
    if !methods.contains(&0x00) {
        // 0xFF: none of the offered authentication methods are acceptable.
        let _ = socket.write_all(&[0x05, 0xFF]).await;
        return None;
    }
    socket.write_all(&[0x05, 0x00]).await.ok()?;

    let mut request = [0u8; 4];
    socket.read_exact(&mut request).await.ok()?;
    if request[1] != 0x01 {
        socks_reply(socket, SOCKS_COMMAND_NOT_SUPPORTED).await;
        return None;
    }

    let host = match request[3] {
        0x01 => {
            let mut addr = [0u8; 4];
            socket.read_exact(&mut addr).await.ok()?;
            std::net::Ipv4Addr::from(addr).to_string()
        }
        0x03 => {
            let mut len = [0u8; 1];
            socket.read_exact(&mut len).await.ok()?;
            let mut name = vec![0u8; len[0] as usize];
            socket.read_exact(&mut name).await.ok()?;
            match String::from_utf8(name) {
                Ok(name) => name,
                Err(_) => {
                    socks_reply(socket, SOCKS_GENERAL_FAILURE).await;
                    return None;
                }
            }
        }
        0x04 => {
            let mut addr = [0u8; 16];
            socket.read_exact(&mut addr).await.ok()?;
            std::net::Ipv6Addr::from(addr).to_string()
        }
        _ => {
            socks_reply(socket, SOCKS_ADDRESS_NOT_SUPPORTED).await;
            return None;
        }
    };

    let mut port = [0u8; 2];
    socket.read_exact(&mut port).await.ok()?;
    Some((host, u16::from_be_bytes(port)))
}

/// The russh handler for a tunnel session: answers the host key question from
/// the trust store, and — when a remote forward is active — delivers the
/// server's forwarded connections to the configured local target.
struct TunnelHandler {
    trust: TrustingHandler,
    /// `Some` only for remote tunnels: where forwarded connections go.
    forward_target: Option<(String, u16)>,
    counters: Counters,
}

impl Drop for TunnelHandler {
    fn drop(&mut self) {
        // russh skips Handler::disconnected when transport shutdown itself
        // errors. Handler drop is still after its transport halves leave the
        // session runner, so it closes that exceptional cleanup path.
        self.counters.mark_session_cleaned_up();
    }
}

impl client::Handler for TunnelHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        self.trust.check_server_key(server_public_key).await
    }

    async fn disconnected(
        &mut self,
        reason: client::DisconnectReason<Self::Error>,
    ) -> Result<(), Self::Error> {
        // russh invokes this after stream_write.shutdown(). This notification,
        // rather than Handle::is_closed(), is the safe immediate-restart
        // fence for remote forwards whose explicit cancellation timed out.
        self.counters.mark_session_cleaned_up();
        match reason {
            client::DisconnectReason::ReceivedDisconnect(_) => Ok(()),
            client::DisconnectReason::Error(error) => Err(error),
        }
    }

    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: Channel<client::Msg>,
        _connected_address: &str,
        _connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: russh::client::ChannelOpenHandle,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        let Some((host, port)) = self.forward_target.clone() else {
            reply
                .reject(ChannelOpenFailure::AdministrativelyProhibited)
                .await;
            return Ok(());
        };

        let counters = self.counters.clone();
        tokio::spawn(async move {
            match TcpStream::connect((host.as_str(), port)).await {
                Ok(socket) => {
                    reply.accept().await;
                    let _guard = ConnectionGuard::open(&counters.connections);
                    // For a remote tunnel "upload" is what local services send
                    // back toward the remote side, mirroring `ssh -R`.
                    pump(socket, channel, counters).await;
                }
                Err(_) => {
                    counters.record_error(format!(
                        "forward:the local target {host}:{port} is unavailable"
                    ));
                    reply.reject(ChannelOpenFailure::ConnectFailed).await;
                }
            }
        });
        Ok(())
    }
}

/// Turns a recorded trust verdict, or its absence, into the coded error the
/// interface translates.
fn connect_error(verdict: Option<TrustVerdict>, fallback: String) -> String {
    match verdict {
        Some(TrustVerdict::Unknown { fingerprint, .. }) => format!(
            "trust:unknown host key {fingerprint} — connect over SSH once to confirm it first"
        ),
        Some(TrustVerdict::Changed {
            received_fingerprint,
            ..
        }) => format!(
            "trust:host key changed to {received_fingerprint} — resolve it in the SSH connect flow"
        ),
        _ => format!("connect:{fallback}"),
    }
}

fn validate_identifier(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > MAX_TUNNEL_ID_BYTES
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(format!(
            "profile:{label} is missing or contains unsupported characters"
        ));
    }
    Ok(())
}

fn validate_host(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > MAX_HOST_BYTES
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric()
                || matches!(character, '.' | '_' | ':' | '-' | '[' | ']' | '%')
        })
    {
        return Err(format!("connect:{label} is invalid"));
    }
    Ok(())
}

fn validate_request(request: &StartTunnelRequest) -> Result<(), String> {
    validate_identifier(&request.tunnel_id, "tunnel id")?;
    validate_identifier(&request.profile_id, "profile id")?;
    validate_host(&request.ssh_hostname, "SSH hostname")?;
    if request.ssh_port == 0
        || request.ssh_username.trim().is_empty()
        || request.ssh_username.len() > 64
        || request.ssh_username.chars().any(char::is_whitespace)
        || request.ssh_username.chars().any(char::is_control)
    {
        return Err("connect:the SSH endpoint is invalid".to_string());
    }

    let bind_ip = request
        .local_host
        .parse::<IpAddr>()
        .map_err(|_| "bind:the bind address must be an IPv4 or IPv6 literal".to_string())?;
    if request.local_port == 0 {
        return Err("bind:the bind port must be between 1 and 65535".to_string());
    }
    if request.tunnel_type == TunnelType::Dynamic && !bind_ip.is_loopback() {
        return Err(
            "bind:a no-authentication SOCKS5 proxy may only use a loopback address".to_string(),
        );
    }
    if request.tunnel_type != TunnelType::Dynamic {
        validate_host(&request.remote_host, "tunnel target hostname")?;
        if request.remote_port == 0 {
            return Err("connect:the target port must be between 1 and 65535".to_string());
        }
    }
    Ok(())
}

/// Connects and authenticates the tunnel's own SSH session.
async fn open_session(
    request: &StartTunnelRequest,
    password: &str,
    known: Option<HostKeyRecord>,
) -> Result<(client::Handle<TunnelHandler>, Counters), String> {
    let counters = Counters::new();
    let verdict = Arc::new(Mutex::new(None));
    let handler = TunnelHandler {
        trust: TrustingHandler {
            host: request.ssh_hostname.clone(),
            port: request.ssh_port,
            known,
            verdict: Arc::clone(&verdict),
        },
        forward_target: matches!(request.tunnel_type, TunnelType::Remote)
            .then(|| (request.remote_host.clone(), request.remote_port)),
        counters: counters.clone(),
    };

    let config = Arc::new(client::Config {
        // A tunnel is expected to sit idle; keepalives hold the path open
        // instead of an inactivity timeout tearing it down.
        inactivity_timeout: None,
        keepalive_interval: Some(Duration::from_secs(30)),
        ..Default::default()
    });

    let mut session = match client::connect(
        config,
        (request.ssh_hostname.as_str(), request.ssh_port),
        handler,
    )
    .await
    {
        Ok(session) => session,
        Err(error) => {
            let recorded = verdict.lock().ok().and_then(|slot| slot.clone());
            return Err(connect_error(recorded, error.to_string()));
        }
    };

    let authenticated = session
        .authenticate_password(&request.ssh_username, password)
        .await
        .map_err(|error| format!("auth:{error}"))?
        .success();

    if !authenticated {
        return Err("auth:the host rejected the credentials".to_string());
    }

    Ok((session, counters))
}

/// Starts a tunnel: authenticates its SSH session, sets up the forwarding for
/// its type, and registers the run so it can be observed and stopped.
pub async fn start_tunnel(
    registry: Arc<TunnelRegistry>,
    request: StartTunnelRequest,
    password: &str,
    known: Option<HostKeyRecord>,
) -> Result<TunnelStatusSummary, String> {
    validate_request(&request)?;
    // Claim the id before binding or contacting the SSH host. In particular,
    // two concurrent remote-forward starts must not both reach the server and
    // discover the collision only when the registry is updated afterward.
    let reservation = registry.reserve_start(&request.tunnel_id)?;
    let generation = reservation.generation();

    // Bind first: a port squatted by another process should fail fast, before
    // any network round trip to the SSH host.
    let listener = match request.tunnel_type {
        TunnelType::Local | TunnelType::Dynamic => Some(
            TcpListener::bind((request.local_host.as_str(), request.local_port))
                .await
                .map_err(|err| {
                    format!(
                        "bind:cannot listen on {}:{}: {err}",
                        request.local_host, request.local_port
                    )
                })?,
        ),
        TunnelType::Remote => None,
    };

    let (session, counters) = open_session(&request, password, known).await?;
    // Shared because every forwarded connection opens its own channel; all
    // post-authentication operations take `&self`.
    let session = Arc::new(session);

    if matches!(request.tunnel_type, TunnelType::Remote) {
        session
            .tcpip_forward(request.local_host.clone(), u32::from(request.local_port))
            .await
            .map_err(|error| format!("forward:the host refused the remote forward: {error}"))?;
    }

    let (stop_tx, mut stop_rx) = broadcast::channel(1);
    let (completion_tx, _) = watch::channel(false);
    let started_at = Some(now_epoch_secs());

    reservation.commit(ActiveTunnel {
        tunnel_id: request.tunnel_id.clone(),
        status: TunnelStatus::Active,
        generation,
        bytes_uploaded: Arc::clone(&counters.up),
        bytes_downloaded: Arc::clone(&counters.down),
        active_connections: Arc::clone(&counters.connections),
        started_at,
        last_error: Arc::clone(&counters.last_error),
        stop_tx: Some(stop_tx),
        completion_tx,
    })?;

    let summary = TunnelStatusSummary {
        tunnel_id: request.tunnel_id.clone(),
        status: TunnelStatus::Active,
        bytes_uploaded: 0,
        bytes_downloaded: 0,
        active_connections: 0,
        started_at,
        last_error: None,
    };

    let registry_task = Arc::clone(&registry);
    tokio::spawn(async move {
        let mut health = tokio::time::interval(Duration::from_secs(10));
        health.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut outcome: (TunnelStatus, Option<String>) = (TunnelStatus::Stopped, None);

        loop {
            let accept = async {
                match &listener {
                    Some(listener) => Some(listener.accept().await),
                    // A remote tunnel has nothing to accept locally; its
                    // connections arrive through the session handler.
                    None => std::future::pending().await,
                }
            };

            tokio::select! {
                _ = stop_rx.recv() => break,
                _ = health.tick() => {
                    if session.is_closed() {
                        outcome = (
                            TunnelStatus::Error,
                            Some("connect:the SSH connection dropped".to_string()),
                        );
                        break;
                    }
                }
                accepted = accept => match accepted {
                    Some(Ok((socket, peer))) => {
                        spawn_connection(&session, &request, socket, peer, counters.clone());
                    }
                    Some(Err(error)) => {
                        outcome = (
                            TunnelStatus::Error,
                            Some(format!("bind:the listener failed: {error}")),
                        );
                        break;
                    }
                    None => unreachable!("pending() never resolves"),
                }
            }
        }

        // Release a local/dynamic bind before publishing the restartable
        // terminal status. Without this explicit ordering, an immediate
        // restart can race the worker closure dropping its listener.
        drop(listener);

        // A remote forwarding request survives independently on the SSH
        // server until it is explicitly cancelled or the session is truly
        // closed. Bound the polite cancellation request, then disconnect and
        // retain registry ownership until russh confirms that its session
        // task has closed. Handle::disconnect only enqueues a message.
        if request.tunnel_type == TunnelType::Remote && !session.is_closed() {
            let _ = tokio::time::timeout(
                REMOTE_FORWARD_CANCEL_TIMEOUT,
                session.cancel_tcpip_forward(
                    request.local_host.clone(),
                    u32::from(request.local_port),
                ),
            )
            .await;
        }
        let _ = session
            .disconnect(Disconnect::ByApplication, "tunnel stopped", "")
            .await;
        counters.wait_for_session_cleanup().await;
        registry_task.finish(&request.tunnel_id, generation, outcome.0, outcome.1);
    });

    Ok(summary)
}

/// Handles one accepted local connection according to the tunnel type.
fn spawn_connection(
    session: &Arc<client::Handle<TunnelHandler>>,
    request: &StartTunnelRequest,
    mut socket: TcpStream,
    peer: std::net::SocketAddr,
    counters: Counters,
) {
    let session = Arc::clone(session);
    let tunnel_type = request.tunnel_type;
    let remote_host = request.remote_host.clone();
    let remote_port = request.remote_port;

    tokio::spawn(async move {
        let _guard = ConnectionGuard::open(&counters.connections);

        match tunnel_type {
            TunnelType::Local => {
                match session
                    .channel_open_direct_tcpip(
                        remote_host.clone(),
                        u32::from(remote_port),
                        peer.ip().to_string(),
                        u32::from(peer.port()),
                    )
                    .await
                {
                    Ok(channel) => pump(socket, channel, counters).await,
                    Err(error) => {
                        // The user sees a connection that opens and instantly
                        // dies; the status has to say why. A host with
                        // AllowTcpForwarding off lands here.
                        counters.record_error(format!(
                            "connect:the host would not forward to {remote_host}:{remote_port}: {error}"
                        ));
                    }
                }
            }
            TunnelType::Dynamic => {
                let Some((target_host, target_port)) = socks5_read_target(&mut socket).await else {
                    return;
                };
                let target_host_label = format!("{target_host}:{target_port}");
                match session
                    .channel_open_direct_tcpip(
                        target_host,
                        u32::from(target_port),
                        peer.ip().to_string(),
                        u32::from(peer.port()),
                    )
                    .await
                {
                    Ok(channel) => {
                        if socks_reply(&mut socket, SOCKS_OK).await {
                            pump(socket, channel, counters).await;
                        }
                    }
                    Err(error) => {
                        counters.record_error(format!(
                            "connect:the host would not open a connection to {target_host_label}: {error}"
                        ));
                        socks_reply(&mut socket, SOCKS_CONNECTION_REFUSED).await;
                    }
                }
            }
            // Remote connections never arrive through the local listener.
            TunnelType::Remote => {}
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use russh::client::Handler as _;

    fn entry(tunnel_id: &str, generation: u64) -> ActiveTunnel {
        let (completion_tx, _) = watch::channel(false);
        ActiveTunnel {
            tunnel_id: tunnel_id.to_string(),
            status: TunnelStatus::Active,
            generation,
            bytes_uploaded: Arc::new(AtomicU64::new(0)),
            bytes_downloaded: Arc::new(AtomicU64::new(0)),
            active_connections: Arc::new(AtomicU32::new(0)),
            started_at: Some(1),
            last_error: Arc::new(Mutex::new(None)),
            stop_tx: Some(broadcast::channel(1).0),
            completion_tx,
        }
    }

    fn request(tunnel_type: TunnelType) -> StartTunnelRequest {
        StartTunnelRequest {
            tunnel_id: "tunnel-1".to_string(),
            tunnel_type,
            profile_id: "profile-1".to_string(),
            local_host: "127.0.0.1".to_string(),
            local_port: 8080,
            remote_host: "db.internal".to_string(),
            remote_port: 5432,
            ssh_hostname: "gateway.internal".to_string(),
            ssh_port: 22,
            ssh_username: "operator".to_string(),
        }
    }

    #[tokio::test]
    async fn handler_disconnection_opens_the_transport_cleanup_fence() {
        let counters = Counters::new();
        let waiting_counters = counters.clone();
        let waiting = tokio::spawn(async move {
            waiting_counters.wait_for_session_cleanup().await;
        });
        tokio::task::yield_now().await;
        assert!(!waiting.is_finished());

        let mut handler = TunnelHandler {
            trust: TrustingHandler {
                host: "gateway.internal".into(),
                port: 22,
                known: None,
                verdict: Arc::new(Mutex::new(None)),
            },
            forward_target: None,
            counters,
        };
        handler
            .disconnected(client::DisconnectReason::ReceivedDisconnect(
                client::RemoteDisconnectInfo {
                    reason_code: Disconnect::ByApplication,
                    message: "done".into(),
                    lang_tag: String::new(),
                },
            ))
            .await
            .unwrap();

        tokio::time::timeout(Duration::from_secs(1), waiting)
            .await
            .expect("cleanup waiter should be released")
            .expect("cleanup waiter should not panic");
    }

    #[tokio::test]
    async fn stop_waits_for_worker_cleanup_before_allowing_a_restart() {
        let registry = Arc::new(TunnelRegistry::new());
        let active = entry("t1", 1);
        let mut stop_rx = active.stop_tx.as_ref().unwrap().subscribe();
        registry.register(active).unwrap();
        registry.generations.store(1, Ordering::Relaxed);

        let stopping_registry = Arc::clone(&registry);
        let stopping = tokio::spawn(async move { stopping_registry.stop("t1").await });
        tokio::time::timeout(Duration::from_secs(1), stop_rx.recv())
            .await
            .expect("stop request should reach the worker")
            .expect("stop signal should remain open");

        // Stop has returned a signal, but restart remains blocked until the
        // worker confirms that its listener and SSH session are gone.
        assert_eq!(registry.status("t1").unwrap().status, TunnelStatus::Active);
        assert!(registry.is_running("t1"));
        assert!(registry.reserve_start("t1").is_err());

        registry.finish("t1", 1, TunnelStatus::Stopped, None);
        stopping.await.unwrap().unwrap();
        assert!(!registry.is_running("t1"));

        let restart = registry.reserve_start("t1").unwrap();
        assert_eq!(restart.generation(), 2);
    }

    #[test]
    fn shutdown_seals_starts_without_losing_a_reserved_previous_summary() {
        let registry = Arc::new(TunnelRegistry::new());
        registry.register(entry("t1", 7)).unwrap();
        registry.finish(
            "t1",
            7,
            TunnelStatus::Error,
            Some("connect:old failure".into()),
        );
        registry.generations.store(7, Ordering::Relaxed);

        let reservation = registry.reserve_start("t1").unwrap();
        let generation = reservation.generation();
        registry.stop_all();

        assert_eq!(
            registry.status("t1").unwrap().status,
            TunnelStatus::Starting
        );
        assert!(reservation.commit(entry("t1", generation)).is_err());

        let restored = registry.status("t1").unwrap();
        assert_eq!(restored.status, TunnelStatus::Error);
        assert_eq!(restored.last_error.as_deref(), Some("connect:old failure"));
        assert!(registry.reserve_start("t2").is_err());
    }

    #[tokio::test]
    async fn stopping_an_unknown_tunnel_reports_it() {
        let registry = TunnelRegistry::new();
        assert!(registry
            .stop("missing")
            .await
            .unwrap_err()
            .contains("missing"));
    }

    #[test]
    fn a_stale_run_cannot_overwrite_a_restarted_tunnel() {
        let registry = TunnelRegistry::new();
        registry.register(entry("t1", 1)).unwrap();
        registry.finish("t1", 1, TunnelStatus::Stopped, None);
        // The tunnel restarts: same id, new generation.
        registry.register(entry("t1", 2)).unwrap();

        // The first run's task finishes late and tries to record its ending.
        registry.finish("t1", 1, TunnelStatus::Error, Some("stale".into()));

        let status = registry.status("t1").unwrap();
        assert_eq!(status.status, TunnelStatus::Active);
        assert!(status.last_error.is_none());
        assert!(registry.is_running("t1"));

        // The current run's ending is still recorded normally.
        registry.finish("t1", 2, TunnelStatus::Stopped, None);
        assert_eq!(registry.status("t1").unwrap().status, TunnelStatus::Stopped);
        assert!(!registry.is_running("t1"));
    }

    #[test]
    fn a_run_that_ends_with_an_error_can_restart() {
        let registry = TunnelRegistry::new();
        registry.register(entry("t1", 1)).unwrap();

        registry.finish(
            "t1",
            1,
            TunnelStatus::Error,
            Some("connect:the SSH connection dropped".into()),
        );

        let failed = registry.status("t1").unwrap();
        assert_eq!(failed.status, TunnelStatus::Error);
        assert_eq!(
            failed.last_error.as_deref(),
            Some("connect:the SSH connection dropped")
        );
        assert!(!registry.is_running("t1"));

        registry.register(entry("t1", 2)).unwrap();
        assert!(registry.is_running("t1"));
        assert_eq!(registry.status("t1").unwrap().status, TunnelStatus::Active);
    }

    #[test]
    fn a_start_reservation_blocks_concurrent_side_effects_and_cleans_up() {
        let registry = Arc::new(TunnelRegistry::new());
        let reservation = registry.reserve_start("t1").unwrap();

        assert!(registry.is_running("t1"));
        assert_eq!(
            registry.status("t1").unwrap().status,
            TunnelStatus::Starting
        );
        assert!(registry.reserve_start("t1").is_err());
        assert!(registry.register(entry("t1", 99)).is_err());

        drop(reservation);
        assert!(!registry.is_running("t1"));
        assert!(registry.status("t1").is_none());
    }

    #[test]
    fn a_failed_start_restores_the_previous_terminal_summary() {
        let registry = Arc::new(TunnelRegistry::new());
        registry.register(entry("t1", 7)).unwrap();
        registry.finish(
            "t1",
            7,
            TunnelStatus::Error,
            Some("connect:old failure".into()),
        );
        registry.generations.store(7, Ordering::Relaxed);

        let reservation = registry.reserve_start("t1").unwrap();
        assert_eq!(
            registry.status("t1").unwrap().status,
            TunnelStatus::Starting
        );
        drop(reservation);

        let restored = registry.status("t1").unwrap();
        assert_eq!(restored.status, TunnelStatus::Error);
        assert_eq!(restored.last_error.as_deref(), Some("connect:old failure"));
    }

    #[test]
    fn only_the_matching_reservation_can_publish_an_active_run() {
        let registry = Arc::new(TunnelRegistry::new());
        let reservation = registry.reserve_start("t1").unwrap();
        let generation = reservation.generation();

        reservation.commit(entry("t1", generation)).unwrap();

        assert!(registry.is_running("t1"));
        assert_eq!(registry.status("t1").unwrap().status, TunnelStatus::Active);
    }

    #[test]
    fn a_running_tunnel_cannot_be_replaced_by_a_concurrent_start() {
        let registry = TunnelRegistry::new();
        registry.register(entry("t1", 1)).unwrap();
        assert!(registry.register(entry("t1", 2)).is_err());
        let guard = registry.tunnels.lock().unwrap();
        assert_eq!(guard.get("t1").unwrap().generation, 1);
    }

    #[test]
    fn unsafe_ids_and_public_no_auth_socks_bindings_are_rejected() {
        let mut unsafe_id = request(TunnelType::Local);
        unsafe_id.tunnel_id = "../tunnel".to_string();
        assert!(validate_request(&unsafe_id).is_err());

        let mut public_socks = request(TunnelType::Dynamic);
        public_socks.local_host = "0.0.0.0".to_string();
        assert!(validate_request(&public_socks).is_err());
    }

    #[test]
    fn a_connection_guard_cannot_underflow_after_stop_resets_the_counter() {
        let counter = Arc::new(AtomicU32::new(0));
        let guard = ConnectionGuard::open(&counter);
        counter.store(0, Ordering::Relaxed);
        drop(guard);
        assert_eq!(counter.load(Ordering::Relaxed), 0);
    }

    #[tokio::test]
    async fn socks5_connect_to_an_ipv4_address_is_parsed() {
        let (mut client, mut server) = tokio::io::duplex(256);

        let negotiation = tokio::spawn(async move { socks5_read_target(&mut server).await });

        // Greeting: version 5, one method, no-auth.
        client.write_all(&[0x05, 0x01, 0x00]).await.unwrap();
        let mut chosen = [0u8; 2];
        client.read_exact(&mut chosen).await.unwrap();
        assert_eq!(chosen, [0x05, 0x00]);

        // CONNECT 10.1.2.3:443 over IPv4.
        client
            .write_all(&[0x05, 0x01, 0x00, 0x01, 10, 1, 2, 3, 0x01, 0xBB])
            .await
            .unwrap();

        let target = negotiation.await.unwrap();
        assert_eq!(target, Some(("10.1.2.3".to_string(), 443)));
    }

    #[tokio::test]
    async fn socks5_connect_to_a_domain_name_is_parsed() {
        let (mut client, mut server) = tokio::io::duplex(256);

        let negotiation = tokio::spawn(async move { socks5_read_target(&mut server).await });

        client.write_all(&[0x05, 0x01, 0x00]).await.unwrap();
        let mut chosen = [0u8; 2];
        client.read_exact(&mut chosen).await.unwrap();

        let mut request = vec![0x05, 0x01, 0x00, 0x03, 11];
        request.extend_from_slice(b"example.com");
        request.extend_from_slice(&80u16.to_be_bytes());
        client.write_all(&request).await.unwrap();

        let target = negotiation.await.unwrap();
        assert_eq!(target, Some(("example.com".to_string(), 80)));
    }

    #[tokio::test]
    async fn socks5_refuses_commands_other_than_connect() {
        let (mut client, mut server) = tokio::io::duplex(256);

        let negotiation = tokio::spawn(async move { socks5_read_target(&mut server).await });

        client.write_all(&[0x05, 0x01, 0x00]).await.unwrap();
        let mut chosen = [0u8; 2];
        client.read_exact(&mut chosen).await.unwrap();

        // BIND (0x02) is not supported.
        client
            .write_all(&[0x05, 0x02, 0x00, 0x01, 127, 0, 0, 1, 0x00, 0x50])
            .await
            .unwrap();

        assert_eq!(negotiation.await.unwrap(), None);

        let mut reply = [0u8; 10];
        client.read_exact(&mut reply).await.unwrap();
        assert_eq!(reply[1], SOCKS_COMMAND_NOT_SUPPORTED);
    }

    #[tokio::test]
    async fn socks5_refuses_clients_that_cannot_skip_authentication() {
        let (mut client, mut server) = tokio::io::duplex(256);

        let negotiation = tokio::spawn(async move { socks5_read_target(&mut server).await });

        // Only username/password (0x02) offered; this proxy needs no-auth.
        client.write_all(&[0x05, 0x01, 0x02]).await.unwrap();

        assert_eq!(negotiation.await.unwrap(), None);

        let mut refusal = [0u8; 2];
        client.read_exact(&mut refusal).await.unwrap();
        assert_eq!(refusal, [0x05, 0xFF]);
    }

    #[tokio::test]
    async fn counted_copy_records_every_byte() {
        let counter = AtomicU64::new(0);
        let mut source: &[u8] = b"twelve bytes";
        let mut sink_buffer = Vec::new();

        copy_counted(&mut source, &mut sink_buffer, &counter).await;

        assert_eq!(sink_buffer, b"twelve bytes");
        assert_eq!(counter.load(Ordering::Relaxed), 12);
    }

    #[test]
    fn a_missing_verdict_reports_the_transport_error() {
        let error = connect_error(None, "connection refused".into());
        assert_eq!(error, "connect:connection refused");
    }

    #[test]
    fn an_unknown_host_key_is_a_trust_error_not_a_transport_error() {
        let error = connect_error(
            Some(TrustVerdict::Unknown {
                host: "gateway.example.com".into(),
                port: 22,
                algorithm: "ssh-ed25519".into(),
                fingerprint: "SHA256:abc".into(),
            }),
            "unused".into(),
        );
        assert!(error.starts_with("trust:"));
        assert!(error.contains("SHA256:abc"));
    }
}
