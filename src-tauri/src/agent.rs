//! Local AI CLI sessions backed by real pseudo-terminals.
//!
//! Commands are never interpolated into a shell string. A known agent resolves
//! to its fixed executable name; custom agents provide an executable and an
//! argument vector. Authentication stays with each CLI and its own config.

use base64::Engine;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::ffi::{OsStr, OsString};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

pub const EVENT_DATA: &str = "agent://data";
pub const EVENT_CLOSED: &str = "agent://closed";
pub const EVENT_STATE: &str = "agent://state";

const MAX_INPUT_BYTES: usize = 64 * 1024;
const MAX_ARGUMENTS: usize = 64;
const MAX_ARGUMENT_BYTES: usize = 4096;

#[derive(Debug, Clone, Copy)]
struct AgentSpec {
    id: &'static str,
    label: &'static str,
    executable: &'static str,
}

const AGENTS: [AgentSpec; 12] = [
    AgentSpec {
        id: "codex",
        label: "OpenAI Codex",
        executable: "codex",
    },
    AgentSpec {
        id: "claude",
        label: "Claude Code",
        executable: "claude",
    },
    AgentSpec {
        id: "gemini",
        label: "Gemini CLI",
        executable: "gemini",
    },
    AgentSpec {
        id: "opencode",
        label: "OpenCode",
        executable: "opencode",
    },
    AgentSpec {
        id: "copilot",
        label: "GitHub Copilot CLI",
        executable: "copilot",
    },
    AgentSpec {
        id: "hermes",
        label: "Hermes Agent",
        executable: "hermes",
    },
    AgentSpec {
        id: "cursor",
        label: "Cursor Agent",
        executable: "cursor-agent",
    },
    AgentSpec {
        id: "aider",
        label: "Aider",
        executable: "aider",
    },
    AgentSpec {
        id: "qwen",
        label: "Qwen Code",
        executable: "qwen",
    },
    AgentSpec {
        id: "kimi",
        label: "Kimi Code CLI",
        executable: "kimi",
    },
    AgentSpec {
        id: "droid",
        label: "Factory Droid",
        executable: "droid",
    },
    AgentSpec {
        id: "grok",
        label: "Grok CLI",
        executable: "grok",
    },
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDefinition {
    pub id: String,
    pub label: String,
    pub executable: String,
    pub installed: bool,
    pub installed_path: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentLifecycle {
    Working,
    NeedsAttention,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionSummary {
    pub session_id: String,
    pub definition_id: String,
    pub label: String,
    pub executable: String,
    pub working_directory: String,
    pub state: AgentLifecycle,
    pub process_id: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLaunchRequest {
    pub definition_id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub executable: String,
    #[serde(default)]
    pub arguments: Vec<String>,
    pub working_directory: String,
    pub cols: u32,
    pub rows: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentData {
    session_id: String,
    base64: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentClosed {
    session_id: String,
    reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentStateChanged {
    session_id: String,
    state: AgentLifecycle,
}

pub trait AgentSink: Send + Sync + 'static {
    fn data(&self, session_id: &str, bytes: &[u8]);
    fn state(&self, session_id: &str, state: AgentLifecycle);
    fn closed(&self, session_id: &str, reason: &str);
}

pub struct EventSink(pub AppHandle);

impl AgentSink for EventSink {
    fn data(&self, session_id: &str, bytes: &[u8]) {
        let _ = self.0.emit(
            EVENT_DATA,
            AgentData {
                session_id: session_id.to_string(),
                base64: encode(bytes),
            },
        );
    }

    fn state(&self, session_id: &str, state: AgentLifecycle) {
        let _ = self.0.emit(
            EVENT_STATE,
            AgentStateChanged {
                session_id: session_id.to_string(),
                state,
            },
        );
    }

    fn closed(&self, session_id: &str, reason: &str) {
        let _ = self.0.emit(
            EVENT_CLOSED,
            AgentClosed {
                session_id: session_id.to_string(),
                reason: reason.to_string(),
            },
        );
    }
}

struct AgentSessionEntry {
    summary: Mutex<AgentSessionSummary>,
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

#[derive(Default)]
pub struct AgentRegistry {
    sessions: Mutex<HashMap<String, Arc<AgentSessionEntry>>>,
    counter: AtomicU64,
}

impl AgentRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    fn next_id(&self) -> String {
        let n = self.counter.fetch_add(1, Ordering::Relaxed) + 1;
        format!("agent-session-{n}")
    }

    fn insert(
        &self,
        summary: &AgentSessionSummary,
        entry: Arc<AgentSessionEntry>,
    ) -> Result<(), String> {
        self.sessions
            .lock()
            .map_err(|error| error.to_string())?
            .insert(summary.session_id.clone(), entry);
        Ok(())
    }

    fn get(&self, session_id: &str) -> Result<Arc<AgentSessionEntry>, String> {
        self.sessions
            .lock()
            .map_err(|error| error.to_string())?
            .get(session_id)
            .cloned()
            .ok_or_else(|| "Agent session no longer exists.".to_string())
    }

    fn remove(&self, session_id: &str) -> Option<Arc<AgentSessionEntry>> {
        self.sessions.lock().ok()?.remove(session_id)
    }

    fn update_state(&self, session_id: &str, next: AgentLifecycle) -> bool {
        let Ok(entry) = self.get(session_id) else {
            return false;
        };
        let Ok(mut summary) = entry.summary.lock() else {
            return false;
        };
        if summary.state == next {
            return false;
        }
        summary.state = next;
        true
    }

    pub fn list(&self) -> Vec<AgentSessionSummary> {
        let Ok(sessions) = self.sessions.lock() else {
            return Vec::new();
        };
        let mut summaries: Vec<_> = sessions
            .values()
            .filter_map(|entry| entry.summary.lock().ok().map(|summary| summary.clone()))
            .collect();
        summaries.sort_by(|left, right| left.session_id.cmp(&right.session_id));
        summaries
    }
}

pub fn catalog() -> Vec<AgentDefinition> {
    AGENTS
        .iter()
        .map(|agent| {
            let path = find_executable(agent.executable);
            AgentDefinition {
                id: agent.id.to_string(),
                label: agent.label.to_string(),
                executable: agent.executable.to_string(),
                installed: path.is_some(),
                installed_path: path.map(|path| path.display().to_string()),
            }
        })
        .collect()
}

pub fn default_working_directory() -> Result<String, String> {
    std::env::current_dir()
        .map(|path| path.display().to_string())
        .map_err(|error| format!("Cannot read the current working directory: {error}"))
}

fn has_path_separator(value: &OsStr) -> bool {
    Path::new(value).components().count() > 1
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(windows)]
fn is_executable(path: &Path) -> bool {
    path.is_file()
        && path
            .extension()
            .and_then(OsStr::to_str)
            .is_some_and(|extension| {
                extension.eq_ignore_ascii_case("exe") || extension.eq_ignore_ascii_case("com")
            })
}

#[cfg(not(any(unix, windows)))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

fn executable_extensions(command: &OsStr) -> Vec<OsString> {
    #[cfg(windows)]
    {
        if Path::new(command).extension().is_some() {
            return vec![OsString::new()];
        }
        let mut values = vec![OsString::new()];
        let path_ext = std::env::var_os("PATHEXT").unwrap_or_else(|| OsString::from(".COM;.EXE"));
        values.extend(
            path_ext
                .to_string_lossy()
                .split(';')
                .filter(|value| {
                    value.eq_ignore_ascii_case(".COM") || value.eq_ignore_ascii_case(".EXE")
                })
                .map(OsString::from),
        );
        values
    }
    #[cfg(not(windows))]
    {
        let _ = command;
        vec![OsString::new()]
    }
}

fn find_executable(command: &str) -> Option<PathBuf> {
    let command = OsStr::new(command.trim());
    if command.is_empty() {
        return None;
    }
    let extensions = executable_extensions(command);
    let directories: Vec<PathBuf> = if has_path_separator(command) {
        vec![PathBuf::new()]
    } else {
        std::env::var_os("PATH")
            .map(|value| std::env::split_paths(&value).collect())
            .unwrap_or_default()
    };

    for directory in directories {
        for extension in &extensions {
            let mut candidate = directory.join(command);
            if !extension.is_empty() {
                candidate.set_extension(extension.to_string_lossy().trim_start_matches('.'));
            }
            if is_executable(&candidate) {
                return candidate.canonicalize().ok().or(Some(candidate));
            }
        }
    }
    None
}

fn validated_size(cols: u32, rows: u32) -> Result<PtySize, String> {
    if !(1..=1000).contains(&cols) || !(1..=1000).contains(&rows) {
        return Err("Terminal dimensions must be between 1 and 1000.".to_string());
    }
    Ok(PtySize {
        cols: cols as u16,
        rows: rows as u16,
        pixel_width: 0,
        pixel_height: 0,
    })
}

fn validate_text(value: &str, field: &str, max_bytes: usize) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{field} is required."));
    }
    if trimmed.len() > max_bytes {
        return Err(format!("{field} is too long."));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(format!("{field} contains control characters."));
    }
    Ok(trimmed.to_string())
}

fn resolve_launch(
    request: &AgentLaunchRequest,
) -> Result<(String, String, PathBuf, Vec<String>, PathBuf), String> {
    if request.arguments.len() > MAX_ARGUMENTS {
        return Err(format!("At most {MAX_ARGUMENTS} arguments are allowed."));
    }
    for argument in &request.arguments {
        if argument.len() > MAX_ARGUMENT_BYTES || argument.chars().any(char::is_control) {
            return Err("An argument is too long or contains control characters.".to_string());
        }
    }

    let definition_id = validate_text(&request.definition_id, "Agent type", 64)?;
    let (default_label, command) = if definition_id == "custom" {
        (
            validate_text(&request.label, "Agent label", 80)?,
            validate_text(&request.executable, "Executable", 512)?,
        )
    } else {
        let spec = AGENTS
            .iter()
            .find(|agent| agent.id == definition_id)
            .ok_or_else(|| "Unknown agent type.".to_string())?;
        (spec.label.to_string(), spec.executable.to_string())
    };

    let executable = find_executable(&command)
        .ok_or_else(|| format!("{default_label} is not installed or is not available on PATH."))?;
    let working_directory = PathBuf::from(validate_text(
        &request.working_directory,
        "Working directory",
        4096,
    )?)
    .canonicalize()
    .map_err(|error| format!("Cannot open the working directory: {error}"))?;
    if !working_directory.is_dir() {
        return Err("Working directory is not a directory.".to_string());
    }

    let label = if request.label.trim().is_empty() {
        default_label
    } else {
        validate_text(&request.label, "Agent label", 80)?
    };
    Ok((
        definition_id,
        label,
        executable,
        request.arguments.clone(),
        working_directory,
    ))
}

fn encode(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn decode(value: &str) -> Result<Vec<u8>, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(value)
        .map_err(|error| format!("Input was not valid base64: {error}"))?;
    if bytes.len() > MAX_INPUT_BYTES {
        return Err(format!(
            "One input event may contain at most {MAX_INPUT_BYTES} bytes."
        ));
    }
    Ok(bytes)
}

fn lifecycle_from_output(bytes: &[u8]) -> AgentLifecycle {
    let text = String::from_utf8_lossy(bytes).to_lowercase();
    const ATTENTION_MARKERS: [&str; 12] = [
        "do you want to",
        "would you like",
        "permission required",
        "approve?",
        "allow this",
        "proceed?",
        "continue?",
        "[y/n]",
        "(y/n)",
        "press enter",
        "是否允許",
        "請確認",
    ];
    if ATTENTION_MARKERS.iter().any(|marker| text.contains(marker)) {
        AgentLifecycle::NeedsAttention
    } else {
        AgentLifecycle::Working
    }
}

pub fn launch(
    sink: Arc<dyn AgentSink>,
    registry: Arc<AgentRegistry>,
    request: AgentLaunchRequest,
) -> Result<AgentSessionSummary, String> {
    let size = validated_size(request.cols, request.rows)?;
    let (definition_id, label, executable, arguments, working_directory) =
        resolve_launch(&request)?;
    let session_id = registry.next_id();

    let pair = native_pty_system()
        .openpty(size)
        .map_err(|error| format!("Cannot create a local terminal: {error}"))?;
    let mut command = CommandBuilder::new(&executable);
    command.args(arguments);
    command.cwd(&working_directory);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env("LATTICETERM_AGENT_SESSION", &session_id);

    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("Cannot start {label}: {error}"))?;
    drop(pair.slave);

    let process_id = child.process_id();
    let killer = child.clone_killer();
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("Cannot read the local terminal: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("Cannot write to the local terminal: {error}"))?;

    let summary = AgentSessionSummary {
        session_id: session_id.clone(),
        definition_id,
        label,
        executable: executable.display().to_string(),
        working_directory: working_directory.display().to_string(),
        state: AgentLifecycle::Working,
        process_id,
    };
    let entry = Arc::new(AgentSessionEntry {
        summary: Mutex::new(summary.clone()),
        writer: Mutex::new(writer),
        master: Mutex::new(pair.master),
        killer: Mutex::new(killer),
    });
    registry.insert(&summary, entry)?;

    let reader_id = session_id.clone();
    let reader_sink = Arc::clone(&sink);
    let reader_registry = Arc::clone(&registry);
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    let bytes = &buffer[..count];
                    reader_sink.data(&reader_id, bytes);
                    let state = lifecycle_from_output(bytes);
                    if reader_registry.update_state(&reader_id, state) {
                        reader_sink.state(&reader_id, state);
                    }
                }
                Err(_) => break,
            }
        }
    });

    let wait_id = session_id;
    let wait_registry = Arc::clone(&registry);
    std::thread::spawn(move || {
        let reason = match child.wait() {
            Ok(status) => format!("Process exited: {status:?}"),
            Err(error) => format!("Process wait failed: {error}"),
        };
        if wait_registry.remove(&wait_id).is_some() {
            sink.closed(&wait_id, &reason);
        }
    });

    Ok(summary)
}

pub fn send(
    sink: &dyn AgentSink,
    registry: &AgentRegistry,
    session_id: &str,
    encoded: &str,
) -> Result<(), String> {
    let bytes = decode(encoded)?;
    let entry = registry.get(session_id)?;
    let mut writer = entry.writer.lock().map_err(|error| error.to_string())?;
    writer
        .write_all(&bytes)
        .and_then(|_| writer.flush())
        .map_err(|error| format!("Cannot write to the agent terminal: {error}"))?;
    if registry.update_state(session_id, AgentLifecycle::Working) {
        sink.state(session_id, AgentLifecycle::Working);
    }
    Ok(())
}

pub fn resize(
    registry: &AgentRegistry,
    session_id: &str,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    let size = validated_size(cols, rows)?;
    let entry = registry.get(session_id)?;
    let result = entry
        .master
        .lock()
        .map_err(|error| error.to_string())?
        .resize(size)
        .map_err(|error| format!("Cannot resize the agent terminal: {error}"));
    result
}

pub fn disconnect(
    sink: &dyn AgentSink,
    registry: &AgentRegistry,
    session_id: &str,
) -> Result<(), String> {
    let entry = registry.get(session_id)?;
    entry
        .killer
        .lock()
        .map_err(|error| error.to_string())?
        .kill()
        .map_err(|error| format!("Cannot stop the agent process: {error}"))?;
    if registry.remove(session_id).is_some() {
        sink.closed(session_id, "Stopped by user");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::time::{Duration, Instant};

    #[derive(Default)]
    struct TestSink {
        data: Mutex<Vec<u8>>,
        closed: Mutex<Vec<String>>,
    }

    impl AgentSink for TestSink {
        fn data(&self, _session_id: &str, bytes: &[u8]) {
            self.data.lock().unwrap().extend_from_slice(bytes);
        }

        fn state(&self, _session_id: &str, _state: AgentLifecycle) {}

        fn closed(&self, _session_id: &str, reason: &str) {
            self.closed.lock().unwrap().push(reason.to_string());
        }
    }

    #[test]
    fn catalog_ids_are_unique() {
        let ids: HashSet<_> = AGENTS.iter().map(|agent| agent.id).collect();
        assert_eq!(ids.len(), AGENTS.len());
        assert!(ids.contains("codex"));
        assert!(ids.contains("hermes"));
    }

    #[test]
    fn attention_prompts_are_detected_conservatively() {
        assert_eq!(
            lifecycle_from_output(b"Permission required. Do you want to continue?"),
            AgentLifecycle::NeedsAttention
        );
        assert_eq!(
            lifecycle_from_output(b"Compiling dependency 42/100"),
            AgentLifecycle::Working
        );
    }

    #[test]
    fn input_decoder_rejects_oversized_events() {
        let encoded = encode(&vec![0_u8; MAX_INPUT_BYTES + 1]);
        assert!(decode(&encoded).unwrap_err().contains("at most"));
    }

    #[cfg(unix)]
    #[test]
    fn local_pty_round_trips_terminal_bytes() {
        let collector = Arc::new(TestSink::default());
        let sink: Arc<dyn AgentSink> = collector.clone();
        let registry = Arc::new(AgentRegistry::new());
        let request = AgentLaunchRequest {
            definition_id: "custom".to_string(),
            label: "Test cat".to_string(),
            executable: "/bin/cat".to_string(),
            arguments: Vec::new(),
            working_directory: std::env::current_dir().unwrap().display().to_string(),
            cols: 80,
            rows: 24,
        };
        let session = launch(sink.clone(), registry.clone(), request).unwrap();
        send(
            sink.as_ref(),
            &registry,
            &session.session_id,
            &encode(b"lattice-agent-test\n"),
        )
        .unwrap();

        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if String::from_utf8_lossy(&collector.data.lock().unwrap())
                .contains("lattice-agent-test")
            {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(
            String::from_utf8_lossy(&collector.data.lock().unwrap()).contains("lattice-agent-test")
        );
        disconnect(sink.as_ref(), &registry, &session.session_id).unwrap();
    }
}
