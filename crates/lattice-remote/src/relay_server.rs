//! Core of the lattice-relay server, kept in the library so tests can run a
//! real relay on an ephemeral port. See `bin/lattice-relay.rs` for the CLI.
//!
//! A deliberately blind rendezvous point: agents register a nine-digit device
//! ID over an outbound connection, viewers dial that ID, and the relay pipes
//! the two sockets together. Every session byte after the link is Noise
//! ciphertext negotiated end to end between the peers; the relay never holds
//! a pairing code or a session key, and a stolen relay disk only yields
//! device IDs and token hashes.

use crate::relay::{
    hash_token, normalize_device_id, random_channel_id, read_client_message, write_server_message,
    RelayClientMessage, RelayServerMessage,
};
use crate::Transport;
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot};
use tokio::time::timeout;

/// A registration is dropped when the agent stays silent longer than this;
/// agents ping every 25 seconds, so three missed pings end the entry.
const CONTROL_IDLE_LIMIT: Duration = Duration::from_secs(90);
/// How long a dialing viewer waits for the agent to join the channel.
const JOIN_WAIT_LIMIT: Duration = Duration::from_secs(12);
/// How long a brand-new connection has to say what it wants.
const FIRST_MESSAGE_LIMIT: Duration = Duration::from_secs(10);
/// New connections allowed per client IP inside the rate window. Generous
/// for real use (register + a session is a handful), tight enough to stop
/// pairing-code guessing or device-ID scanning through the relay.
const CONNECTIONS_PER_WINDOW: usize = 30;
const RATE_WINDOW: Duration = Duration::from_secs(60);

struct AgentEntry {
    agent_name: String,
    invites: mpsc::Sender<RelayServerMessage>,
    generation: u64,
}

#[derive(Default)]
pub struct RelayState {
    agents: Mutex<HashMap<String, AgentEntry>>,
    pending: Mutex<HashMap<String, oneshot::Sender<Transport>>>,
    tokens: Mutex<HashMap<String, String>>,
    state_path: Option<PathBuf>,
    generations: Mutex<u64>,
    rates: Mutex<HashMap<IpAddr, Vec<Instant>>>,
}

impl RelayState {
    pub fn new(state_path: Option<PathBuf>) -> Self {
        let state = Self {
            state_path,
            ..Self::default()
        };
        state.load_tokens();
        state
    }

    fn next_generation(&self) -> u64 {
        let mut current = self.generations.lock().expect("generation lock");
        *current += 1;
        *current
    }

    /// Sliding-window limit on how often one IP may open connections.
    ///
    /// Loopback is exempt: behind the recommended HTTPS/WSS ingress every
    /// public client reaches the relay as 127.0.0.1, so one busy peer would
    /// exhaust the shared bucket for everyone. Rate limiting public traffic
    /// is the ingress's job there; the per-IP budget applies when the relay
    /// port is exposed directly.
    fn allow_connection(&self, ip: IpAddr) -> bool {
        if ip.is_loopback() {
            return true;
        }
        let now = Instant::now();
        let mut rates = self.rates.lock().expect("rate lock");
        let recent = rates.entry(ip).or_default();
        recent.retain(|at| now.duration_since(*at) < RATE_WINDOW);
        if recent.len() >= CONNECTIONS_PER_WINDOW {
            return false;
        }
        recent.push(now);
        // Idle buckets are pruned so a scan cannot grow the map forever.
        if rates.len() > 10_000 {
            rates.retain(|_, entries| {
                entries.retain(|at| now.duration_since(*at) < RATE_WINDOW);
                !entries.is_empty()
            });
        }
        true
    }

    fn verify_or_claim(&self, device_id: &str, auth_token: &str) -> Result<(), &'static str> {
        let hashed = hash_token(auth_token);
        let mut tokens = self.tokens.lock().expect("token lock");
        match tokens.get(device_id) {
            Some(existing) if *existing == hashed => Ok(()),
            Some(_) => Err("this device ID belongs to another device"),
            None => {
                tokens.insert(device_id.to_string(), hashed);
                self.save_tokens(&tokens);
                Ok(())
            }
        }
    }

    fn verify_only(&self, device_id: &str, auth_token: &str) -> bool {
        let hashed = hash_token(auth_token);
        self.tokens
            .lock()
            .expect("token lock")
            .get(device_id)
            .is_some_and(|existing| *existing == hashed)
    }

    fn save_tokens(&self, tokens: &HashMap<String, String>) {
        let Some(path) = &self.state_path else {
            return;
        };
        match serde_json::to_vec_pretty(tokens) {
            Ok(json) => {
                let staging = path.with_extension("tmp");
                let mut options = std::fs::OpenOptions::new();
                options.create(true).truncate(true).write(true);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::OpenOptionsExt;
                    options.mode(0o600);
                }
                let result = (|| -> std::io::Result<()> {
                    let mut file = options.open(&staging)?;
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
                    }
                    std::io::Write::write_all(&mut file, &json)?;
                    file.sync_all()?;
                    drop(file);
                    std::fs::rename(&staging, path)?;
                    Ok(())
                })();
                if let Err(error) = result {
                    eprintln!("warning: could not persist device registry: {error}");
                }
            }
            Err(error) => eprintln!("warning: could not encode device registry: {error}"),
        }
    }

    fn load_tokens(&self) {
        let Some(path) = &self.state_path else {
            return;
        };
        match std::fs::read(path) {
            Ok(bytes) => match serde_json::from_slice::<HashMap<String, String>>(&bytes) {
                Ok(loaded) => {
                    let count = loaded.len();
                    *self.tokens.lock().expect("token lock") = loaded;
                    println!("Loaded {count} registered device IDs.");
                }
                Err(error) => eprintln!("warning: ignoring invalid device registry: {error}"),
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => eprintln!("warning: could not read device registry: {error}"),
        }
    }
}

async fn send_error(stream: &mut Transport, code: &str, detail: &str) {
    let _ = write_server_message(
        stream,
        &RelayServerMessage::Error {
            code: code.to_string(),
            detail: detail.to_string(),
        },
    )
    .await;
}

/// Holds an agent's register connection: forwards invites from dial handlers
/// and answers pings until the agent disappears.
async fn run_agent_control(
    state: Arc<RelayState>,
    stream: Transport,
    peer: SocketAddr,
    device_id: String,
    agent_name: String,
) {
    let generation = state.next_generation();
    let (invites_tx, mut invites_rx) = mpsc::channel::<RelayServerMessage>(8);
    state.agents.lock().expect("agent lock").insert(
        device_id.clone(),
        AgentEntry {
            agent_name,
            invites: invites_tx,
            generation,
        },
    );
    println!("Registered device {device_id} from {peer}.");

    let (mut read_half, write_half) = tokio::io::split(stream);
    let writer = Arc::new(tokio::sync::Mutex::new(write_half));
    let ping_writer = Arc::clone(&writer);

    let mut forwarder = tokio::spawn(async move {
        while let Some(message) = invites_rx.recv().await {
            let mut guard = ping_writer.lock().await;
            if write_server_message(&mut *guard, &message).await.is_err() {
                break;
            }
        }
    });

    loop {
        tokio::select! {
            received = timeout(CONTROL_IDLE_LIMIT, read_client_message(&mut read_half)) => {
                match received {
                    Ok(Ok(RelayClientMessage::Ping)) => {
                        let mut guard = writer.lock().await;
                        if write_server_message(&mut *guard, &RelayServerMessage::Pong)
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                    Ok(Ok(_)) | Ok(Err(_)) | Err(_) => break,
                }
            }
            _ = &mut forwarder => break,
        }
    }

    forwarder.abort();
    let mut agents = state.agents.lock().expect("agent lock");
    if agents
        .get(&device_id)
        .is_some_and(|entry| entry.generation == generation)
    {
        agents.remove(&device_id);
        println!("Device {device_id} went offline.");
    }
}

async fn run_dial(
    state: Arc<RelayState>,
    mut stream: Transport,
    peer: SocketAddr,
    device_id: String,
) {
    let device_id = match normalize_device_id(&device_id) {
        Ok(device_id) => device_id,
        Err(_) => {
            send_error(&mut stream, "invalidId", "A device ID has nine digits.").await;
            return;
        }
    };
    let channel_id = match random_channel_id() {
        Ok(channel_id) => channel_id,
        Err(_) => {
            send_error(
                &mut stream,
                "internal",
                "The relay could not open a channel.",
            )
            .await;
            return;
        }
    };
    let entry = state
        .agents
        .lock()
        .expect("agent lock")
        .get(&device_id)
        .map(|entry| (entry.invites.clone(), entry.agent_name.clone()));
    let Some((invite, agent_name)) = entry else {
        send_error(
            &mut stream,
            "offline",
            "That device is not connected to this relay.",
        )
        .await;
        return;
    };

    let (channel_tx, channel_rx) = oneshot::channel::<Transport>();
    state
        .pending
        .lock()
        .expect("pending lock")
        .insert(channel_id.clone(), channel_tx);

    let invited = invite
        .send(RelayServerMessage::Invite {
            channel_id: channel_id.clone(),
        })
        .await
        .is_ok();
    if !invited {
        state
            .pending
            .lock()
            .expect("pending lock")
            .remove(&channel_id);
        send_error(&mut stream, "offline", "That device just went offline.").await;
        return;
    }

    let agent_stream = match timeout(JOIN_WAIT_LIMIT, channel_rx).await {
        Ok(Ok(agent_stream)) => agent_stream,
        Ok(Err(_)) | Err(_) => {
            state
                .pending
                .lock()
                .expect("pending lock")
                .remove(&channel_id);
            send_error(
                &mut stream,
                "busy",
                "The device did not answer. It may be in another session.",
            )
            .await;
            return;
        }
    };

    let mut agent_stream = agent_stream;
    let linked = RelayServerMessage::Linked {
        agent_name: agent_name.clone(),
    };
    if write_server_message(&mut agent_stream, &linked)
        .await
        .is_err()
    {
        send_error(&mut stream, "busy", "The device dropped while linking.").await;
        return;
    }
    if write_server_message(&mut stream, &linked).await.is_err() {
        let _ = agent_stream.shutdown().await;
        return;
    }

    println!("Linked a viewer at {peer} with device {device_id}.");
    match tokio::io::copy_bidirectional(&mut stream, &mut agent_stream).await {
        Ok((to_agent, to_viewer)) => println!(
            "Channel for device {device_id} closed ({to_agent} bytes in, {to_viewer} bytes out)."
        ),
        Err(error) => println!("Channel for device {device_id} ended: {error}."),
    }
}

async fn run_connection(state: Arc<RelayState>, mut stream: Transport, peer: SocketAddr) {
    let first = match timeout(FIRST_MESSAGE_LIMIT, read_client_message(&mut stream)).await {
        Ok(Ok(message)) => message,
        Ok(Err(_)) | Err(_) => return,
    };
    match first {
        RelayClientMessage::Register {
            device_id,
            auth_token,
            agent_name,
        } => {
            let device_id = match normalize_device_id(&device_id) {
                Ok(device_id) => device_id,
                Err(_) => {
                    send_error(&mut stream, "invalidId", "A device ID has nine digits.").await;
                    return;
                }
            };
            if let Err(reason) = state.verify_or_claim(&device_id, &auth_token) {
                send_error(&mut stream, "unauthorized", reason).await;
                return;
            }
            if write_server_message(&mut stream, &RelayServerMessage::Registered)
                .await
                .is_err()
            {
                return;
            }
            run_agent_control(state, stream, peer, device_id, agent_name).await;
        }
        RelayClientMessage::Dial { device_id } => {
            run_dial(state, stream, peer, device_id).await;
        }
        RelayClientMessage::Join {
            channel_id,
            device_id,
            auth_token,
        } => {
            let authorized = normalize_device_id(&device_id)
                .map(|device_id| state.verify_only(&device_id, &auth_token))
                .unwrap_or(false);
            if !authorized {
                send_error(&mut stream, "unauthorized", "Unknown device or token.").await;
                return;
            }
            let waiting = state
                .pending
                .lock()
                .expect("pending lock")
                .remove(&channel_id);
            match waiting {
                // The dial handler takes over the socket from here.
                Some(channel) => {
                    let _ = channel.send(stream);
                }
                None => {
                    send_error(&mut stream, "expired", "That invite is no longer waiting.").await;
                }
            }
        }
        RelayClientMessage::Ping => {
            let _ = write_server_message(&mut stream, &RelayServerMessage::Pong).await;
        }
    }
}

/// Accepts connections forever. Callers bind the listener themselves so tests
/// can use an ephemeral port.
pub async fn run(listener: TcpListener, state: Arc<RelayState>) {
    loop {
        match listener.accept().await {
            Ok((stream, peer)) => {
                let state = Arc::clone(&state);
                tokio::spawn(async move {
                    // The budget is spent before the WebSocket handshake so a
                    // flood cannot buy HTTP parsing work with rejected
                    // connections.
                    if !state.allow_connection(peer.ip()) {
                        let _ = timeout(FIRST_MESSAGE_LIMIT, reject_rate_limited(stream)).await;
                        return;
                    }
                    let negotiated = timeout(FIRST_MESSAGE_LIMIT, negotiate_carrier(stream)).await;
                    if let Ok(Ok(transport)) = negotiated {
                        run_connection(state, transport, peer).await;
                    }
                });
            }
            Err(error) => {
                eprintln!("Could not accept a connection: {error}");
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
        }
    }
}

/// Native relay TCP costs nothing extra to answer, so an over-budget peer
/// still hears the rateLimited error; a WebSocket peer would first need the
/// very handshake the limiter exists to avoid, so it is dropped silently.
async fn reject_rate_limited(stream: TcpStream) {
    let mut first = [0_u8; 1];
    if stream.set_nodelay(true).is_ok()
        && matches!(stream.peek(&mut first).await, Ok(1))
        && first[0] == 0
    {
        let mut transport = Transport::Tcp(stream);
        send_error(
            &mut transport,
            "rateLimited",
            "Too many connections from this address; wait a minute.",
        )
        .await;
    }
}

/// One listener supports native relay TCP and WebSocket upgrades. Relay JSON
/// begins with a zero high byte in its bounded length prefix, while every
/// WebSocket handshake begins with an HTTP `GET` request.
async fn negotiate_carrier(stream: TcpStream) -> Result<Transport, std::io::Error> {
    stream.set_nodelay(true)?;
    let mut first = [0_u8; 1];
    if stream.peek(&mut first).await? == 1 && first[0] == 0 {
        return Ok(Transport::Tcp(stream));
    }
    Transport::accept_websocket(stream).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::relay::{dial, read_server_message, write_client_message, DeviceIdentity};
    use crate::{RemoteHello, RemoteMessage, SecureConnection, PROTOCOL_VERSION};

    async fn start_relay() -> (SocketAddr, Arc<RelayState>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let state = Arc::new(RelayState::default());
        let run_state = Arc::clone(&state);
        tokio::spawn(run(listener, run_state));
        (address, state)
    }

    async fn register_agent(
        address: SocketAddr,
        identity: &DeviceIdentity,
    ) -> tokio::net::TcpStream {
        let mut control = TcpStream::connect(address).await.unwrap();
        write_client_message(
            &mut control,
            &RelayClientMessage::Register {
                device_id: identity.device_id.clone(),
                auth_token: identity.auth_token.clone(),
                agent_name: "Test host".to_string(),
            },
        )
        .await
        .unwrap();
        assert_eq!(
            read_server_message(&mut control).await.unwrap(),
            RelayServerMessage::Registered
        );
        control
    }

    #[tokio::test]
    async fn viewer_and_agent_run_noise_end_to_end_through_the_relay() {
        let (address, _state) = start_relay().await;
        let identity = DeviceIdentity::generate().unwrap();
        let mut control = register_agent(address, &identity).await;

        // The fake agent answers the invite, then accepts the encrypted
        // session exactly like the real one.
        let agent_identity = identity.clone();
        let agent = tokio::spawn(async move {
            let invite = read_server_message(&mut control).await.unwrap();
            let RelayServerMessage::Invite { channel_id } = invite else {
                panic!("expected an invite, got {invite:?}");
            };
            let mut session = TcpStream::connect(address).await.unwrap();
            write_client_message(
                &mut session,
                &RelayClientMessage::Join {
                    channel_id,
                    device_id: agent_identity.device_id.clone(),
                    auth_token: agent_identity.auth_token.clone(),
                },
            )
            .await
            .unwrap();
            let linked = read_server_message(&mut session).await.unwrap();
            assert!(matches!(linked, RelayServerMessage::Linked { .. }));
            let mut secure = SecureConnection::accept(session, "12345678").await.unwrap();
            secure
                .send(&RemoteMessage::Hello(RemoteHello {
                    protocol_version: PROTOCOL_VERSION,
                    agent_name: "Test host".into(),
                    width: 640,
                    height: 360,
                    view_only: true,
                    file_transfer: false,
                    file_root_label: String::new(),
                    terminal: false,
                }))
                .await
                .unwrap();
            assert_eq!(secure.receive().await.unwrap(), RemoteMessage::KeepAlive);
        });

        let (stream, agent_name) = dial(&address.to_string(), &identity.device_id)
            .await
            .unwrap();
        assert_eq!(agent_name, "Test host");
        let mut viewer = SecureConnection::initiate(stream, "1234-5678")
            .await
            .unwrap();
        let hello = viewer.receive().await.unwrap();
        assert!(matches!(hello, RemoteMessage::Hello(_)));
        viewer.send(&RemoteMessage::KeepAlive).await.unwrap();
        agent.await.unwrap();
    }

    #[tokio::test]
    async fn websocket_viewer_and_agent_keep_noise_end_to_end() {
        let (address, _state) = start_relay().await;
        let endpoint = format!("ws://{address}/");
        let identity = DeviceIdentity::generate().unwrap();
        let mut control = Transport::connect(&endpoint).await.unwrap();
        write_client_message(
            &mut control,
            &RelayClientMessage::Register {
                device_id: identity.device_id.clone(),
                auth_token: identity.auth_token.clone(),
                agent_name: "WebSocket host".to_string(),
            },
        )
        .await
        .unwrap();
        assert_eq!(
            read_server_message(&mut control).await.unwrap(),
            RelayServerMessage::Registered
        );

        let session_endpoint = endpoint.clone();
        let agent_identity = identity.clone();
        let agent = tokio::spawn(async move {
            let RelayServerMessage::Invite { channel_id } =
                read_server_message(&mut control).await.unwrap()
            else {
                panic!("expected a relay invite");
            };
            let mut session = Transport::connect(&session_endpoint).await.unwrap();
            write_client_message(
                &mut session,
                &RelayClientMessage::Join {
                    channel_id,
                    device_id: agent_identity.device_id,
                    auth_token: agent_identity.auth_token,
                },
            )
            .await
            .unwrap();
            assert!(matches!(
                read_server_message(&mut session).await.unwrap(),
                RelayServerMessage::Linked { .. }
            ));
            let mut secure = SecureConnection::accept(session, "24681357").await.unwrap();
            assert_eq!(secure.receive().await.unwrap(), RemoteMessage::KeepAlive);
            secure.send(&RemoteMessage::KeepAlive).await.unwrap();
        });

        let (stream, agent_name) = dial(&endpoint, &identity.device_id).await.unwrap();
        assert_eq!(agent_name, "WebSocket host");
        let mut viewer = SecureConnection::initiate(stream, "2468-1357")
            .await
            .unwrap();
        viewer.send(&RemoteMessage::KeepAlive).await.unwrap();
        assert_eq!(viewer.receive().await.unwrap(), RemoteMessage::KeepAlive);
        agent.await.unwrap();
    }

    #[test]
    fn one_address_is_rate_limited_inside_the_window() {
        let state = RelayState::default();
        let ip: IpAddr = "203.0.113.9".parse().unwrap();
        for _ in 0..CONNECTIONS_PER_WINDOW {
            assert!(state.allow_connection(ip));
        }
        assert!(!state.allow_connection(ip));
        // Another address is unaffected.
        assert!(state.allow_connection("203.0.113.10".parse().unwrap()));
    }

    #[test]
    fn loopback_shares_no_budget_behind_the_ingress() {
        let state = RelayState::default();
        let v4: IpAddr = "127.0.0.1".parse().unwrap();
        let v6: IpAddr = "::1".parse().unwrap();
        for _ in 0..(CONNECTIONS_PER_WINDOW * 2) {
            assert!(state.allow_connection(v4));
            assert!(state.allow_connection(v6));
        }
    }

    #[cfg(unix)]
    #[test]
    fn persisted_device_registry_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;

        let directory = std::env::temp_dir().join(format!(
            "lattice-relay-registry-{}-{}",
            std::process::id(),
            random_channel_id().unwrap()
        ));
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join("devices.json");
        let state = RelayState::new(Some(path.clone()));

        let first = DeviceIdentity::generate().unwrap();
        state
            .verify_or_claim(&first.device_id, &first.auth_token)
            .unwrap();
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );

        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        let second = DeviceIdentity::generate().unwrap();
        state
            .verify_or_claim(&second.device_id, &second.auth_token)
            .unwrap();
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );

        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }

    #[tokio::test]
    async fn dialing_an_unknown_device_reports_offline() {
        let (address, _state) = start_relay().await;
        let error = match dial(&address.to_string(), "123456789").await {
            Err(error) => error,
            Ok(_) => panic!("an unknown device unexpectedly connected"),
        };
        match error {
            crate::relay::RelayError::Rejected { code, .. } => assert_eq!(code, "offline"),
            other => panic!("expected an offline rejection, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn a_device_id_cannot_be_claimed_with_another_token() {
        let (address, _state) = start_relay().await;
        let identity = DeviceIdentity::generate().unwrap();
        let _control = register_agent(address, &identity).await;

        let mut thief = TcpStream::connect(address).await.unwrap();
        write_client_message(
            &mut thief,
            &RelayClientMessage::Register {
                device_id: identity.device_id.clone(),
                auth_token: "different-token".to_string(),
                agent_name: "Impostor".to_string(),
            },
        )
        .await
        .unwrap();
        match read_server_message(&mut thief).await.unwrap() {
            RelayServerMessage::Error { code, .. } => assert_eq!(code, "unauthorized"),
            other => panic!("expected a rejection, got {other:?}"),
        }
    }
}
