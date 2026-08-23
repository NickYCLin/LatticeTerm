//! Local AI CLI sessions backed by real pseudo-terminals.
//!
//! Commands are never interpolated into a shell string. A known agent resolves
//! to its fixed executable name; custom agents provide an executable and an
//! argument vector. Authentication stays with each CLI and its own config.

use base64::Engine;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::ffi::{OsStr, OsString};
use std::io::{Read, Write};
use std::net::{Shutdown, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub const EVENT_DATA: &str = "agent://data";
pub const EVENT_CLOSED: &str = "agent://closed";
pub const EVENT_STATE: &str = "agent://state";
pub const EVENT_CAPTURE: &str = "agent://capture";

const MAX_INPUT_BYTES: usize = 64 * 1024;
const MAX_ARGUMENTS: usize = 64;
const MAX_ARGUMENT_BYTES: usize = 4096;
const MAX_RESUME_SESSION_ID_BYTES: usize = 512;
const MAX_BROADCAST_TARGETS: usize = 32;
pub const MAX_AGENT_SESSIONS: usize = 32;
pub const MAX_SAVED_AGENT_PLANS: usize = 32;
const MAX_OUTPUT_SNAPSHOT_BYTES: usize = 256 * 1024;
const MAX_REPORT_BYTES: u64 = 4096;
const REPORT_TIMEOUT: Duration = Duration::from_secs(1);
const REPORT_RETRIES: usize = 5;

const AGENT_ADAPTER_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy)]
enum AgentResumeRecipe {
    Subcommand,
    Flag,
}

impl AgentResumeRecipe {
    fn arguments(self, session_id: String) -> Vec<String> {
        match self {
            Self::Subcommand => vec!["resume".to_string(), session_id],
            Self::Flag => vec!["--resume".to_string(), session_id],
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct AgentSpec {
    id: &'static str,
    label: &'static str,
    executable: &'static str,
    resume_recipe: Option<AgentResumeRecipe>,
}

const AGENTS: [AgentSpec; 12] = [
    AgentSpec {
        id: "codex",
        label: "OpenAI Codex",
        executable: "codex",
        resume_recipe: Some(AgentResumeRecipe::Subcommand),
    },
    AgentSpec {
        id: "claude",
        label: "Claude Code",
        executable: "claude",
        resume_recipe: Some(AgentResumeRecipe::Flag),
    },
    AgentSpec {
        id: "gemini",
        label: "Gemini CLI",
        executable: "gemini",
        resume_recipe: Some(AgentResumeRecipe::Flag),
    },
    AgentSpec {
        id: "opencode",
        label: "OpenCode",
        executable: "opencode",
        resume_recipe: None,
    },
    AgentSpec {
        id: "copilot",
        label: "GitHub Copilot CLI",
        executable: "copilot",
        resume_recipe: None,
    },
    AgentSpec {
        id: "hermes",
        label: "Hermes Agent",
        executable: "hermes",
        resume_recipe: Some(AgentResumeRecipe::Flag),
    },
    AgentSpec {
        id: "cursor",
        label: "Cursor Agent",
        executable: "cursor-agent",
        resume_recipe: None,
    },
    AgentSpec {
        id: "aider",
        label: "Aider",
        executable: "aider",
        resume_recipe: None,
    },
    AgentSpec {
        id: "qwen",
        label: "Qwen Code",
        executable: "qwen",
        resume_recipe: None,
    },
    AgentSpec {
        id: "kimi",
        label: "Kimi Code CLI",
        executable: "kimi",
        resume_recipe: None,
    },
    AgentSpec {
        id: "droid",
        label: "Factory Droid",
        executable: "droid",
        resume_recipe: None,
    },
    AgentSpec {
        id: "grok",
        label: "Grok CLI",
        executable: "grok",
        resume_recipe: None,
    },
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDefinition {
    pub id: String,
    pub label: String,
    pub executable: String,
    pub adapter_version: u32,
    pub resume_supported: bool,
    pub installed: bool,
    pub installed_path: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentLifecycle {
    Working,
    NeedsAttention,
    Idle,
    Done,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentStateSource {
    Heuristic,
    Integration,
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
    pub state_source: AgentStateSource,
    pub process_id: Option<u32>,
    /// The CLI's own session id, when its output announced one — the value
    /// native resume takes. Never guessed: absent until actually seen.
    pub captured_session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentBroadcastOutcome {
    pub session_id: String,
    pub delivered: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentOutputSnapshot {
    pub session_id: String,
    pub start_offset: u64,
    pub end_offset: u64,
    pub base64: String,
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
    #[serde(default)]
    pub resume_session_id: Option<String>,
    pub working_directory: String,
    pub cols: u32,
    pub rows: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLaunchPlanDraft {
    pub definition_id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub executable: String,
    #[serde(default)]
    pub arguments: Vec<String>,
    #[serde(default)]
    pub resume_session_id: Option<String>,
    pub working_directory: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLaunchPlan {
    pub id: String,
    pub definition_id: String,
    pub label: String,
    pub executable: String,
    pub arguments: Vec<String>,
    #[serde(default)]
    pub resume_session_id: Option<String>,
    pub working_directory: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRestoreOutcome {
    pub plan_id: String,
    pub label: String,
    pub session: Option<AgentSessionSummary>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentData {
    session_id: String,
    offset: u64,
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
    source: AgentStateSource,
}

pub trait AgentSink: Send + Sync + 'static {
    fn data(&self, session_id: &str, offset: u64, bytes: &[u8]);
    fn state(&self, session_id: &str, state: AgentLifecycle, source: AgentStateSource);
    fn closed(&self, session_id: &str, reason: &str);
    fn captured(&self, session_id: &str, native_session_id: &str);
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentSessionIdCaptured {
    session_id: String,
    native_session_id: String,
}

pub struct EventSink(pub AppHandle);

impl AgentSink for EventSink {
    fn data(&self, session_id: &str, offset: u64, bytes: &[u8]) {
        let _ = self.0.emit(
            EVENT_DATA,
            AgentData {
                session_id: session_id.to_string(),
                offset,
                base64: encode(bytes),
            },
        );
    }

    fn state(&self, session_id: &str, state: AgentLifecycle, source: AgentStateSource) {
        let _ = self.0.emit(
            EVENT_STATE,
            AgentStateChanged {
                session_id: session_id.to_string(),
                state,
                source,
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

    fn captured(&self, session_id: &str, native_session_id: &str) {
        let _ = self.0.emit(
            EVENT_CAPTURE,
            AgentSessionIdCaptured {
                session_id: session_id.to_string(),
                native_session_id: native_session_id.to_string(),
            },
        );
    }
}

struct AgentSessionEntry {
    summary: Mutex<AgentSessionSummary>,
    report_token: Option<String>,
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    capture: Mutex<CaptureState>,
    output: Mutex<OutputBuffer>,
}

#[derive(Default)]
struct OutputBuffer {
    bytes: VecDeque<u8>,
    start_offset: u64,
    end_offset: u64,
}

impl OutputBuffer {
    fn append(&mut self, bytes: &[u8]) -> u64 {
        let offset = self.end_offset;
        self.end_offset = self.end_offset.saturating_add(bytes.len() as u64);
        self.bytes.extend(bytes);
        if self.bytes.len() > MAX_OUTPUT_SNAPSHOT_BYTES {
            let overflow = self.bytes.len() - MAX_OUTPUT_SNAPSHOT_BYTES;
            self.bytes.drain(..overflow);
            self.start_offset = self.start_offset.saturating_add(overflow as u64);
        }
        offset
    }

    fn snapshot(&self, session_id: &str) -> AgentOutputSnapshot {
        let bytes = self.bytes.iter().copied().collect::<Vec<_>>();
        AgentOutputSnapshot {
            session_id: session_id.to_string(),
            start_offset: self.start_offset,
            end_offset: self.end_offset,
            base64: encode(&bytes),
        }
    }
}

/// Rolling window over a session's output while its native session id has
/// not been seen yet. Bounded so an agent that never announces one costs a
/// few kilobytes, not unbounded growth.
struct CaptureState {
    enabled: bool,
    buffer: String,
}

/// How much stripped output the capture window retains across chunks.
const CAPTURE_WINDOW_CHARS: usize = 4096;

impl CaptureState {
    /// Feeds one raw output chunk into the window and returns a session id
    /// the moment one is seen. Ids split across chunks are still found,
    /// because matching runs over the retained window, not the chunk.
    fn feed(&mut self, bytes: &[u8]) -> Option<String> {
        if !self.enabled {
            return None;
        }
        let stripped = strip_ansi(&String::from_utf8_lossy(bytes));
        self.buffer.push_str(&stripped);
        let length = self.buffer.chars().count();
        if length > CAPTURE_WINDOW_CHARS {
            self.buffer = self
                .buffer
                .chars()
                .skip(length - CAPTURE_WINDOW_CHARS)
                .collect();
        }
        let found = find_native_session_id(&self.buffer)?;
        self.enabled = false;
        self.buffer.clear();
        Some(found)
    }
}

#[derive(Clone)]
struct ReporterEndpoint {
    address: SocketAddr,
    executable: PathBuf,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReporterMessage {
    session_id: String,
    token: String,
    state: AgentLifecycle,
}

fn agent_session_limit_reached(session_count: usize) -> bool {
    session_count >= MAX_AGENT_SESSIONS
}

#[derive(Default)]
pub struct AgentRegistry {
    sessions: Mutex<HashMap<String, Arc<AgentSessionEntry>>>,
    counter: AtomicU64,
    reporter: Option<ReporterEndpoint>,
}

impl AgentRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_local_reporter(sink: Arc<dyn AgentSink>) -> Result<Arc<Self>, String> {
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .map_err(|error| format!("Cannot start the local agent reporter: {error}"))?;
        let address = listener
            .local_addr()
            .map_err(|error| format!("Cannot read the local reporter address: {error}"))?;
        let executable = std::env::current_exe()
            .map_err(|error| format!("Cannot locate the LatticeTerm executable: {error}"))?;
        let registry = Arc::new(Self {
            reporter: Some(ReporterEndpoint {
                address,
                executable,
            }),
            ..Self::default()
        });
        let thread_registry = Arc::clone(&registry);
        std::thread::Builder::new()
            .name("latticeterm-agent-reporter".to_string())
            .spawn(move || {
                for stream in listener.incoming().flatten() {
                    handle_report_connection(stream, &thread_registry, sink.as_ref());
                }
            })
            .map_err(|error| format!("Cannot run the local agent reporter: {error}"))?;
        Ok(registry)
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
        let mut sessions = self.sessions.lock().map_err(|error| error.to_string())?;
        if agent_session_limit_reached(sessions.len()) {
            return Err(format!(
                "At most {MAX_AGENT_SESSIONS} agent sessions may run at once."
            ));
        }
        sessions.insert(summary.session_id.clone(), entry);
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

    fn update_state(
        &self,
        session_id: &str,
        next: AgentLifecycle,
        source: AgentStateSource,
    ) -> bool {
        let Ok(entry) = self.get(session_id) else {
            return false;
        };
        let Ok(mut summary) = entry.summary.lock() else {
            return false;
        };
        if summary.state_source == AgentStateSource::Integration
            && source == AgentStateSource::Heuristic
        {
            return false;
        }
        if summary.state == next && summary.state_source == source {
            return false;
        }
        summary.state = next;
        summary.state_source = source;
        true
    }

    /// Feeds one output chunk into the session's capture window and returns
    /// a newly seen native session id, if any. The window spans chunks, so an
    /// id split across two reads is still found.
    fn scan_for_session_id(&self, session_id: &str, bytes: &[u8]) -> Option<String> {
        let entry = self.get(session_id).ok()?;
        let found = entry.capture.lock().ok()?.feed(bytes)?;

        let mut summary = entry.summary.lock().ok()?;
        if summary.captured_session_id.as_deref() == Some(found.as_str()) {
            return None;
        }
        summary.captured_session_id = Some(found.clone());
        Some(found)
    }

    fn record_output(&self, session_id: &str, bytes: &[u8]) -> Result<u64, String> {
        let entry = self.get(session_id)?;
        let offset = entry
            .output
            .lock()
            .map_err(|error| error.to_string())?
            .append(bytes);
        Ok(offset)
    }

    fn update_reported_state(
        &self,
        session_id: &str,
        token: &str,
        next: AgentLifecycle,
    ) -> Result<bool, String> {
        let entry = self.get(session_id)?;
        if entry.report_token.as_deref() != Some(token) {
            return Err("Reporter authentication failed.".to_string());
        }
        Ok(self.update_state(session_id, next, AgentStateSource::Integration))
    }

    #[cfg(test)]
    fn reporter_credentials(&self, session_id: &str) -> Option<(SocketAddr, String)> {
        let endpoint = self.reporter.as_ref()?;
        let entry = self.get(session_id).ok()?;
        Some((endpoint.address, entry.report_token.clone()?))
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

    pub fn output_snapshots(&self) -> Vec<AgentOutputSnapshot> {
        let Ok(sessions) = self.sessions.lock() else {
            return Vec::new();
        };
        let mut snapshots = sessions
            .iter()
            .filter_map(|(session_id, entry)| {
                entry
                    .output
                    .lock()
                    .ok()
                    .map(|output| output.snapshot(session_id))
            })
            .collect::<Vec<_>>();
        snapshots.sort_by(|left, right| left.session_id.cmp(&right.session_id));
        snapshots
    }

    /// Stop every child before the desktop process exits or restarts.
    pub fn stop_all(&self) {
        let entries: Vec<_> = match self.sessions.lock() {
            Ok(mut sessions) => sessions.drain().map(|(_, entry)| entry).collect(),
            Err(_) => return,
        };
        for entry in entries {
            let _ = terminate_agent_entry(entry.as_ref());
        }
    }
}

fn terminate_agent_entry(entry: &AgentSessionEntry) -> Result<(), String> {
    #[cfg(unix)]
    {
        let process_id = entry
            .summary
            .lock()
            .map_err(|error| error.to_string())?
            .process_id;
        if let Some(process_id) = process_id {
            let process_group = i32::try_from(process_id)
                .map_err(|_| "The agent process ID is invalid.".to_string())?;

            // portable-pty creates the child with setsid(), so its PID is also
            // the PTY process-group ID. ChildKiller only sends SIGHUP to the
            // leader on Unix; interactive Node CLIs such as Codex can keep
            // running after that signal. Terminating the group lets the CLI
            // perform its normal child cleanup instead of orphaning it.
            let result = unsafe { libc::kill(-process_group, libc::SIGTERM) };
            if result == 0 {
                return Ok(());
            }

            let error = std::io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::ESRCH) {
                return Ok(());
            }
            return Err(format!("Cannot stop the agent process group: {error}"));
        }
    }

    entry
        .killer
        .lock()
        .map_err(|error| error.to_string())?
        .kill()
        .map_err(|error| format!("Cannot stop the agent process: {error}"))
}

fn random_report_token() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|error| format!("Cannot create an agent reporter token: {error}"))?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

fn write_report_response(stream: &mut TcpStream, accepted: bool) {
    let _ = stream.write_all(if accepted { b"ok\n" } else { b"error\n" });
    let _ = stream.flush();
}

fn handle_report_connection(mut stream: TcpStream, registry: &AgentRegistry, sink: &dyn AgentSink) {
    let _ = stream.set_read_timeout(Some(REPORT_TIMEOUT));
    let _ = stream.set_write_timeout(Some(REPORT_TIMEOUT));
    let mut payload = Vec::new();
    if std::io::Read::by_ref(&mut stream)
        .take(MAX_REPORT_BYTES + 1)
        .read_to_end(&mut payload)
        .is_err()
        || payload.len() as u64 > MAX_REPORT_BYTES
    {
        write_report_response(&mut stream, false);
        return;
    }
    let Ok(message) = serde_json::from_slice::<ReporterMessage>(&payload) else {
        write_report_response(&mut stream, false);
        return;
    };
    let accepted =
        match registry.update_reported_state(&message.session_id, &message.token, message.state) {
            Ok(changed) => {
                if changed {
                    sink.state(
                        &message.session_id,
                        message.state,
                        AgentStateSource::Integration,
                    );
                }
                true
            }
            Err(_) => false,
        };
    write_report_response(&mut stream, accepted);
}

fn send_report_once(
    address: SocketAddr,
    session_id: &str,
    token: &str,
    state: AgentLifecycle,
) -> Result<(), String> {
    if !address.ip().is_loopback() {
        return Err("The agent reporter address must be loopback-only.".to_string());
    }
    let mut stream = TcpStream::connect_timeout(&address, REPORT_TIMEOUT)
        .map_err(|error| format!("Cannot reach the local agent reporter: {error}"))?;
    stream
        .set_read_timeout(Some(REPORT_TIMEOUT))
        .map_err(|error| format!("Cannot configure the agent reporter: {error}"))?;
    stream
        .set_write_timeout(Some(REPORT_TIMEOUT))
        .map_err(|error| format!("Cannot configure the agent reporter: {error}"))?;
    let payload = serde_json::to_vec(&ReporterMessage {
        session_id: session_id.to_string(),
        token: token.to_string(),
        state,
    })
    .map_err(|error| format!("Cannot encode the agent state: {error}"))?;
    if payload.len() as u64 > MAX_REPORT_BYTES {
        return Err("The agent state report is too large.".to_string());
    }
    stream
        .write_all(&payload)
        .and_then(|_| stream.shutdown(Shutdown::Write))
        .map_err(|error| format!("Cannot send the agent state: {error}"))?;
    let mut response = String::new();
    stream
        .take(16)
        .read_to_string(&mut response)
        .map_err(|error| format!("Cannot read the agent reporter response: {error}"))?;
    if response == "ok\n" {
        Ok(())
    } else {
        Err("The agent reporter rejected the state update.".to_string())
    }
}

fn send_report(
    address: SocketAddr,
    session_id: &str,
    token: &str,
    state: AgentLifecycle,
) -> Result<(), String> {
    let mut last_error = None;
    for attempt in 0..REPORT_RETRIES {
        match send_report_once(address, session_id, token, state) {
            Ok(()) => return Ok(()),
            Err(error) => last_error = Some(error),
        }
        if attempt + 1 < REPORT_RETRIES {
            std::thread::sleep(Duration::from_millis(40));
        }
    }
    Err(last_error.unwrap_or_else(|| "The agent state report failed.".to_string()))
}

fn lifecycle_from_report_arg(value: &str) -> Option<AgentLifecycle> {
    match value {
        "working" => Some(AgentLifecycle::Working),
        "needs-attention" | "needsAttention" => Some(AgentLifecycle::NeedsAttention),
        "idle" => Some(AgentLifecycle::Idle),
        "done" => Some(AgentLifecycle::Done),
        _ => None,
    }
}

/// Handle the tiny reporter subcommand before Tauri starts.
///
/// Adapter hooks can run `$LATTICETERM_AGENT_REPORTER agent-report done` and
/// credentials are taken only from the environment of that PTY child.
pub fn run_reporter_cli<I, S>(args: I) -> Option<i32>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut args = args.into_iter();
    if args.next()?.as_ref() != OsStr::new("agent-report") {
        return None;
    }
    let Some(state) = args
        .next()
        .and_then(|value| value.as_ref().to_str().and_then(lifecycle_from_report_arg))
    else {
        eprintln!("usage: latticeterm agent-report <working|needs-attention|idle|done>");
        return Some(2);
    };
    if args.next().is_some() {
        eprintln!("agent-report accepts exactly one state");
        return Some(2);
    }
    let result = (|| {
        let address: SocketAddr = std::env::var("LATTICETERM_AGENT_REPORT_ADDR")
            .map_err(|_| "Agent reporter environment is unavailable.".to_string())?
            .parse()
            .map_err(|_| "Agent reporter address is invalid.".to_string())?;
        let session_id = std::env::var("LATTICETERM_AGENT_SESSION")
            .map_err(|_| "Agent reporter session is unavailable.".to_string())?;
        let token = std::env::var("LATTICETERM_AGENT_REPORT_TOKEN")
            .map_err(|_| "Agent reporter token is unavailable.".to_string())?;
        send_report(address, &session_id, &token, state)
    })();
    match result {
        Ok(()) => Some(0),
        Err(error) => {
            eprintln!("agent state report failed: {error}");
            Some(1)
        }
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
                adapter_version: AGENT_ADAPTER_VERSION,
                resume_supported: agent.resume_recipe.is_some(),
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

fn validate_arguments(arguments: &[String]) -> Result<Vec<String>, String> {
    if arguments.len() > MAX_ARGUMENTS {
        return Err(format!("At most {MAX_ARGUMENTS} arguments are allowed."));
    }
    for argument in arguments {
        if argument.len() > MAX_ARGUMENT_BYTES || argument.chars().any(char::is_control) {
            return Err("An argument is too long or contains control characters.".to_string());
        }
    }
    Ok(arguments.to_vec())
}

fn normalize_resume_session_id(
    spec: Option<&AgentSpec>,
    resume_session_id: Option<&str>,
    arguments: &[String],
) -> Result<Option<String>, String> {
    let Some(resume_session_id) = resume_session_id else {
        return Ok(None);
    };
    let spec = spec
        .ok_or_else(|| "Native session restore is not available for custom agents.".to_string())?;
    if spec.resume_recipe.is_none() {
        return Err(format!(
            "Native session restore is not available for {}.",
            spec.label
        ));
    }
    if !arguments.is_empty() {
        return Err(
            "Native session restore cannot be combined with additional launch arguments."
                .to_string(),
        );
    }
    let resume_session_id = validate_text(
        resume_session_id,
        "Native session ID or title",
        MAX_RESUME_SESSION_ID_BYTES,
    )?;
    if resume_session_id.starts_with('-') {
        return Err("Native session ID or title cannot begin with '-'.".to_string());
    }
    Ok(Some(resume_session_id))
}

fn looks_like_sensitive_argument(argument: &str) -> bool {
    let lower = argument.trim().to_ascii_lowercase();
    let option = lower.split('=').next().unwrap_or_default();
    if matches!(
        option,
        "--password" | "--passphrase" | "--token" | "--api-key" | "--apikey" | "--secret"
    ) {
        return true;
    }

    let Some((name, _)) = lower.split_once('=') else {
        return false;
    };
    let name = name.trim_matches('-');
    matches!(
        name,
        "password" | "passphrase" | "token" | "api_key" | "apikey" | "secret"
    ) || name.ends_with("_password")
        || name.ends_with("_passphrase")
        || name.ends_with("_token")
        || name.ends_with("_api_key")
        || name.ends_with("_secret")
}

pub fn normalize_launch_plan(
    id: String,
    draft: AgentLaunchPlanDraft,
) -> Result<AgentLaunchPlan, String> {
    let id = validate_text(&id, "Launch plan ID", 128)?;
    let definition_id = validate_text(&draft.definition_id, "Agent type", 64)?;
    let spec = AGENTS.iter().find(|agent| agent.id == definition_id);
    let (default_label, executable) = if definition_id == "custom" {
        (
            validate_text(&draft.label, "Agent label", 80)?,
            validate_text(&draft.executable, "Executable", 512)?,
        )
    } else {
        let spec = spec.ok_or_else(|| "Unknown agent type.".to_string())?;
        (spec.label.to_string(), spec.executable.to_string())
    };
    let label = if draft.label.trim().is_empty() {
        default_label
    } else {
        validate_text(&draft.label, "Agent label", 80)?
    };
    let arguments = validate_arguments(&draft.arguments)?;
    let resume_session_id =
        normalize_resume_session_id(spec, draft.resume_session_id.as_deref(), &arguments)?;
    if arguments
        .iter()
        .any(|argument| looks_like_sensitive_argument(argument))
    {
        return Err(
            "Saved launch plans cannot contain password, token, API key, passphrase, or secret arguments."
                .to_string(),
        );
    }
    let working_directory = PathBuf::from(validate_text(
        &draft.working_directory,
        "Working directory",
        4096,
    )?)
    .canonicalize()
    .map_err(|error| format!("Cannot open the working directory: {error}"))?;
    if !working_directory.is_dir() {
        return Err("Working directory is not a directory.".to_string());
    }

    Ok(AgentLaunchPlan {
        id,
        definition_id,
        label,
        executable,
        arguments,
        resume_session_id,
        working_directory: working_directory.display().to_string(),
    })
}

pub fn launch_request_from_plan(
    plan: &AgentLaunchPlan,
    cols: u32,
    rows: u32,
) -> Result<AgentLaunchRequest, String> {
    let validated = normalize_launch_plan(
        plan.id.clone(),
        AgentLaunchPlanDraft {
            definition_id: plan.definition_id.clone(),
            label: plan.label.clone(),
            executable: plan.executable.clone(),
            arguments: plan.arguments.clone(),
            resume_session_id: plan.resume_session_id.clone(),
            working_directory: plan.working_directory.clone(),
        },
    )?;
    Ok(AgentLaunchRequest {
        definition_id: validated.definition_id,
        label: validated.label,
        executable: validated.executable,
        arguments: validated.arguments,
        resume_session_id: validated.resume_session_id,
        working_directory: validated.working_directory,
        cols,
        rows,
    })
}

fn resolve_launch(
    request: &AgentLaunchRequest,
) -> Result<(String, String, PathBuf, Vec<String>, PathBuf), String> {
    let mut arguments = validate_arguments(&request.arguments)?;

    let definition_id = validate_text(&request.definition_id, "Agent type", 64)?;
    let spec = AGENTS.iter().find(|agent| agent.id == definition_id);
    let (default_label, command) = if definition_id == "custom" {
        (
            validate_text(&request.label, "Agent label", 80)?,
            validate_text(&request.executable, "Executable", 512)?,
        )
    } else {
        let spec = spec.ok_or_else(|| "Unknown agent type.".to_string())?;
        (spec.label.to_string(), spec.executable.to_string())
    };
    if let Some(resume_session_id) =
        normalize_resume_session_id(spec, request.resume_session_id.as_deref(), &arguments)?
    {
        arguments = spec
            .and_then(|agent| agent.resume_recipe)
            .expect("validated resume recipe")
            .arguments(resume_session_id);
    }

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
        arguments,
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

/// Drops ANSI escape sequences (CSI, OSC, and single-character escapes) so
/// pattern matching sees the text a human sees.
fn strip_ansi(text: &str) -> String {
    let mut cleaned = String::with_capacity(text.len());
    let mut characters = text.chars().peekable();
    while let Some(character) = characters.next() {
        if character != '\u{1b}' {
            cleaned.push(character);
            continue;
        }
        match characters.peek() {
            // CSI: ESC [ ... final byte in @-~
            Some('[') => {
                characters.next();
                for follower in characters.by_ref() {
                    if ('\u{40}'..='\u{7e}').contains(&follower) {
                        break;
                    }
                }
            }
            // OSC: ESC ] ... BEL or ESC backslash
            Some(']') => {
                characters.next();
                let mut previous = '\0';
                for follower in characters.by_ref() {
                    if follower == '\u{7}' || (previous == '\u{1b}' && follower == '\\') {
                        break;
                    }
                    previous = follower;
                }
            }
            // Two-character escapes such as ESC ( B.
            Some(_) => {
                characters.next();
            }
            None => {}
        }
    }
    cleaned
}

fn is_uuid_shaped(candidate: &[char]) -> bool {
    if candidate.len() != 36 {
        return false;
    }
    candidate.iter().enumerate().all(|(index, character)| {
        if matches!(index, 8 | 13 | 18 | 23) {
            *character == '-'
        } else {
            character.is_ascii_hexdigit()
        }
    })
}

/// Finds a CLI session id announced in output: a UUID with the word
/// "session" shortly before it. The word requirement is what keeps this
/// conservative — agents print plenty of UUIDs that are not session ids.
fn find_native_session_id(text: &str) -> Option<String> {
    let characters: Vec<char> = text.chars().collect();
    let lowered: Vec<char> = characters.iter().map(|c| c.to_ascii_lowercase()).collect();
    let needle: Vec<char> = "session".chars().collect();

    for start in 0..characters.len().saturating_sub(35) {
        let window = &characters[start..start + 36];
        if !is_uuid_shaped(window) {
            continue;
        }
        // A UUID is only trusted as a session id if "session" appears within
        // the preceding few dozen characters.
        let context_start = start.saturating_sub(64);
        let context = &lowered[context_start..start];
        if context
            .windows(needle.len())
            .any(|slice| slice == needle.as_slice())
        {
            return Some(window.iter().collect::<String>().to_ascii_lowercase());
        }
    }
    None
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
    let reporter = registry.reporter.clone();
    let report_token = reporter
        .as_ref()
        .map(|_| random_report_token())
        .transpose()?;

    let pair = native_pty_system()
        .openpty(size)
        .map_err(|error| format!("Cannot create a local terminal: {error}"))?;
    let mut command = CommandBuilder::new(&executable);
    command.args(arguments);
    command.cwd(&working_directory);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env("LATTICETERM_AGENT_SESSION", &session_id);
    if let (Some(endpoint), Some(token)) = (&reporter, &report_token) {
        command.env("LATTICETERM_AGENT_REPORTER", &endpoint.executable);
        command.env(
            "LATTICETERM_AGENT_REPORT_ADDR",
            endpoint.address.to_string(),
        );
        command.env("LATTICETERM_AGENT_REPORT_TOKEN", token);
    }

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

    // Only CLIs whose resume shape is verified get automatic id capture;
    // for the rest a captured id would be a guess nothing can use.
    let capture_enabled = AGENTS
        .iter()
        .any(|agent| agent.id == definition_id && agent.resume_recipe.is_some());

    let summary = AgentSessionSummary {
        session_id: session_id.clone(),
        definition_id,
        label,
        executable: executable.display().to_string(),
        working_directory: working_directory.display().to_string(),
        state: AgentLifecycle::Working,
        state_source: AgentStateSource::Heuristic,
        process_id,
        // A session launched as a native resume already knows its id; a
        // fresh announcement in the output still overwrites it.
        captured_session_id: request.resume_session_id.clone(),
    };
    let entry = Arc::new(AgentSessionEntry {
        summary: Mutex::new(summary.clone()),
        report_token,
        writer: Mutex::new(writer),
        master: Mutex::new(pair.master),
        killer: Mutex::new(killer),
        capture: Mutex::new(CaptureState {
            enabled: capture_enabled,
            buffer: String::new(),
        }),
        output: Mutex::new(OutputBuffer::default()),
    });
    if let Err(error) = registry.insert(&summary, Arc::clone(&entry)) {
        let _ = terminate_agent_entry(entry.as_ref());
        return Err(error);
    }

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
                    let Ok(offset) = reader_registry.record_output(&reader_id, bytes) else {
                        break;
                    };
                    reader_sink.data(&reader_id, offset, bytes);
                    let state = lifecycle_from_output(bytes);
                    if reader_registry.update_state(&reader_id, state, AgentStateSource::Heuristic)
                    {
                        reader_sink.state(&reader_id, state, AgentStateSource::Heuristic);
                    }
                    if let Some(native_id) = reader_registry.scan_for_session_id(&reader_id, bytes)
                    {
                        reader_sink.captured(&reader_id, &native_id);
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
    send_bytes(sink, registry, session_id, &bytes)
}

fn send_bytes(
    sink: &dyn AgentSink,
    registry: &AgentRegistry,
    session_id: &str,
    bytes: &[u8],
) -> Result<(), String> {
    let entry = registry.get(session_id)?;
    let mut writer = entry.writer.lock().map_err(|error| error.to_string())?;
    writer
        .write_all(bytes)
        .and_then(|_| writer.flush())
        .map_err(|error| format!("Cannot write to the agent terminal: {error}"))?;
    if registry.update_state(
        session_id,
        AgentLifecycle::Working,
        AgentStateSource::Heuristic,
    ) {
        sink.state(
            session_id,
            AgentLifecycle::Working,
            AgentStateSource::Heuristic,
        );
    }
    Ok(())
}

pub fn broadcast(
    sink: &dyn AgentSink,
    registry: &AgentRegistry,
    session_ids: &[String],
    encoded: &str,
) -> Result<Vec<AgentBroadcastOutcome>, String> {
    if session_ids.is_empty() {
        return Err("Select at least one agent session.".to_string());
    }
    if session_ids.len() > MAX_BROADCAST_TARGETS {
        return Err(format!(
            "A broadcast may target at most {MAX_BROADCAST_TARGETS} agent sessions."
        ));
    }

    let mut unique = HashSet::with_capacity(session_ids.len());
    for session_id in session_ids {
        if session_id.trim() != session_id
            || validate_text(session_id, "Agent session", 128).is_err()
        {
            return Err("An agent session ID is invalid.".to_string());
        }
        if !unique.insert(session_id.as_str()) {
            return Err("A broadcast cannot contain duplicate agent sessions.".to_string());
        }
    }

    let bytes = decode(encoded)?;
    if bytes.is_empty() {
        return Err("A broadcast prompt is required.".to_string());
    }

    Ok(session_ids
        .iter()
        .map(
            |session_id| match send_bytes(sink, registry, session_id, &bytes) {
                Ok(()) => AgentBroadcastOutcome {
                    session_id: session_id.clone(),
                    delivered: true,
                    error: None,
                },
                Err(error) => AgentBroadcastOutcome {
                    session_id: session_id.clone(),
                    delivered: false,
                    error: Some(error),
                },
            },
        )
        .collect())
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
    terminate_agent_entry(entry.as_ref())?;
    if registry.remove(session_id).is_some() {
        sink.closed(session_id, "Stopped by user");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};
    #[cfg(unix)]
    use std::time::{Duration, Instant};

    #[derive(Default)]
    struct TestSink {
        data: Mutex<Vec<u8>>,
        session_data: Mutex<HashMap<String, Vec<u8>>>,
        states: Mutex<Vec<(String, AgentLifecycle, AgentStateSource)>>,
        closed: Mutex<Vec<String>>,
        captured: Mutex<Vec<(String, String)>>,
    }

    impl AgentSink for TestSink {
        fn data(&self, session_id: &str, _offset: u64, bytes: &[u8]) {
            self.data.lock().unwrap().extend_from_slice(bytes);
            self.session_data
                .lock()
                .unwrap()
                .entry(session_id.to_string())
                .or_default()
                .extend_from_slice(bytes);
        }

        fn state(&self, session_id: &str, state: AgentLifecycle, source: AgentStateSource) {
            self.states
                .lock()
                .unwrap()
                .push((session_id.to_string(), state, source));
        }

        fn closed(&self, _session_id: &str, reason: &str) {
            self.closed.lock().unwrap().push(reason.to_string());
        }

        fn captured(&self, session_id: &str, native_session_id: &str) {
            self.captured
                .lock()
                .unwrap()
                .push((session_id.to_string(), native_session_id.to_string()));
        }
    }

    #[test]
    fn ansi_noise_is_stripped_before_matching() {
        let noisy = "\u{1b}[1;32msession id:\u{1b}[0m \u{1b}]0;title\u{7}0199aa11-bb22-4c33-8d44-ee55ff667788";
        let cleaned = strip_ansi(noisy);
        assert_eq!(cleaned, "session id: 0199aa11-bb22-4c33-8d44-ee55ff667788");
    }

    #[test]
    fn a_uuid_near_the_word_session_is_captured() {
        assert_eq!(
            find_native_session_id("session id: 0199AA11-BB22-4C33-8D44-EE55FF667788").as_deref(),
            Some("0199aa11-bb22-4c33-8d44-ee55ff667788")
        );
        assert_eq!(
            find_native_session_id("Resuming session 0199aa11-bb22-4c33-8d44-ee55ff667788 now")
                .as_deref(),
            Some("0199aa11-bb22-4c33-8d44-ee55ff667788")
        );
    }

    #[test]
    fn an_id_split_across_chunks_is_still_captured_once() {
        let mut capture = CaptureState {
            enabled: true,
            buffer: String::new(),
        };
        assert!(capture
            .feed(
                b"starting up...
session id: 0199aa11-"
            )
            .is_none());
        let found = capture.feed(
            b"bb22-4c33-8d44-ee55ff667788
",
        );
        assert_eq!(
            found.as_deref(),
            Some("0199aa11-bb22-4c33-8d44-ee55ff667788")
        );
        // Once captured, later output is no longer scanned.
        assert!(capture
            .feed(b"session id: 99998888-7777-4666-8555-444433332222")
            .is_none());
    }

    #[test]
    fn a_disabled_capture_never_matches() {
        let mut capture = CaptureState {
            enabled: false,
            buffer: String::new(),
        };
        assert!(capture
            .feed(b"session id: 0199aa11-bb22-4c33-8d44-ee55ff667788")
            .is_none());
    }

    #[test]
    fn a_uuid_without_session_context_is_not_trusted() {
        assert!(
            find_native_session_id("request 0199aa11-bb22-4c33-8d44-ee55ff667788 finished")
                .is_none()
        );
        assert!(find_native_session_id("session id: not-a-uuid").is_none());
        // "session" appearing far away does not vouch for the id.
        let far = format!(
            "session opened{}0199aa11-bb22-4c33-8d44-ee55ff667788",
            " ".repeat(100)
        );
        assert!(find_native_session_id(&far).is_none());
    }

    #[test]
    fn catalog_ids_are_unique() {
        let ids: HashSet<_> = AGENTS.iter().map(|agent| agent.id).collect();
        assert_eq!(ids.len(), AGENTS.len());
        assert!(ids.contains("codex"));
        assert!(ids.contains("hermes"));
    }

    #[test]
    fn native_resume_adapters_use_the_verified_cli_argument_shape() {
        for (definition_id, expected) in [
            ("codex", vec!["resume", "session-42"]),
            ("claude", vec!["--resume", "session-42"]),
            ("gemini", vec!["--resume", "session-42"]),
            ("hermes", vec!["--resume", "session-42"]),
        ] {
            let spec = AGENTS
                .iter()
                .find(|agent| agent.id == definition_id)
                .unwrap();
            let session_id = normalize_resume_session_id(Some(spec), Some("  session-42  "), &[])
                .unwrap()
                .unwrap();
            assert_eq!(spec.resume_recipe.unwrap().arguments(session_id), expected);
        }

        let definitions = catalog();
        let supported: HashSet<_> = definitions
            .iter()
            .filter(|definition| definition.resume_supported)
            .map(|definition| definition.id.as_str())
            .collect();
        assert_eq!(
            supported,
            HashSet::from(["codex", "claude", "gemini", "hermes"])
        );
        assert!(definitions
            .iter()
            .all(|definition| definition.adapter_version == AGENT_ADAPTER_VERSION));
    }

    #[test]
    fn native_resume_rejects_ambiguous_or_unsupported_inputs() {
        let codex = AGENTS.iter().find(|agent| agent.id == "codex").unwrap();
        let opencode = AGENTS.iter().find(|agent| agent.id == "opencode").unwrap();

        assert!(normalize_resume_session_id(None, Some("session-42"), &[])
            .unwrap_err()
            .contains("custom agents"));
        assert!(
            normalize_resume_session_id(Some(opencode), Some("session-42"), &[])
                .unwrap_err()
                .contains("OpenCode")
        );
        assert!(
            normalize_resume_session_id(Some(codex), Some("-latest"), &[])
                .unwrap_err()
                .contains("cannot begin")
        );
        assert!(
            normalize_resume_session_id(Some(codex), Some("bad\ntitle"), &[])
                .unwrap_err()
                .contains("control")
        );
        assert!(normalize_resume_session_id(
            Some(codex),
            Some("session-42"),
            &["--full-auto".to_string()],
        )
        .unwrap_err()
        .contains("cannot be combined"));
        assert!(normalize_resume_session_id(
            Some(codex),
            Some(&"x".repeat(MAX_RESUME_SESSION_ID_BYTES + 1)),
            &[],
        )
        .unwrap_err()
        .contains("too long"));
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
    fn active_agent_limit_keeps_output_memory_bounded() {
        assert!(!agent_session_limit_reached(MAX_AGENT_SESSIONS - 1));
        assert!(agent_session_limit_reached(MAX_AGENT_SESSIONS));
        assert_eq!(
            MAX_AGENT_SESSIONS * MAX_OUTPUT_SNAPSHOT_BYTES,
            8 * 1024 * 1024
        );
    }

    #[test]
    fn output_buffer_retains_a_bounded_tail_with_monotonic_offsets() {
        let mut output = OutputBuffer::default();
        let prefix = vec![b'a'; MAX_OUTPUT_SNAPSHOT_BYTES - 2];
        assert_eq!(output.append(&prefix), 0);
        assert_eq!(
            output.append(b"bcde"),
            (MAX_OUTPUT_SNAPSHOT_BYTES - 2) as u64
        );

        let snapshot = output.snapshot("agent-session-test");
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(&snapshot.base64)
            .unwrap();
        assert_eq!(snapshot.session_id, "agent-session-test");
        assert_eq!(snapshot.start_offset, 2);
        assert_eq!(snapshot.end_offset, (MAX_OUTPUT_SNAPSHOT_BYTES + 2) as u64);
        let wire = serde_json::to_value(&snapshot).unwrap();
        assert_eq!(wire["sessionId"], "agent-session-test");
        assert_eq!(wire["startOffset"], 2);
        assert_eq!(wire["endOffset"], (MAX_OUTPUT_SNAPSHOT_BYTES + 2) as u64);
        assert_eq!(decoded.len(), MAX_OUTPUT_SNAPSHOT_BYTES);
        assert_eq!(&decoded[decoded.len() - 4..], b"bcde");
    }

    #[test]
    fn input_decoder_rejects_oversized_events() {
        let encoded = encode(&vec![0_u8; MAX_INPUT_BYTES + 1]);
        assert!(decode(&encoded).unwrap_err().contains("at most"));
    }

    #[test]
    fn launch_plans_normalize_paths_and_reject_secret_arguments() {
        let directory = std::env::current_dir().unwrap();
        let plan = normalize_launch_plan(
            "agent-plan-safe".to_string(),
            AgentLaunchPlanDraft {
                definition_id: "codex".to_string(),
                label: "Review agent".to_string(),
                executable: String::new(),
                arguments: vec!["--full-auto".to_string()],
                resume_session_id: None,
                working_directory: directory.display().to_string(),
            },
        )
        .unwrap();
        assert_eq!(plan.executable, "codex");
        assert_eq!(
            PathBuf::from(&plan.working_directory),
            directory.canonicalize().unwrap()
        );
        let mut tampered = plan.clone();
        tampered.arguments = vec!["--token=manually-injected".to_string()];
        assert!(launch_request_from_plan(&tampered, 80, 24).is_err());

        for argument in ["--api-key", "--token=secret", "SERVICE_PASSWORD=value"] {
            let error = normalize_launch_plan(
                "agent-plan-secret".to_string(),
                AgentLaunchPlanDraft {
                    definition_id: "custom".to_string(),
                    label: "Unsafe agent".to_string(),
                    executable: "/bin/echo".to_string(),
                    arguments: vec![argument.to_string()],
                    resume_session_id: None,
                    working_directory: directory.display().to_string(),
                },
            )
            .unwrap_err();
            assert!(error.contains("cannot contain"));
        }
    }

    #[test]
    fn launch_plans_preserve_an_explicit_native_resume_id() {
        let directory = std::env::current_dir().unwrap();
        let plan = normalize_launch_plan(
            "agent-plan-resume".to_string(),
            AgentLaunchPlanDraft {
                definition_id: "codex".to_string(),
                label: String::new(),
                executable: String::new(),
                arguments: Vec::new(),
                resume_session_id: Some("  session-42  ".to_string()),
                working_directory: directory.display().to_string(),
            },
        )
        .unwrap();
        assert_eq!(plan.resume_session_id.as_deref(), Some("session-42"));

        let request = launch_request_from_plan(&plan, 80, 24).unwrap();
        assert_eq!(request.resume_session_id.as_deref(), Some("session-42"));
    }

    #[test]
    fn broadcast_rejects_duplicate_targets_before_sending() {
        let sink = TestSink::default();
        let registry = AgentRegistry::new();
        let error = broadcast(
            &sink,
            &registry,
            &["agent-session-1".to_string(), "agent-session-1".to_string()],
            &encode(b"review this\r"),
        )
        .unwrap_err();
        assert!(error.contains("duplicate"));
    }

    #[test]
    fn reporter_subcommand_accepts_only_known_states() {
        assert_eq!(
            lifecycle_from_report_arg("needs-attention"),
            Some(AgentLifecycle::NeedsAttention)
        );
        assert_eq!(
            lifecycle_from_report_arg("done"),
            Some(AgentLifecycle::Done)
        );
        assert_eq!(lifecycle_from_report_arg("arbitrary-command"), None);
        assert_eq!(run_reporter_cli(["different-command", "done"]), None);
    }

    #[test]
    fn semantic_reporter_authenticates_and_overrides_heuristics() {
        let collector = Arc::new(TestSink::default());
        let sink: Arc<dyn AgentSink> = collector.clone();
        let registry = AgentRegistry::with_local_reporter(sink.clone()).unwrap();
        #[cfg(unix)]
        let (executable, arguments) = ("/bin/cat".to_string(), Vec::new());
        #[cfg(windows)]
        let (executable, arguments) = ("cmd.exe".to_string(), vec!["/Q".to_string()]);
        let request = AgentLaunchRequest {
            definition_id: "custom".to_string(),
            label: "Reporter test".to_string(),
            executable,
            arguments,
            resume_session_id: None,
            working_directory: std::env::current_dir().unwrap().display().to_string(),
            cols: 80,
            rows: 24,
        };
        let session = launch(sink.clone(), registry.clone(), request).unwrap();
        let (address, token) = registry
            .reporter_credentials(&session.session_id)
            .expect("reporter credentials");

        assert!(send_report(
            address,
            &session.session_id,
            "wrong-token",
            AgentLifecycle::NeedsAttention,
        )
        .is_err());
        assert_eq!(registry.list()[0].state, AgentLifecycle::Working);

        send_report(address, &session.session_id, &token, AgentLifecycle::Done).unwrap();
        let summary = &registry.list()[0];
        assert_eq!(summary.state, AgentLifecycle::Done);
        assert_eq!(summary.state_source, AgentStateSource::Integration);
        assert!(!registry.update_state(
            &session.session_id,
            AgentLifecycle::NeedsAttention,
            AgentStateSource::Heuristic,
        ));
        assert_eq!(registry.list()[0].state, AgentLifecycle::Done);
        assert!(collector
            .states
            .lock()
            .unwrap()
            .iter()
            .any(|(_, state, source)| *state == AgentLifecycle::Done
                && *source == AgentStateSource::Integration));

        disconnect(sink.as_ref(), &registry, &session.session_id).unwrap();
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
            resume_session_id: None,
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
        let snapshots = registry.output_snapshots();
        let snapshot = snapshots
            .iter()
            .find(|entry| entry.session_id == session.session_id)
            .expect("active session output snapshot");
        let replay = base64::engine::general_purpose::STANDARD
            .decode(&snapshot.base64)
            .unwrap();
        assert!(String::from_utf8_lossy(&replay).contains("lattice-agent-test"));
        assert_eq!(
            snapshot.end_offset - snapshot.start_offset,
            replay.len() as u64
        );
        disconnect(sink.as_ref(), &registry, &session.session_id).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn disconnect_terminates_a_pty_process_group_that_ignores_sighup() {
        let sink: Arc<dyn AgentSink> = Arc::new(TestSink::default());
        let registry = Arc::new(AgentRegistry::new());
        let request = AgentLaunchRequest {
            definition_id: "custom".to_string(),
            label: "Signal-resistant shell".to_string(),
            executable: "/bin/sh".to_string(),
            arguments: vec!["-c".to_string(), "trap '' HUP; sleep 30 & wait".to_string()],
            resume_session_id: None,
            working_directory: std::env::current_dir().unwrap().display().to_string(),
            cols: 80,
            rows: 24,
        };
        let session = launch(sink.clone(), registry.clone(), request).unwrap();
        let process_group = i32::try_from(session.process_id.expect("PTY process ID")).unwrap();

        assert_eq!(unsafe { libc::kill(-process_group, 0) }, 0);
        disconnect(sink.as_ref(), &registry, &session.session_id).unwrap();

        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            let result = unsafe { libc::kill(-process_group, 0) };
            if result == -1 && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH) {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(unsafe { libc::kill(-process_group, 0) }, -1);
        assert_eq!(
            std::io::Error::last_os_error().raw_os_error(),
            Some(libc::ESRCH),
        );
    }

    #[cfg(unix)]
    #[test]
    fn broadcast_fans_out_to_each_selected_pty() {
        let collector = Arc::new(TestSink::default());
        let sink: Arc<dyn AgentSink> = collector.clone();
        let registry = Arc::new(AgentRegistry::new());
        let mut sessions = Vec::new();
        for label in ["Agent one", "Agent two"] {
            sessions.push(
                launch(
                    sink.clone(),
                    registry.clone(),
                    AgentLaunchRequest {
                        definition_id: "custom".to_string(),
                        label: label.to_string(),
                        executable: "/bin/cat".to_string(),
                        arguments: Vec::new(),
                        resume_session_id: None,
                        working_directory: std::env::current_dir().unwrap().display().to_string(),
                        cols: 80,
                        rows: 24,
                    },
                )
                .unwrap(),
            );
        }

        let target_ids: Vec<_> = sessions
            .iter()
            .map(|session| session.session_id.clone())
            .collect();
        let outcomes = broadcast(
            sink.as_ref(),
            &registry,
            &target_ids,
            &encode(b"fleet-broadcast-test\n"),
        )
        .unwrap();
        assert!(outcomes.iter().all(|outcome| outcome.delivered));

        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            let received = collector.session_data.lock().unwrap();
            if target_ids.iter().all(|session_id| {
                received.get(session_id).is_some_and(|bytes| {
                    String::from_utf8_lossy(bytes).contains("fleet-broadcast-test")
                })
            }) {
                break;
            }
            drop(received);
            std::thread::sleep(Duration::from_millis(20));
        }
        let received = collector.session_data.lock().unwrap();
        assert!(target_ids.iter().all(|session_id| {
            received.get(session_id).is_some_and(|bytes| {
                String::from_utf8_lossy(bytes).contains("fleet-broadcast-test")
            })
        }));
        drop(received);

        for session in sessions {
            disconnect(sink.as_ref(), &registry, &session.session_id).unwrap();
        }
    }

    #[cfg(unix)]
    #[test]
    fn stop_all_removes_and_terminates_registered_processes() {
        let sink: Arc<dyn AgentSink> = Arc::new(TestSink::default());
        let registry = Arc::new(AgentRegistry::new());
        let request = AgentLaunchRequest {
            definition_id: "custom".to_string(),
            label: "Test cat".to_string(),
            executable: "/bin/cat".to_string(),
            arguments: Vec::new(),
            resume_session_id: None,
            working_directory: std::env::current_dir().unwrap().display().to_string(),
            cols: 80,
            rows: 24,
        };
        launch(sink, registry.clone(), request).unwrap();
        assert_eq!(registry.list().len(), 1);

        registry.stop_all();

        assert!(registry.list().is_empty());
    }
}
