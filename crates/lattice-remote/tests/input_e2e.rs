//! End-to-end input-injection check against the real built agent.
//!
//! Ignored by default because it spawns the agent, opens a real encrypted
//! connection, and moves the actual mouse cursor. Run explicitly with:
//!   cargo test --features agent --test input_e2e -- --ignored --nocapture
#![cfg(feature = "agent")]

use enigo::{Enigo, Mouse, Settings};
use lattice_remote::{RemoteInput, RemoteMessage, SecureConnection};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

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
#[ignore = "moves the real mouse cursor; run manually"]
async fn viewer_input_moves_the_host_cursor() {
    let binary = agent_binary();
    assert!(
        binary.is_file(),
        "build the agent first: cargo build --features agent --bin lattice-agent"
    );

    let mut agent = Command::new(&binary)
        .args([
            "--json",
            "--allow-input",
            "--bind",
            "127.0.0.1:45917",
            "--pair-code",
            "13572468",
            "--fps",
            "2",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn agent");

    // Wait for the ready line so we know it is listening.
    let stdout = agent.stdout.take().expect("agent stdout");
    let mut reader = BufReader::new(stdout);
    let mut ready = String::new();
    reader.read_line(&mut ready).expect("read ready line");
    assert!(ready.contains("\"kind\":\"ready\""), "unexpected: {ready}");

    let mut connection = SecureConnection::connect("127.0.0.1", 45917, "13572468")
        .await
        .expect("connect to agent");

    let (stream_width, stream_height) = match connection.receive().await.expect("hello") {
        RemoteMessage::Hello(hello) => {
            assert!(!hello.view_only, "agent should advertise interactive mode");
            (hello.width, hello.height)
        }
        other => panic!("expected hello, got {other:?}"),
    };

    // The agent maps stream-space onto the real display; the centre of the
    // stream must land near the centre of the display.
    let enigo = Enigo::new(&Settings::default()).expect("enigo");
    let (display_width, display_height) = enigo.main_display().expect("display size");
    let original = enigo.location().expect("cursor location");

    connection
        .send(&RemoteMessage::Input(RemoteInput::MouseMove {
            x: (stream_width / 2) as u16,
            y: (stream_height / 2) as u16,
        }))
        .await
        .expect("send mouse move");

    // Give the agent's input thread a moment to apply it.
    tokio::time::sleep(Duration::from_millis(400)).await;
    let (x, y) = enigo.location().expect("cursor location after move");

    // Restore the cursor before asserting so a failure does not strand it.
    let _ = connection
        .send(&RemoteMessage::Input(RemoteInput::MouseMove {
            x: ((original.0 as f64 / display_width as f64) * stream_width as f64) as u16,
            y: ((original.1 as f64 / display_height as f64) * stream_height as f64) as u16,
        }))
        .await;
    let _ = connection.send(&RemoteMessage::Close("done".into())).await;
    let _ = agent.kill();
    let _ = agent.wait();

    let target_x = display_width / 2;
    let target_y = display_height / 2;
    let tolerance = 12; // scaling rounds; the display may also be fractionally scaled
    assert!(
        (x - target_x).abs() <= tolerance && (y - target_y).abs() <= tolerance,
        "cursor landed at ({x},{y}); expected near ({target_x},{target_y})"
    );
}
