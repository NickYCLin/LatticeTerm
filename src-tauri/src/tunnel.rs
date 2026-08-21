//! Native SSH tunnel runtime.
//!
//! Local and SOCKS5 listeners open `direct-tcpip` channels through russh. Remote
//! forwarding asks the SSH server for `tcpip-forward` and bridges each incoming
//! channel to the configured target on this machine. Host trust and credentials
//! are resolved by the Tauri command before this module is entered.

use crate::hostkeys::{HostKeyRecord, TrustVerdict};
use russh::client::{self, ChannelOpenHandle, Msg, Session};
use russh::keys::ssh_key;
use russh::{Channel, ChannelOpenFailure, Disconnect};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use zeroize::Zeroizing;

const MAX_TUNNEL_ID_BYTES: usize = 128;
const MAX_HOST_BYTES: usize = 253;
const MAX_SOCKS_METHODS: usize = 32;

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

/// Secret-free request from the WebView. SSH connection metadata is resolved
/// from the stored profile on the Rust side so a credential cannot be paired
/// with a different host by altering IPC arguments.
#[derive(Debug, Clone, Deserialize)]
pub struct StartTunnelRequest {
    pub tunnel_id: String,
    pub tunnel_type: TunnelType,
    pub profile_id: String,
    pub local_host: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
}

#[derive(Debug, Clone)]
pub struct SshTunnelEndpoint {
    pub hostname: String,
    pub port: u16,
    pub username: String,
}

#[derive(Default)]
struct TunnelMetrics {
    bytes_uploaded: AtomicU64,
    bytes_downloaded: AtomicU64,
    active_connections: AtomicU32,
}

struct ActiveTunnel {
    tunnel_id: String,
    status: TunnelStatus,
    metrics: Arc<TunnelMetrics>,
    started_at: Option<u64>,
    last_error: Arc<Mutex<Option<String>>>,
    stop_tx: Option<broadcast::Sender<()>>,
}

#[derive(Default)]
pub struct TunnelRegistry {
    tunnels: Mutex<HashMap<String, ActiveTunnel>>,
}

impl TunnelRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    fn summary(tunnel: &ActiveTunnel) -> TunnelStatusSummary {
        TunnelStatusSummary {
            tunnel_id: tunnel.tunnel_id.clone(),
            status: tunnel.status,
            bytes_uploaded: tunnel.metrics.bytes_uploaded.load(Ordering::Relaxed),
            bytes_downloaded: tunnel.metrics.bytes_downloaded.load(Ordering::Relaxed),
            active_connections: tunnel.metrics.active_connections.load(Ordering::Relaxed),
            started_at: tunnel.started_at,
            last_error: tunnel
                .last_error
                .lock()
                .ok()
                .and_then(|error| error.clone()),
        }
    }

    pub fn status(&self, tunnel_id: &str) -> Option<TunnelStatusSummary> {
        let guard = self.tunnels.lock().ok()?;
        guard.get(tunnel_id).map(Self::summary)
    }

    pub fn list(&self) -> Vec<TunnelStatusSummary> {
        let guard = match self.tunnels.lock() {
            Ok(guard) => guard,
            Err(_) => return Vec::new(),
        };
        let mut tunnels = guard.values().map(Self::summary).collect::<Vec<_>>();
        tunnels.sort_by(|left, right| left.tunnel_id.cmp(&right.tunnel_id));
        tunnels
    }

    fn reserve(
        &self,
        tunnel_id: &str,
        metrics: Arc<TunnelMetrics>,
        last_error: Arc<Mutex<Option<String>>>,
    ) -> Result<(), String> {
        let mut guard = self.tunnels.lock().map_err(|error| error.to_string())?;
        if guard.get(tunnel_id).is_some_and(|tunnel| {
            matches!(tunnel.status, TunnelStatus::Starting | TunnelStatus::Active)
        }) {
            return Err(format!("Tunnel '{tunnel_id}' is already running."));
        }
        guard.insert(
            tunnel_id.to_string(),
            ActiveTunnel {
                tunnel_id: tunnel_id.to_string(),
                status: TunnelStatus::Starting,
                metrics,
                started_at: None,
                last_error,
                stop_tx: None,
            },
        );
        Ok(())
    }

    fn activate(
        &self,
        tunnel_id: &str,
        started_at: u64,
        stop_tx: broadcast::Sender<()>,
    ) -> Result<(), String> {
        let mut guard = self.tunnels.lock().map_err(|error| error.to_string())?;
        let tunnel = guard
            .get_mut(tunnel_id)
            .ok_or_else(|| format!("Tunnel '{tunnel_id}' was cancelled before it started."))?;
        if tunnel.status != TunnelStatus::Starting {
            return Err(format!(
                "Tunnel '{tunnel_id}' was cancelled before it started."
            ));
        }
        tunnel.status = TunnelStatus::Active;
        tunnel.started_at = Some(started_at);
        tunnel.stop_tx = Some(stop_tx);
        Ok(())
    }

    fn fail(&self, tunnel_id: &str, error: impl Into<String>) {
        let error = error.into();
        if let Ok(mut guard) = self.tunnels.lock() {
            if let Some(tunnel) = guard.get_mut(tunnel_id) {
                tunnel.status = TunnelStatus::Error;
                tunnel.stop_tx = None;
                if let Ok(mut last_error) = tunnel.last_error.lock() {
                    *last_error = Some(error);
                }
            }
        }
    }

    fn finish(&self, tunnel_id: &str, unexpected_error: Option<String>) {
        if let Ok(mut guard) = self.tunnels.lock() {
            if let Some(tunnel) = guard.get_mut(tunnel_id) {
                tunnel.stop_tx = None;
                tunnel
                    .metrics
                    .active_connections
                    .store(0, Ordering::Relaxed);
                if let Some(error) = unexpected_error {
                    tunnel.status = TunnelStatus::Error;
                    if let Ok(mut last_error) = tunnel.last_error.lock() {
                        *last_error = Some(error);
                    }
                } else {
                    tunnel.status = TunnelStatus::Stopped;
                }
            }
        }
    }

    pub fn stop(&self, tunnel_id: &str) -> Result<(), String> {
        let mut guard = self.tunnels.lock().map_err(|error| error.to_string())?;
        let tunnel = guard
            .get_mut(tunnel_id)
            .ok_or_else(|| format!("Tunnel '{tunnel_id}' was not found."))?;
        if let Some(stop_tx) = tunnel.stop_tx.take() {
            let _ = stop_tx.send(());
        }
        tunnel.status = TunnelStatus::Stopped;
        tunnel
            .metrics
            .active_connections
            .store(0, Ordering::Relaxed);
        Ok(())
    }

    pub fn stop_all(&self) {
        if let Ok(mut guard) = self.tunnels.lock() {
            for tunnel in guard.values_mut() {
                if let Some(stop_tx) = tunnel.stop_tx.take() {
                    let _ = stop_tx.send(());
                }
                tunnel.status = TunnelStatus::Stopped;
                tunnel
                    .metrics
                    .active_connections
                    .store(0, Ordering::Relaxed);
            }
        }
    }
}

fn now_epoch_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn validate_identifier(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > MAX_TUNNEL_ID_BYTES
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(format!(
            "{label} is missing or contains unsupported characters."
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
        return Err(format!("{label} is invalid."));
    }
    Ok(())
}

fn validate_request(
    request: &StartTunnelRequest,
    ssh: &SshTunnelEndpoint,
) -> Result<IpAddr, String> {
    validate_identifier(&request.tunnel_id, "Tunnel id")?;
    validate_identifier(&request.profile_id, "Profile id")?;
    validate_host(&ssh.hostname, "SSH hostname")?;
    if ssh.port == 0
        || ssh.username.trim().is_empty()
        || ssh.username.len() > 64
        || ssh.username.chars().any(char::is_whitespace)
        || ssh.username.chars().any(char::is_control)
    {
        return Err("The SSH endpoint is invalid.".to_string());
    }
    let bind_ip = request
        .local_host
        .parse::<IpAddr>()
        .map_err(|_| "The tunnel bind address must be an IPv4 or IPv6 literal.".to_string())?;
    if request.local_port == 0 {
        return Err("The tunnel bind port must be between 1 and 65535.".to_string());
    }
    if request.tunnel_type == TunnelType::Dynamic && !bind_ip.is_loopback() {
        return Err(
            "A no-authentication SOCKS5 proxy may only bind to a loopback address.".to_string(),
        );
    }
    if request.tunnel_type != TunnelType::Dynamic {
        validate_host(&request.remote_host, "Tunnel target hostname")?;
        if request.remote_port == 0 {
            return Err("The tunnel target port must be between 1 and 65535.".to_string());
        }
    }
    Ok(bind_ip)
}

fn record_connection_error(last_error: &Arc<Mutex<Option<String>>>, error: impl Into<String>) {
    if let Ok(mut slot) = last_error.lock() {
        *slot = Some(error.into());
    }
}

struct ConnectionGuard(Arc<TunnelMetrics>);

impl ConnectionGuard {
    fn new(metrics: Arc<TunnelMetrics>) -> Self {
        metrics.active_connections.fetch_add(1, Ordering::Relaxed);
        Self(metrics)
    }
}

impl Drop for ConnectionGuard {
    fn drop(&mut self) {
        let _ = self.0.active_connections.fetch_update(
            Ordering::Relaxed,
            Ordering::Relaxed,
            |current| Some(current.saturating_sub(1)),
        );
    }
}

struct TunnelHandler {
    host: String,
    port: u16,
    known: Option<HostKeyRecord>,
    verdict: Arc<Mutex<Option<TrustVerdict>>>,
    remote_target: Option<(String, u16)>,
    metrics: Arc<TunnelMetrics>,
    last_error: Arc<Mutex<Option<String>>>,
}

impl client::Handler for TunnelHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint = server_public_key
            .fingerprint(ssh_key::HashAlg::Sha256)
            .to_string();
        let algorithm = server_public_key.algorithm().to_string();
        let verdict = match &self.known {
            Some(record) if record.fingerprint == fingerprint => TrustVerdict::Trusted {
                record: record.clone(),
            },
            Some(record) => TrustVerdict::Changed {
                host: self.host.clone(),
                port: self.port,
                algorithm,
                received_fingerprint: fingerprint,
                expected: record.clone(),
            },
            None => TrustVerdict::Unknown {
                host: self.host.clone(),
                port: self.port,
                algorithm,
                fingerprint,
            },
        };
        let accepted = verdict.may_proceed();
        if let Ok(mut slot) = self.verdict.lock() {
            *slot = Some(verdict);
        }
        Ok(accepted)
    }

    #[allow(clippy::too_many_arguments)]
    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: Channel<Msg>,
        _connected_address: &str,
        _connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        let Some((target_host, target_port)) = self.remote_target.clone() else {
            reply
                .reject(ChannelOpenFailure::AdministrativelyProhibited)
                .await;
            return Ok(());
        };
        let metrics = Arc::clone(&self.metrics);
        let last_error = Arc::clone(&self.last_error);
        tokio::spawn(async move {
            match TcpStream::connect((target_host.as_str(), target_port)).await {
                Ok(mut target) => {
                    reply.accept().await;
                    let _guard = ConnectionGuard::new(Arc::clone(&metrics));
                    let mut ssh_stream = channel.into_stream();
                    match tokio::io::copy_bidirectional(&mut ssh_stream, &mut target).await {
                        Ok((uploaded, downloaded)) => {
                            metrics
                                .bytes_uploaded
                                .fetch_add(uploaded, Ordering::Relaxed);
                            metrics
                                .bytes_downloaded
                                .fetch_add(downloaded, Ordering::Relaxed);
                        }
                        Err(error) => record_connection_error(
                            &last_error,
                            format!("Remote forwarding stream failed: {error}"),
                        ),
                    }
                }
                Err(error) => {
                    record_connection_error(
                        &last_error,
                        format!("Remote forwarding target is unavailable: {error}"),
                    );
                    reply.reject(ChannelOpenFailure::ConnectFailed).await;
                }
            }
        });
        Ok(())
    }
}

fn trust_failure(verdict: Option<TrustVerdict>, fallback: String) -> String {
    match verdict {
        Some(TrustVerdict::Unknown { .. }) => {
            "The SSH host key is not trusted. Connect to this SSH profile and verify its fingerprint first.".to_string()
        }
        Some(TrustVerdict::Changed { .. }) => {
            "The SSH host key changed, so the tunnel was refused. Review the connection fingerprint before trying again.".to_string()
        }
        _ => format!("The SSH gateway connection failed: {fallback}"),
    }
}

async fn bridge_local_connection(
    mut socket: TcpStream,
    originator: SocketAddr,
    session: Arc<client::Handle<TunnelHandler>>,
    request: StartTunnelRequest,
    metrics: Arc<TunnelMetrics>,
    last_error: Arc<Mutex<Option<String>>>,
) {
    let _guard = ConnectionGuard::new(Arc::clone(&metrics));
    let channel = match session
        .channel_open_direct_tcpip(
            request.remote_host,
            u32::from(request.remote_port),
            originator.ip().to_string(),
            u32::from(originator.port()),
        )
        .await
    {
        Ok(channel) => channel,
        Err(error) => {
            record_connection_error(
                &last_error,
                format!("SSH direct-tcpip channel failed: {error}"),
            );
            return;
        }
    };
    let mut ssh_stream = channel.into_stream();
    match tokio::io::copy_bidirectional(&mut socket, &mut ssh_stream).await {
        Ok((uploaded, downloaded)) => {
            metrics
                .bytes_uploaded
                .fetch_add(uploaded, Ordering::Relaxed);
            metrics
                .bytes_downloaded
                .fetch_add(downloaded, Ordering::Relaxed);
        }
        Err(error) => record_connection_error(
            &last_error,
            format!("Local forwarding stream failed: {error}"),
        ),
    }
}

async fn write_socks_reply(socket: &mut TcpStream, reply: u8) {
    let _ = socket
        .write_all(&[0x05, reply, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
        .await;
}

async fn negotiate_socks5(socket: &mut TcpStream) -> Result<(String, u16), String> {
    let mut greeting = [0u8; 2];
    socket
        .read_exact(&mut greeting)
        .await
        .map_err(|error| format!("SOCKS5 greeting failed: {error}"))?;
    let method_count = usize::from(greeting[1]);
    if greeting[0] != 0x05 || method_count == 0 || method_count > MAX_SOCKS_METHODS {
        return Err("Invalid SOCKS5 greeting.".to_string());
    }
    let mut methods = vec![0u8; method_count];
    socket
        .read_exact(&mut methods)
        .await
        .map_err(|error| format!("SOCKS5 authentication methods are incomplete: {error}"))?;
    if !methods.contains(&0x00) {
        let _ = socket.write_all(&[0x05, 0xff]).await;
        return Err("The SOCKS5 client did not offer the no-authentication method.".to_string());
    }
    socket
        .write_all(&[0x05, 0x00])
        .await
        .map_err(|error| format!("SOCKS5 greeting response failed: {error}"))?;

    let mut header = [0u8; 4];
    socket
        .read_exact(&mut header)
        .await
        .map_err(|error| format!("SOCKS5 request failed: {error}"))?;
    if header[0] != 0x05 || header[2] != 0x00 {
        write_socks_reply(socket, 0x01).await;
        return Err("Invalid SOCKS5 CONNECT request.".to_string());
    }
    if header[1] != 0x01 {
        write_socks_reply(socket, 0x07).await;
        return Err("Only the SOCKS5 CONNECT command is supported.".to_string());
    }

    let host = match header[3] {
        0x01 => {
            let mut bytes = [0u8; 4];
            socket
                .read_exact(&mut bytes)
                .await
                .map_err(|error| error.to_string())?;
            Ipv4Addr::from(bytes).to_string()
        }
        0x03 => {
            let length = socket.read_u8().await.map_err(|error| error.to_string())? as usize;
            if length == 0 || length > MAX_HOST_BYTES {
                write_socks_reply(socket, 0x08).await;
                return Err("The SOCKS5 domain name is invalid.".to_string());
            }
            let mut bytes = vec![0u8; length];
            socket
                .read_exact(&mut bytes)
                .await
                .map_err(|error| error.to_string())?;
            let host = String::from_utf8(bytes)
                .map_err(|_| "The SOCKS5 domain name is not valid UTF-8.".to_string())?;
            validate_host(&host, "SOCKS5 target hostname")?;
            host
        }
        0x04 => {
            let mut bytes = [0u8; 16];
            socket
                .read_exact(&mut bytes)
                .await
                .map_err(|error| error.to_string())?;
            Ipv6Addr::from(bytes).to_string()
        }
        _ => {
            write_socks_reply(socket, 0x08).await;
            return Err("The SOCKS5 address type is unsupported.".to_string());
        }
    };
    let port = socket.read_u16().await.map_err(|error| error.to_string())?;
    if port == 0 {
        write_socks_reply(socket, 0x01).await;
        return Err("The SOCKS5 target port is invalid.".to_string());
    }
    Ok((host, port))
}

async fn bridge_dynamic_connection(
    mut socket: TcpStream,
    originator: SocketAddr,
    session: Arc<client::Handle<TunnelHandler>>,
    metrics: Arc<TunnelMetrics>,
    last_error: Arc<Mutex<Option<String>>>,
) {
    let _guard = ConnectionGuard::new(Arc::clone(&metrics));
    let (host, port) = match negotiate_socks5(&mut socket).await {
        Ok(target) => target,
        Err(error) => {
            record_connection_error(&last_error, error);
            return;
        }
    };
    let channel = match session
        .channel_open_direct_tcpip(
            host,
            u32::from(port),
            originator.ip().to_string(),
            u32::from(originator.port()),
        )
        .await
    {
        Ok(channel) => channel,
        Err(error) => {
            write_socks_reply(&mut socket, 0x05).await;
            record_connection_error(&last_error, format!("SOCKS5 SSH channel failed: {error}"));
            return;
        }
    };
    write_socks_reply(&mut socket, 0x00).await;
    let mut ssh_stream = channel.into_stream();
    match tokio::io::copy_bidirectional(&mut socket, &mut ssh_stream).await {
        Ok((uploaded, downloaded)) => {
            metrics
                .bytes_uploaded
                .fetch_add(uploaded, Ordering::Relaxed);
            metrics
                .bytes_downloaded
                .fetch_add(downloaded, Ordering::Relaxed);
        }
        Err(error) => {
            record_connection_error(&last_error, format!("SOCKS5 stream failed: {error}"))
        }
    }
}

/// Starts a tunnel only after the SSH gateway has passed host-key verification,
/// authentication, and bind/forward setup. An active status therefore means
/// the runtime can actually accept forwarded traffic.
pub async fn start_tunnel(
    registry: Arc<TunnelRegistry>,
    known: Option<HostKeyRecord>,
    password: Zeroizing<String>,
    request: StartTunnelRequest,
    ssh: SshTunnelEndpoint,
) -> Result<TunnelStatusSummary, String> {
    let bind_ip = validate_request(&request, &ssh)?;
    let metrics = Arc::new(TunnelMetrics::default());
    let last_error = Arc::new(Mutex::new(None));
    registry.reserve(
        &request.tunnel_id,
        Arc::clone(&metrics),
        Arc::clone(&last_error),
    )?;

    let verdict = Arc::new(Mutex::new(None));
    let handler = TunnelHandler {
        host: ssh.hostname.clone(),
        port: ssh.port,
        known,
        verdict: Arc::clone(&verdict),
        remote_target: (request.tunnel_type == TunnelType::Remote)
            .then(|| (request.remote_host.clone(), request.remote_port)),
        metrics: Arc::clone(&metrics),
        last_error: Arc::clone(&last_error),
    };
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(3600)),
        nodelay: true,
        ..Default::default()
    });
    let mut session =
        match client::connect(config, (ssh.hostname.as_str(), ssh.port), handler).await {
            Ok(session) => session,
            Err(error) => {
                let recorded = verdict.lock().ok().and_then(|slot| slot.clone());
                let error = trust_failure(recorded, error.to_string());
                registry.fail(&request.tunnel_id, error.clone());
                return Err(error);
            }
        };
    let authenticated = match session
        .authenticate_password(&ssh.username, password.as_str())
        .await
    {
        Ok(result) => result.success(),
        Err(error) => {
            let error = format!("SSH tunnel authentication failed: {error}");
            registry.fail(&request.tunnel_id, error.clone());
            return Err(error);
        }
    };
    drop(password);
    if !authenticated {
        let error = "The SSH gateway rejected the saved password.".to_string();
        registry.fail(&request.tunnel_id, error.clone());
        return Err(error);
    }

    let listener = if request.tunnel_type == TunnelType::Remote {
        if let Err(error) = session
            .tcpip_forward(request.local_host.clone(), u32::from(request.local_port))
            .await
        {
            let error = format!("The SSH server refused remote port forwarding: {error}");
            registry.fail(&request.tunnel_id, error.clone());
            let _ = session
                .disconnect(Disconnect::ByApplication, "tunnel setup failed", "en")
                .await;
            return Err(error);
        }
        None
    } else {
        let bind_address = SocketAddr::new(bind_ip, request.local_port);
        match TcpListener::bind(bind_address).await {
            Ok(listener) => Some(listener),
            Err(error) => {
                let error = format!("Cannot bind tunnel listener to {bind_address}: {error}");
                registry.fail(&request.tunnel_id, error.clone());
                let _ = session
                    .disconnect(Disconnect::ByApplication, "tunnel setup failed", "en")
                    .await;
                return Err(error);
            }
        }
    };

    let session = Arc::new(session);
    let (stop_tx, mut stop_rx) = broadcast::channel(1);
    let started_at = now_epoch_secs();
    if let Err(error) = registry.activate(&request.tunnel_id, started_at, stop_tx) {
        if request.tunnel_type == TunnelType::Remote {
            let _ = session
                .cancel_tcpip_forward(request.local_host.clone(), u32::from(request.local_port))
                .await;
        }
        let _ = session
            .disconnect(Disconnect::ByApplication, "tunnel cancelled", "en")
            .await;
        return Err(error);
    }

    let tunnel_id = request.tunnel_id.clone();
    let registry_task = Arc::clone(&registry);
    let session_task = Arc::clone(&session);
    let request_task = request.clone();
    let metrics_task = Arc::clone(&metrics);
    let last_error_task = Arc::clone(&last_error);
    tokio::spawn(async move {
        let mut unexpected_error = None;
        if let Some(listener) = listener {
            loop {
                tokio::select! {
                    _ = stop_rx.recv() => break,
                    _ = tokio::time::sleep(Duration::from_secs(1)) => {
                        if session_task.is_closed() {
                            unexpected_error = Some("The SSH gateway session closed unexpectedly.".to_string());
                            break;
                        }
                    }
                    accepted = listener.accept() => match accepted {
                        Ok((socket, originator)) => {
                            let session = Arc::clone(&session_task);
                            let request = request_task.clone();
                            let metrics = Arc::clone(&metrics_task);
                            let last_error = Arc::clone(&last_error_task);
                            match request.tunnel_type {
                                TunnelType::Local => {
                                    tokio::spawn(bridge_local_connection(
                                        socket,
                                        originator,
                                        session,
                                        request,
                                        metrics,
                                        last_error,
                                    ));
                                }
                                TunnelType::Dynamic => {
                                    tokio::spawn(bridge_dynamic_connection(
                                        socket,
                                        originator,
                                        session,
                                        metrics,
                                        last_error,
                                    ));
                                }
                                TunnelType::Remote => {
                                    unreachable!("remote forwarding has no local listener")
                                }
                            }
                        }
                        Err(error) => {
                            unexpected_error = Some(format!("Tunnel listener failed: {error}"));
                            break;
                        }
                    },
                }
            }
        } else {
            loop {
                tokio::select! {
                    _ = stop_rx.recv() => break,
                    _ = tokio::time::sleep(Duration::from_secs(1)) => {
                        if session_task.is_closed() {
                            unexpected_error = Some("The SSH gateway session closed unexpectedly.".to_string());
                            break;
                        }
                    }
                }
            }
            let _ = session_task
                .cancel_tcpip_forward(
                    request_task.local_host.clone(),
                    u32::from(request_task.local_port),
                )
                .await;
        }
        let _ = session_task
            .disconnect(Disconnect::ByApplication, "tunnel stopped", "en")
            .await;
        registry_task.finish(&tunnel_id, unexpected_error);
    });

    registry
        .status(&request.tunnel_id)
        .ok_or_else(|| "The tunnel runtime did not register its status.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(tunnel_type: TunnelType) -> StartTunnelRequest {
        StartTunnelRequest {
            tunnel_id: "test-tunnel-1".to_string(),
            tunnel_type,
            profile_id: "profile-1".to_string(),
            local_host: "127.0.0.1".to_string(),
            local_port: 8080,
            remote_host: "database.internal".to_string(),
            remote_port: 5432,
        }
    }

    fn endpoint() -> SshTunnelEndpoint {
        SshTunnelEndpoint {
            hostname: "gateway.test".to_string(),
            port: 22,
            username: "user".to_string(),
        }
    }

    #[test]
    fn requests_reject_unsafe_identifiers_and_open_socks_bindings() {
        let mut invalid_id = request(TunnelType::Local);
        invalid_id.tunnel_id = "../tunnel".to_string();
        assert!(validate_request(&invalid_id, &endpoint()).is_err());

        let mut public_socks = request(TunnelType::Dynamic);
        public_socks.local_host = "0.0.0.0".to_string();
        assert!(validate_request(&public_socks, &endpoint()).is_err());
    }

    #[test]
    fn registry_does_not_allow_two_active_runtimes_for_one_id() {
        let registry = TunnelRegistry::new();
        registry
            .reserve(
                "tunnel-1",
                Arc::new(TunnelMetrics::default()),
                Arc::new(Mutex::new(None)),
            )
            .unwrap();
        assert!(registry
            .reserve(
                "tunnel-1",
                Arc::new(TunnelMetrics::default()),
                Arc::new(Mutex::new(None)),
            )
            .is_err());
        registry.stop("tunnel-1").unwrap();
        assert_eq!(
            registry.status("tunnel-1").unwrap().status,
            TunnelStatus::Stopped
        );
    }

    #[test]
    fn unknown_keys_have_actionable_errors() {
        let unknown = TrustVerdict::Unknown {
            host: "gateway.test".to_string(),
            port: 22,
            algorithm: "ssh-ed25519".to_string(),
            fingerprint: "SHA256:test".to_string(),
        };
        assert!(trust_failure(Some(unknown), "fallback".to_string()).contains("not trusted"));
    }

    #[test]
    fn connection_guards_never_underflow_after_a_forced_stop() {
        let metrics = Arc::new(TunnelMetrics::default());
        let guard = ConnectionGuard::new(Arc::clone(&metrics));
        metrics.active_connections.store(0, Ordering::Relaxed);
        drop(guard);
        assert_eq!(metrics.active_connections.load(Ordering::Relaxed), 0);
    }
}
