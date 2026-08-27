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
