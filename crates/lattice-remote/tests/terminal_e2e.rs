//! End-to-end terminal-mode check against the real built agent.
//!
//! Ignored by default because it spawns the agent and a real shell in a PTY.
//! Run explicitly with:
//!   cargo test --features agent --test terminal_e2e -- --ignored --nocapture
#![cfg(feature = "agent")]

use lattice_remote::{RemoteMessage, SecureConnection};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;
use tokio::time::timeout;

fn agent_binary() -> PathBuf {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("target");
    path.push("debug");
    path.push(if cfg!(windows) {
        "lattice-agent.exe"
    } else {
        "lattice-agent"
    });
    path
}

#[cfg(unix)]
struct TemporaryShell {
    directory: PathBuf,
    path: PathBuf,
}

#[cfg(unix)]
impl Drop for TemporaryShell {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
        let _ = std::fs::remove_dir(&self.directory);
    }
}

#[cfg(unix)]
fn immediate_output_shell(marker: &str) -> TemporaryShell {
    use std::os::unix::fs::PermissionsExt;
    use std::time::{SystemTime, UNIX_EPOCH};

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock after Unix epoch")
        .as_nanos();
    let directory = std::env::temp_dir().join(format!(
        "lattice-terminal-boot-e2e-{}-{nonce}",
        std::process::id()
    ));
    std::fs::create_dir(&directory).expect("create temporary shell directory");
    let path = directory.join("shell-wrapper");
    std::fs::write(
        &path,
        format!("#!/bin/sh\nprintf '%s\\r\\n' \"{marker}\"\nexec /bin/sh\n"),
    )
    .expect("write temporary shell wrapper");
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
        .expect("make temporary shell wrapper executable");
    TemporaryShell { directory, path }
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "spawns a real shell in a PTY; run manually"]
async fn captures_shell_output_emitted_immediately_after_spawn() {
    let binary = agent_binary();
    assert!(
        binary.is_file(),
        "build the agent first: cargo build --features agent --bin lattice-agent"
    );

    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock after Unix epoch")
        .as_nanos();
    let marker = format!("lattice-terminal-boot-{}-{nonce}", std::process::id());
    let shell = immediate_output_shell(&marker);
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("reserve local port");
    let port = listener.local_addr().expect("local address").port();
    drop(listener);

    let mut agent = Command::new(&binary)
        .args([
            "--json",
            "--terminal",
            "--bind",
            &format!("127.0.0.1:{port}"),
            "--pair-code",
            "97531864",
        ])
        .env("SHELL", &shell.path)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn agent");

    let stdout = agent.stdout.take().expect("agent stdout");
    let mut reader = BufReader::new(stdout);
    let mut ready = String::new();
    reader.read_line(&mut ready).expect("read ready line");
    assert!(ready.contains("\"kind\":\"ready\""), "unexpected: {ready}");

    let mut connection = SecureConnection::connect("127.0.0.1", port, "97531864")
        .await
        .expect("connect to agent");
    match timeout(Duration::from_secs(10), connection.receive())
        .await
        .expect("hello timeout")
        .expect("hello")
    {
        RemoteMessage::Hello(hello) => assert!(hello.terminal),
        other => panic!("expected hello before terminal output, got {other:?}"),
    }

    let mut seen = String::new();
    let found = timeout(Duration::from_secs(10), async {
        loop {
            match connection.receive().await {
                Ok(RemoteMessage::TerminalData { bytes }) => {
                    seen.push_str(&String::from_utf8_lossy(&bytes));
                    if seen.contains(&marker) {
                        return true;
                    }
                }
                Ok(RemoteMessage::Close(_)) | Err(_) => return false,
                Ok(_) => {}
            }
        }
    })
    .await
    .unwrap_or(false);

    let _ = connection.send(&RemoteMessage::Close("done".into())).await;
    let _ = agent.kill();
    let _ = agent.wait();

    assert!(
        found,
        "shell output emitted at spawn was not delivered; saw: {seen}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "spawns a real shell in a PTY; run manually"]
async fn paired_viewer_types_into_the_remote_shell() {
    let binary = agent_binary();
    assert!(
        binary.is_file(),
        "build the agent first: cargo build --features agent --bin lattice-agent"
    );

    let mut agent = Command::new(&binary)
        .args([
            "--json",
            "--terminal",
            "--allow-input",
            "--bind",
            "127.0.0.1:45919",
            "--pair-code",
            "86427531",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn agent");

    let stdout = agent.stdout.take().expect("agent stdout");
    let mut reader = BufReader::new(stdout);
    let mut ready = String::new();
    reader.read_line(&mut ready).expect("read ready line");
    assert!(ready.contains("\"kind\":\"ready\""), "unexpected: {ready}");

    let mut connection = SecureConnection::connect("127.0.0.1", 45919, "86427531")
        .await
        .expect("connect to agent");

    match connection.receive().await.expect("hello") {
        RemoteMessage::Hello(hello) => {
            assert!(hello.terminal, "agent should advertise terminal mode");
            assert!(!hello.view_only, "agent should advertise interactive mode");
            assert!(hello.width > 0 && hello.height > 0);
        }
        other => panic!("expected hello, got {other:?}"),
    }

    // Resizing must be accepted before and independently of typing.
    connection
        .send(&RemoteMessage::TerminalResize {
            cols: 100,
            rows: 40,
        })
        .await
        .expect("send resize");

    // Type a command whose echoed marker proves the round trip through the
    // real shell, regardless of prompt shape or platform.
    let marker = "lattice-terminal-e2e";
    connection
        .send(&RemoteMessage::TerminalInput {
            bytes: format!("echo {marker}\r").into_bytes(),
        })
        .await
        .expect("send keystrokes");

    let mut seen = String::new();
    let mut answered_probes = 0usize;
    let found = timeout(Duration::from_secs(15), async {
        loop {
            match connection.receive().await {
                Ok(RemoteMessage::TerminalData { bytes }) => {
                    seen.push_str(&String::from_utf8_lossy(&bytes));
                    // ConPTY probes the terminal with a Device Status Report
                    // and waits for the cursor answer, which a real xterm
                    // frontend supplies automatically.
                    let probes = seen.matches("\x1b[6n").count();
                    while answered_probes < probes {
                        answered_probes += 1;
                        connection
                            .send(&RemoteMessage::TerminalInput {
                                bytes: b"\x1b[1;1R".to_vec(),
                            })
                            .await
                            .expect("answer cursor probe");
                    }
                    if seen.matches(marker).count() >= 1 {
                        return true;
                    }
                }
                Ok(RemoteMessage::Close(_)) | Err(_) => return false,
                Ok(_) => {}
            }
        }
    })
    .await
    .unwrap_or(false);

    let _ = connection.send(&RemoteMessage::Close("done".into())).await;
    let _ = agent.kill();
    let _ = agent.wait();

    assert!(found, "shell output never echoed the marker; saw: {seen}");
}
