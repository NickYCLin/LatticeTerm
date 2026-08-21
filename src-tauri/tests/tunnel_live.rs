//! Live tunnel tests against the same throwaway OpenSSH container as ssh_live.
//!
//! Start the container, then run:
//!
//! ```text
//! docker run -d --name latticeterm-sshtest -p 2222:2222 -p 3333:3333 \
//!   -e PASSWORD_ACCESS=true -e USER_NAME=tester -e USER_PASSWORD=testpass123 \
//!   linuxserver/openssh-server
//! docker exec latticeterm-sshtest sed -i \
//!   -e 's/AllowTcpForwarding no/AllowTcpForwarding yes/' \
//!   -e 's/GatewayPorts no/GatewayPorts clientspecified/' /config/sshd/sshd_config
//! docker restart latticeterm-sshtest
//! cargo test --test tunnel_live -- --ignored --test-threads=1
//! ```

use latticeterm_lib::hostkeys::HostTrustStore;
use latticeterm_lib::ssh::{
    connect, AuthMethod, ConnectOutcome, ConnectRequest, SessionSink, SshRegistry,
};
use latticeterm_lib::tunnel::{
    start_tunnel, SshTunnelEndpoint, StartTunnelRequest, TunnelRegistry, TunnelStatus, TunnelType,
};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use zeroize::Zeroizing;

const HOST: &str = "127.0.0.1";
const SSH_PORT: u16 = 2222;
const USER: &str = "tester";
const PASSWORD: &str = "testpass123";
const REMOTE_FORWARD_PORT: u16 = 3333;

struct NoopSink;

impl SessionSink for NoopSink {
    fn data(&self, _session_id: &str, _bytes: &[u8]) {}
    fn closed(&self, _session_id: &str, _reason: &str) {}
}

fn temp_dir() -> std::path::PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("latticeterm-tunnel-live-{unique}"));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

async fn free_port() -> u16 {
    let listener = TcpListener::bind((HOST, 0)).await.unwrap();
    listener.local_addr().unwrap().port()
}

async fn trusted_host() -> latticeterm_lib::hostkeys::HostKeyRecord {
    let request = ConnectRequest {
        profile_id: "tunnel-live".to_string(),
        hostname: HOST.to_string(),
        port: SSH_PORT,
        username: USER.to_string(),
        auth: AuthMethod::Password {
            password: PASSWORD.to_string(),
        },
        use_saved_password: false,
        remember_password: false,
        cols: 80,
        rows: 24,
    };
    let outcome = connect(
        Arc::new(NoopSink),
        Arc::new(SshRegistry::new()),
        None,
        request,
    )
    .await;
    let (algorithm, fingerprint) = match outcome {
        ConnectOutcome::HostUnknown {
            algorithm,
            fingerprint,
            ..
        } => (algorithm, fingerprint),
        other => panic!("expected HostUnknown from the live server, got {other:?}"),
    };
    HostTrustStore::open(&temp_dir())
        .unwrap()
        .trust(HOST, SSH_PORT, &algorithm, &fingerprint, 1)
        .unwrap()
}

fn endpoint() -> SshTunnelEndpoint {
    SshTunnelEndpoint {
        hostname: HOST.to_string(),
        port: SSH_PORT,
        username: USER.to_string(),
    }
}

fn request(id: &str, tunnel_type: TunnelType, local_port: u16) -> StartTunnelRequest {
    StartTunnelRequest {
        tunnel_id: id.to_string(),
        tunnel_type,
        profile_id: "tunnel-live".to_string(),
        local_host: HOST.to_string(),
        local_port,
        // The OpenSSH service inside the container listens on 2222, so its
        // banner is a deterministic target reachable from the SSH server.
        remote_host: HOST.to_string(),
        remote_port: SSH_PORT,
    }
}

async fn read_ssh_banner(stream: &mut TcpStream) -> String {
    let mut bytes = [0u8; 128];
    let count = tokio::time::timeout(Duration::from_secs(10), stream.read(&mut bytes))
        .await
        .expect("timed out waiting for the forwarded SSH banner")
        .expect("failed to read the forwarded SSH banner");
    String::from_utf8_lossy(&bytes[..count]).to_string()
}

#[tokio::test]
#[ignore = "needs the throwaway SSH container"]
async fn local_forwarding_carries_real_bytes_over_direct_tcpip() {
    let registry = Arc::new(TunnelRegistry::new());
    let local_port = free_port().await;
    let started = start_tunnel(
        Arc::clone(&registry),
        Some(trusted_host().await),
        Zeroizing::new(PASSWORD.to_string()),
        request("live-local", TunnelType::Local, local_port),
        endpoint(),
    )
    .await
    .unwrap();
    assert_eq!(started.status, TunnelStatus::Active);

    let mut stream = TcpStream::connect((HOST, local_port)).await.unwrap();
    assert!(read_ssh_banner(&mut stream).await.starts_with("SSH-"));

    registry.stop("live-local").unwrap();
    assert_eq!(
        registry.status("live-local").unwrap().status,
        TunnelStatus::Stopped
    );
}

#[tokio::test]
#[ignore = "needs the throwaway SSH container"]
async fn socks5_connect_carries_real_bytes_over_direct_tcpip() {
    let registry = Arc::new(TunnelRegistry::new());
    let local_port = free_port().await;
    start_tunnel(
        Arc::clone(&registry),
        Some(trusted_host().await),
        Zeroizing::new(PASSWORD.to_string()),
        request("live-socks", TunnelType::Dynamic, local_port),
        endpoint(),
    )
    .await
    .unwrap();

    let mut stream = TcpStream::connect((HOST, local_port)).await.unwrap();
    stream.write_all(&[0x05, 0x01, 0x00]).await.unwrap();
    let mut method_reply = [0u8; 2];
    stream.read_exact(&mut method_reply).await.unwrap();
    assert_eq!(method_reply, [0x05, 0x00]);

    stream
        .write_all(&[
            0x05,
            0x01,
            0x00,
            0x01,
            127,
            0,
            0,
            1,
            (SSH_PORT >> 8) as u8,
            SSH_PORT as u8,
        ])
        .await
        .unwrap();
    let mut connect_reply = [0u8; 10];
    stream.read_exact(&mut connect_reply).await.unwrap();
    assert_eq!(connect_reply[0..2], [0x05, 0x00]);
    assert!(read_ssh_banner(&mut stream).await.starts_with("SSH-"));

    registry.stop("live-socks").unwrap();
}

#[tokio::test]
#[ignore = "needs the throwaway SSH container with port 3333 published"]
async fn remote_forwarding_bridges_server_connections_back_to_a_local_target() {
    let target = TcpListener::bind((HOST, 0)).await.unwrap();
    let target_port = target.local_addr().unwrap().port();
    let echo = tokio::spawn(async move {
        let (mut stream, _) = target.accept().await.unwrap();
        let mut payload = [0u8; 24];
        let count = stream.read(&mut payload).await.unwrap();
        stream.write_all(&payload[..count]).await.unwrap();
    });

    let registry = Arc::new(TunnelRegistry::new());
    let mut remote = request("live-remote", TunnelType::Remote, REMOTE_FORWARD_PORT);
    remote.local_host = "0.0.0.0".to_string();
    remote.remote_port = target_port;
    start_tunnel(
        Arc::clone(&registry),
        Some(trusted_host().await),
        Zeroizing::new(PASSWORD.to_string()),
        remote,
        endpoint(),
    )
    .await
    .unwrap();

    let mut stream = TcpStream::connect((HOST, REMOTE_FORWARD_PORT))
        .await
        .unwrap();
    stream.write_all(b"lattice-remote-ok").await.unwrap();
    let mut reply = [0u8; 17];
    stream.read_exact(&mut reply).await.unwrap();
    assert_eq!(&reply, b"lattice-remote-ok");

    echo.await.unwrap();
    registry.stop("live-remote").unwrap();
}
