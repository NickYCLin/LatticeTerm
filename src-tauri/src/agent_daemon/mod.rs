//! Lattice Agent daemon: Agent Fleet sessions that outlive the desktop window.
//!
//! A session launched with "keep in the background" is owned by a separate
//! `lattice-term agent-daemon` process instead of the desktop. The daemon runs
//! the very same [`crate::agent::AgentRegistry`] — PTYs, lifecycle
//! heuristics, the prompt queue, the reporter listener and the integration
//! files all live there unchanged — and the desktop attaches over a
//! user-private local socket as a thin proxy. Closing the window drops the
//! connection; the CLIs keep running; the next window re-attaches and
//! replays the daemon's bounded output tail.
//!
//! Only a session the user explicitly detached goes through here. Every
//! other session stays in the desktop process exactly as before.
//!
//! Wire format: newline-delimited JSON frames, see [`Frame`]. Bytes ride as
//! base64 inside JSON like the desktop events already do. The first frame a
//! client sends must be a [`Request::Hello`] carrying the token from
//! `agent-daemon.token` (owner-only file in the application data directory);
//! anything else closes the connection.

pub mod automations;
pub mod client;
pub mod server;
#[cfg(test)]
mod tests;
mod transport;

use crate::agent::AgentLaunchRequest;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

/// Bumped when a frame changes shape; both sides refuse a mismatch.
pub const PROTOCOL_VERSION: u32 = 1;
/// Session ids minted by the daemon's registry. The desktop routes every
/// command by this prefix, so the two registries can never collide.
pub const SESSION_ID_PREFIX: &str = "agent-bg-session-";
/// The daemon exits once it has had no sessions and no clients this long.
pub const IDLE_EXIT: std::time::Duration = std::time::Duration::from_secs(60);
const TOKEN_FILE: &str = "agent-daemon.token";
pub const LOG_FILE: &str = "agent-daemon.log";
/// One frame at most: a launch carrying a 256 KiB restored tail as base64 is
/// the largest legitimate message; a staged clipboard image the largest
/// possible one.
pub const MAX_FRAME_BYTES: usize = 24 * 1024 * 1024;

/// Whether a session id belongs to the daemon rather than the desktop.
pub fn owns(session_id: &str) -> bool {
    session_id.starts_with(SESSION_ID_PREFIX)
}

/// Where one installation's daemon listens and keeps its token.
///
/// The token lives in the application data directory. The socket does not:
/// Unix socket paths are capped at about 100 bytes (`SUN_LEN`), which a
/// data directory under a long home path exceeds, so it goes into a short,
/// user-private directory under `$XDG_RUNTIME_DIR` (or the temp directory)
/// named by the user id, with the installation told apart by a hash of its
/// data directory.
#[derive(Clone, Debug)]
pub struct DaemonPaths {
    pub data_dir: PathBuf,
    pub socket: PathBuf,
    pub token: PathBuf,
}

/// FNV-1a of the data directory: stable, short, one per installation.
fn installation_hash(data_dir: &Path) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in data_dir.to_string_lossy().as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    hash
}

#[cfg(unix)]
fn socket_path(data_dir: &Path) -> PathBuf {
    let base = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
        .unwrap_or_else(std::env::temp_dir);
    // SAFETY: geteuid has no preconditions and cannot fail.
    let uid = unsafe { libc::geteuid() };
    base.join(format!("latticeterm-agent-{uid}"))
        .join(format!("{:016x}.sock", installation_hash(data_dir)))
}

#[cfg(not(unix))]
fn socket_path(data_dir: &Path) -> PathBuf {
    data_dir.join("agent-daemon.sock")
}

impl DaemonPaths {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            data_dir: data_dir.to_path_buf(),
            socket: socket_path(data_dir),
            token: data_dir.join(TOKEN_FILE),
        }
    }

    /// Windows has no socket files; the pipe name is derived from the data
    /// directory so two installations (or two users) never share one.
    #[cfg(windows)]
    pub fn pipe_name(&self) -> String {
        format!(
            r"\\.\pipe\latticeterm-agent-{:016x}",
            installation_hash(&self.data_dir)
        )
    }
}

/// Reads the shared token, creating it owner-only on first use. The token is
/// what makes the socket private on platforms whose socket ACLs are loose.
pub fn read_or_create_token(paths: &DaemonPaths) -> Result<String, String> {
    if let Ok(existing) = std::fs::read_to_string(&paths.token) {
        let token = existing.trim();
        if token.len() >= 32
            && token
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Ok(token.to_string());
        }
    }
    std::fs::create_dir_all(&paths.data_dir)
        .map_err(|error| format!("Cannot create the application data directory: {error}"))?;
    let token = crate::agent::random_report_token()?;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&paths.token)
        .map_err(|error| format!("Cannot write the daemon token: {error}"))?;
    use std::io::Write;
    file.write_all(token.as_bytes())
        .and_then(|_| file.write_all(b"\n"))
        .map_err(|error| format!("Cannot write the daemon token: {error}"))?;
    Ok(token)
}

/// One line on the wire.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Frame {
    Request {
        id: u64,
        body: Request,
    },
    Response {
        id: u64,
        ok: bool,
        #[serde(default)]
        result: Value,
        #[serde(default)]
        error: Option<String>,
    },
    /// The daemon's registry sink, forwarded: `name` is the short event name
    /// (`data`, `state`, ...) and `payload` the exact desktop event payload.
    Event {
        name: String,
        payload: Value,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Request {
    Hello {
        token: String,
        protocol: u32,
    },
    Launch {
        request: Box<AgentLaunchRequest>,
        /// Base64 of an earlier terminal tail to replay first, like the
        /// desktop's encrypted history does for a restored tab.
        #[serde(default)]
        restored_output: Option<String>,
    },
    Send {
        session_id: String,
        data: String,
    },
    Enqueue {
        session_id: String,
        data: String,
    },
    ClearQueue {
        session_id: String,
    },
    Broadcast {
        session_ids: Vec<String>,
        data: String,
    },
    Resize {
        session_id: String,
        cols: u32,
        rows: u32,
    },
    Disconnect {
        session_id: String,
    },
    Rename {
        session_id: String,
        label: String,
    },
    Sessions,
    Snapshots,
    /// A pasted image, already encoded as PNG; the daemon owns the temp file
    /// so it lives and dies with the PTY like a desktop-staged one.
    StageImage {
        session_id: String,
        png: String,
    },
    /// Ends every background session and the daemon itself.
    Shutdown,
    /// The window's whole automation list, runtime marks included.
    AutomationsReplace {
        automations: Vec<Value>,
    },
    AutomationsState,
    /// Finished background runs, handed over once.
    AutomationsTakeRuns,
}

/// What `Hello` answers with: everything a fresh window needs to attach.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelloReply {
    pub protocol: u32,
    pub sessions: Vec<crate::agent::AgentSessionSummary>,
    pub snapshots: Vec<crate::agent::AgentOutputSnapshot>,
}

/// Desktop event name for a forwarded sink event.
pub(crate) fn event_channel(name: &str) -> Option<&'static str> {
    use crate::agent::{
        EVENT_CAPTURE, EVENT_CLOSED, EVENT_DATA, EVENT_MODEL, EVENT_QUEUE, EVENT_STATE, EVENT_USAGE,
    };
    Some(match name {
        "data" => EVENT_DATA,
        "state" => EVENT_STATE,
        "closed" => EVENT_CLOSED,
        "captured" => EVENT_CAPTURE,
        "model" => EVENT_MODEL,
        "usage" => EVENT_USAGE,
        "queue" => EVENT_QUEUE,
        _ => return None,
    })
}

#[cfg(test)]
mod wire_tests {
    use super::*;

    #[test]
    fn frames_round_trip_with_camel_case_tags() {
        let frame = Frame::Request {
            id: 7,
            body: Request::ClearQueue {
                session_id: "agent-bg-session-1".into(),
            },
        };
        let line = serde_json::to_string(&frame).unwrap();
        assert!(line.contains(r#""kind":"request""#));
        assert!(line.contains(r#""type":"clearQueue""#));
        assert!(line.contains(r#""sessionId":"agent-bg-session-1""#));
        match serde_json::from_str::<Frame>(&line).unwrap() {
            Frame::Request {
                id: 7,
                body: Request::ClearQueue { session_id },
            } => assert_eq!(session_id, "agent-bg-session-1"),
            other => panic!("unexpected frame {other:?}"),
        }
        assert!(owns("agent-bg-session-3"));
        assert!(!owns("agent-session-3"));
    }

    #[cfg(unix)]
    #[test]
    fn the_socket_path_stays_short_and_per_installation() {
        let long = Path::new("/home/someone/with/a/really/long/home/directory/.local/share/io.github.nickyclin.latticeterm");
        let paths = DaemonPaths::new(long);
        assert!(paths.socket.as_os_str().len() < 100, "{:?}", paths.socket);
        assert_ne!(
            paths.socket,
            DaemonPaths::new(Path::new("/elsewhere")).socket
        );
        assert_eq!(paths.token, long.join("agent-daemon.token"));
    }

    #[test]
    fn the_token_is_created_once_and_reused() {
        let dir = tempfile::tempdir().unwrap();
        let paths = DaemonPaths::new(dir.path());
        let first = read_or_create_token(&paths).unwrap();
        let second = read_or_create_token(&paths).unwrap();
        assert_eq!(first, second);
        assert!(first.len() >= 32);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&paths.token)
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o600);
        }
        std::fs::write(&paths.token, "not a token\n").unwrap();
        let third = read_or_create_token(&paths).unwrap();
        assert_ne!(third, "not a token");
    }
}
