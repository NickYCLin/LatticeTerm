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
use tokio::time::{sleep, timeout};

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

async fn wait_for_agent_exit(agent: &mut std::process::Child) -> bool {
    timeout(Duration::from_secs(10), async {
        loop {
            match agent.try_wait() {
                Ok(Some(_)) => return true,
                Ok(None) => sleep(Duration::from_millis(25)).await,
                Err(_) => return false,
            }
        }
    })
    .await
    .unwrap_or(false)
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
        let _ = std::fs::remove_file(self.directory.join("background.pid"));
        let _ = std::fs::remove_file(self.directory.join("escaped.pid"));
        let _ = std::fs::remove_file(self.directory.join("leader.pid"));
        let _ = std::fs::remove_dir(&self.directory);
    }
}

#[cfg(unix)]
fn temporary_shell(label: &str, contents: &str) -> TemporaryShell {
    use std::os::unix::fs::PermissionsExt;
    use std::time::{SystemTime, UNIX_EPOCH};

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock after Unix epoch")
        .as_nanos();
    let directory = std::env::temp_dir().join(format!(
        "lattice-terminal-{label}-e2e-{}-{nonce}",
        std::process::id()
    ));
    std::fs::create_dir(&directory).expect("create temporary shell directory");
    let path = directory.join("shell-wrapper");
    std::fs::write(&path, contents).expect("write temporary shell wrapper");
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
        .expect("make temporary shell wrapper executable");
    TemporaryShell { directory, path }
}

#[cfg(unix)]
fn immediate_output_shell(marker: &str) -> TemporaryShell {
    temporary_shell(
        "boot",
        &format!("#!/bin/sh\nprintf '%s\\r\\n' \"{marker}\"\nexec /bin/sh\n"),
    )
}

#[cfg(unix)]
fn fast_exit_shell() -> TemporaryShell {
    temporary_shell("fast-exit", "#!/bin/sh\nexit 0\n")
}

#[cfg(target_os = "linux")]
fn background_child_shell() -> TemporaryShell {
    temporary_shell(
        "background-child",
        "#!/bin/sh\nset -m\ntrap '' HUP TERM\nsleep 15 &\nprintf '%s\\n' \"$!\" > \"${0%/*}/background.pid\"\nprintf '%s\\n' \"$$\" > \"${0%/*}/leader.pid\"\nexit 0\n",
    )
}

#[cfg(target_os = "linux")]
fn escaped_session_shell() -> TemporaryShell {
    temporary_shell(
        "escaped-session",
        "#!/bin/sh\nstty -echo\ntrap '' HUP TERM\nescaped_pid=\"${0%/*}/escaped.pid\"\nsetsid sh -c 'trap \"\" HUP TERM; printf \"%s\\n\" \"$$\" > \"$1\"; exec sleep 15' sh \"$escaped_pid\" &\nprintf '%s\\n' \"$$\" > \"${0%/*}/leader.pid\"\nexit 0\n",
    )
}

#[cfg(target_os = "linux")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct LinuxProcessIdentity {
    process_id: libc::pid_t,
    state: char,
    process_group: libc::pid_t,
    session_id: libc::pid_t,
    start_time: u64,
}

#[cfg(target_os = "linux")]
fn read_linux_process_identity(process_id: libc::pid_t) -> Option<LinuxProcessIdentity> {
    let stat = std::fs::read_to_string(format!("/proc/{process_id}/stat")).ok()?;
    let fields = stat
        .get(stat.rfind(')')? + 1..)?
        .split_whitespace()
        .collect::<Vec<_>>();
    Some(LinuxProcessIdentity {
        process_id,
        state: fields.first()?.chars().next()?,
        process_group: fields.get(2)?.parse().ok()?,
        session_id: fields.get(3)?.parse().ok()?,
        start_time: fields.get(19)?.parse().ok()?,
    })
}

#[cfg(target_os = "linux")]
fn open_verified_pidfd(
    process_id: libc::pid_t,
) -> Option<(std::os::fd::OwnedFd, LinuxProcessIdentity)> {
    use std::os::fd::FromRawFd as _;

    let before = read_linux_process_identity(process_id)?;
    // SAFETY: pidfd_open takes no userspace pointers and returns a newly owned
    // descriptor on success.
    let descriptor = unsafe { libc::syscall(libc::SYS_pidfd_open, process_id, 0) };
    if descriptor < 0 {
        return None;
    }
    let descriptor = unsafe { std::os::fd::OwnedFd::from_raw_fd(descriptor as libc::c_int) };
    (read_linux_process_identity(process_id) == Some(before)).then_some((descriptor, before))
}

#[cfg(target_os = "linux")]
fn send_pidfd_signal(descriptor: &std::os::fd::OwnedFd, signal: libc::c_int) -> bool {
    use std::os::fd::AsRawFd as _;

    // SAFETY: the signal targets the process pinned by this owned pidfd and
    // cannot target a subsequently reused numeric PID. A null siginfo with
    // flags zero requests ordinary signal delivery.
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
fn pidfd_process_is_alive(descriptor: &std::os::fd::OwnedFd) -> bool {
    send_pidfd_signal(descriptor, 0)
}

#[cfg(target_os = "linux")]
async fn wait_for_pidfd_exit(descriptor: &std::os::fd::OwnedFd) -> bool {
    use std::os::fd::AsRawFd as _;

    timeout(Duration::from_secs(10), async {
        loop {
            let mut poll_descriptor = libc::pollfd {
                fd: descriptor.as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            };
            // SAFETY: poll_descriptor and the borrowed pidfd remain valid for
            // this zero-timeout existence check.
            if unsafe { libc::poll(&mut poll_descriptor, 1, 0) } > 0 {
                return;
            }
            sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .is_ok()
}

#[cfg(target_os = "linux")]
async fn wait_for_process_state(process_id: libc::pid_t, state: char) -> LinuxProcessIdentity {
    timeout(Duration::from_secs(10), async {
        loop {
            if let Some(identity) = read_linux_process_identity(process_id) {
                if identity.state == state {
                    return identity;
                }
            }
            sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("process state timeout")
}

#[cfg(target_os = "linux")]
async fn wait_for_pid(path: &std::path::Path) -> libc::pid_t {
    timeout(Duration::from_secs(10), async {
        loop {
            if let Ok(contents) = std::fs::read_to_string(path) {
                if let Ok(process_id) = contents.trim().parse::<libc::pid_t>() {
                    if process_id > 1 {
                        return process_id;
                    }
                }
            }
            sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("process PID file timeout")
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
    let exited_cleanly = wait_for_agent_exit(&mut agent).await;
    if !exited_cleanly {
        let _ = agent.kill();
        let _ = agent.wait();
    }

    assert!(
        found,
        "shell output emitted at spawn was not delivered; saw: {seen}"
    );
    assert!(
        exited_cleanly,
        "agent did not finish terminal child cleanup after viewer close"
    );
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "spawns a real shell in a PTY; run manually"]
async fn fast_exit_shell_stops_agent_while_viewer_keeps_socket_open() {
    let binary = agent_binary();
    assert!(
        binary.is_file(),
        "build the agent first: cargo build --features agent --bin lattice-agent"
    );

    let shell = fast_exit_shell();
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
            "15935728",
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

    let mut connection = SecureConnection::connect("127.0.0.1", port, "15935728")
        .await
        .expect("connect to agent");
    match timeout(Duration::from_secs(10), connection.receive())
        .await
        .expect("hello timeout")
        .expect("hello")
    {
        RemoteMessage::Hello(hello) => assert!(hello.terminal),
        other => panic!("expected terminal hello, got {other:?}"),
    }

    // Deliberately keep the viewer connection alive and idle. PTY EOF must
    // wake serve_terminal without waiting for a viewer Close or socket EOF.
    let exited_cleanly = wait_for_agent_exit(&mut agent).await;
    if !exited_cleanly {
        let _ = agent.kill();
        let _ = agent.wait();
    }

    assert!(
        exited_cleanly,
        "agent did not stop after its shell exited while the viewer stayed connected"
    );
    drop(connection);
}

#[cfg(target_os = "linux")]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "spawns a real shell and background process in a PTY; run manually"]
async fn viewer_close_terminates_background_pty_descendants() {
    let binary = agent_binary();
    assert!(
        binary.is_file(),
        "build the agent first: cargo build --features agent --bin lattice-agent"
    );

    let shell = background_child_shell();
    let background_pid_path = shell.directory.join("background.pid");
    let leader_pid_path = shell.directory.join("leader.pid");
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
            "75315924",
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

    let mut connection = SecureConnection::connect("127.0.0.1", port, "75315924")
        .await
        .expect("connect to agent");
    match timeout(Duration::from_secs(10), connection.receive())
        .await
        .expect("hello timeout")
        .expect("hello")
    {
        RemoteMessage::Hello(hello) => assert!(hello.terminal),
        other => panic!("expected terminal hello, got {other:?}"),
    }

    let leader_pid = wait_for_pid(&leader_pid_path).await;
    let background_pid = wait_for_pid(&background_pid_path).await;
    let leader = wait_for_process_state(leader_pid, 'Z').await;
    let (background_pidfd, background) =
        open_verified_pidfd(background_pid).expect("open stable background pidfd");
    assert_eq!(
        leader.session_id, leader_pid,
        "shell must be the portable-pty session leader"
    );
    assert_eq!(
        background.session_id, leader_pid,
        "background job must remain in the PTY session"
    );
    assert_ne!(
        background.process_group, leader_pid,
        "set -m must place the regression job in a different process group"
    );
    assert!(
        pidfd_process_is_alive(&background_pidfd),
        "background child should remain alive after its shell leader exits"
    );
    connection
        .send(&RemoteMessage::Close("done".into()))
        .await
        .expect("send viewer close");

    let agent_exited = wait_for_agent_exit(&mut agent).await;
    let background_exited = wait_for_pidfd_exit(&background_pidfd).await;
    if !agent_exited {
        let _ = agent.kill();
        let _ = agent.wait();
    }

    assert!(agent_exited, "agent did not exit after viewer Close");
    assert!(
        background_exited,
        "background PTY child {background_pid} survived session teardown"
    );
}

#[cfg(target_os = "linux")]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "spawns a session-escaping process in a real PTY; run manually"]
async fn viewer_close_cancels_pty_pumps_with_a_setsid_descendant() {
    let binary = agent_binary();
    assert!(
        binary.is_file(),
        "build the agent first: cargo build --features agent --bin lattice-agent"
    );

    let shell = escaped_session_shell();
    let escaped_pid_path = shell.directory.join("escaped.pid");
    let leader_pid_path = shell.directory.join("leader.pid");
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("reserve local port");
    let port = listener.local_addr().expect("local address").port();
    drop(listener);

    let mut agent = Command::new(&binary)
        .args([
            "--json",
            "--terminal",
            "--allow-input",
            "--bind",
            &format!("127.0.0.1:{port}"),
            "--pair-code",
            "24681357",
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

    let mut connection = SecureConnection::connect("127.0.0.1", port, "24681357")
        .await
        .expect("connect to agent");
    match timeout(Duration::from_secs(10), connection.receive())
        .await
        .expect("hello timeout")
        .expect("hello")
    {
        RemoteMessage::Hello(hello) => {
            assert!(hello.terminal);
            assert!(!hello.view_only);
        }
        other => panic!("expected terminal hello, got {other:?}"),
    }

    let leader_pid = wait_for_pid(&leader_pid_path).await;
    let escaped_pid = wait_for_pid(&escaped_pid_path).await;
    let _leader = wait_for_process_state(leader_pid, 'Z').await;
    let (escaped_pidfd, escaped) =
        open_verified_pidfd(escaped_pid).expect("open stable escaped-child pidfd");
    assert_ne!(
        escaped.session_id, leader_pid,
        "setsid child must escape the portable-pty session"
    );
    assert!(pidfd_process_is_alive(&escaped_pidfd));

    // The escaped process retains the slave but never reads it. One maximum
    // input chunk fills the PTY enough to exercise cancellable partial writes.
    connection
        .send(&RemoteMessage::TerminalInput {
            bytes: vec![b'x'; 48 * 1024],
        })
        .await
        .expect("send terminal input flood");
    sleep(Duration::from_millis(100)).await;
    connection
        .send(&RemoteMessage::Close("done".into()))
        .await
        .expect("send viewer close");

    let agent_exited = wait_for_agent_exit(&mut agent).await;
    let escaped_survived_session_cleanup = pidfd_process_is_alive(&escaped_pidfd);
    let cleanup_signalled = send_pidfd_signal(&escaped_pidfd, libc::SIGKILL);
    let escaped_exited = wait_for_pidfd_exit(&escaped_pidfd).await;
    if !agent_exited {
        let _ = agent.kill();
        let _ = agent.wait();
    }

    assert!(
        agent_exited,
        "agent hung on PTY pumps retained by a setsid descendant"
    );
    assert!(
        escaped_survived_session_cleanup,
        "regression child unexpectedly remained inside session cleanup scope"
    );
    assert!(cleanup_signalled, "pidfd SIGKILL cleanup failed");
    assert!(escaped_exited, "escaped test process did not exit");
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
    let exited_cleanly = wait_for_agent_exit(&mut agent).await;
    if !exited_cleanly {
        let _ = agent.kill();
        let _ = agent.wait();
    }

    assert!(found, "shell output never echoed the marker; saw: {seen}");
    assert!(
        exited_cleanly,
        "agent did not finish terminal child cleanup after viewer close"
    );
}
