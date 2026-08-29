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
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub const EVENT_DATA: &str = "agent://data";
pub const EVENT_CLOSED: &str = "agent://closed";
pub const EVENT_STATE: &str = "agent://state";
pub const EVENT_CAPTURE: &str = "agent://capture";
pub const EVENT_MODEL: &str = "agent://model";
pub const EVENT_USAGE: &str = "agent://usage";

const MAX_INPUT_BYTES: usize = 64 * 1024;
const MAX_ARGUMENTS: usize = 64;
const MAX_ARGUMENT_BYTES: usize = 4096;
const MAX_RESUME_SESSION_ID_BYTES: usize = 512;
const MAX_PLAN_NOTE_BYTES: usize = 200;
const MAX_BROADCAST_TARGETS: usize = 32;
pub const MAX_AGENT_SESSIONS: usize = 32;
pub const MAX_SAVED_AGENT_PLANS: usize = 32;
const MAX_OUTPUT_SNAPSHOT_BYTES: usize = 256 * 1024;
const MAX_REPORT_BYTES: u64 = 4096;
const MAX_NOTIFY_FORWARD_ARGUMENTS: usize = 16;
const MAX_NOTIFY_FORWARD_BYTES: usize = 8192;
const MAX_LIFECYCLE_HOOK_BYTES: u64 = 1024 * 1024;
const MAX_REPORTED_TOKENS_PER_REQUEST: u64 = 1_000_000_000_000;
const MAX_REPORTED_USAGE_REQUESTS: usize = 4096;
const MAX_SERIALIZED_USAGE_VALUE: u64 = (1_u64 << 53) - 1;
const REPORT_TIMEOUT: Duration = Duration::from_secs(1);
const REPORT_RETRIES: usize = 5;
const STARTUP_SEED_PROMPT_SETTLE: Duration = Duration::from_millis(120);
const STARTUP_SEED_MIN_WAIT: Duration = Duration::from_millis(1800);
const STARTUP_SEED_OUTPUT_QUIET: Duration = Duration::from_millis(550);
const STARTUP_SEED_TIMEOUT: Duration = Duration::from_secs(20);
const STARTUP_CONTROL_WINDOW_BYTES: usize = 64;

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
enum AgentResumeLatestRecipe {
    Codex,
    Continue,
}

impl AgentResumeLatestRecipe {
    fn arguments(self) -> Vec<String> {
        match self {
            Self::Codex => vec!["resume".to_string(), "--last".to_string()],
            Self::Continue => vec!["--continue".to_string()],
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct AgentSpec {
    id: &'static str,
    label: &'static str,
    executable: &'static str,
    resume_recipe: Option<AgentResumeRecipe>,
    resume_latest_recipe: Option<AgentResumeLatestRecipe>,
}

const AGENTS: [AgentSpec; 13] = [
    AgentSpec {
        id: "codex",
        label: "OpenAI Codex",
        executable: "codex",
        resume_recipe: Some(AgentResumeRecipe::Subcommand),
        resume_latest_recipe: Some(AgentResumeLatestRecipe::Codex),
    },
    AgentSpec {
        id: "claude",
        label: "Claude Code",
        executable: "claude",
        resume_recipe: Some(AgentResumeRecipe::Flag),
        resume_latest_recipe: None,
    },
    AgentSpec {
        id: "gemini",
        label: "Gemini CLI",
        executable: "gemini",
        resume_recipe: Some(AgentResumeRecipe::Flag),
        resume_latest_recipe: None,
    },
    AgentSpec {
        id: "antigravity",
        label: "Google Antigravity CLI",
        executable: "agy",
        resume_recipe: None,
        resume_latest_recipe: Some(AgentResumeLatestRecipe::Continue),
    },
    AgentSpec {
        id: "opencode",
        label: "OpenCode",
        executable: "opencode",
        resume_recipe: None,
        resume_latest_recipe: None,
    },
    AgentSpec {
        id: "copilot",
        label: "GitHub Copilot CLI",
        executable: "copilot",
        resume_recipe: None,
        resume_latest_recipe: None,
    },
    AgentSpec {
        id: "hermes",
        label: "Hermes Agent",
        executable: "hermes",
        resume_recipe: Some(AgentResumeRecipe::Flag),
        resume_latest_recipe: None,
    },
    AgentSpec {
        id: "cursor",
        label: "Cursor Agent",
        executable: "agent",
        resume_recipe: Some(AgentResumeRecipe::Flag),
        resume_latest_recipe: Some(AgentResumeLatestRecipe::Continue),
    },
    AgentSpec {
        id: "aider",
        label: "Aider",
        executable: "aider",
        resume_recipe: None,
        resume_latest_recipe: None,
    },
    AgentSpec {
        id: "qwen",
        label: "Qwen Code",
        executable: "qwen",
        resume_recipe: None,
        resume_latest_recipe: None,
    },
    AgentSpec {
        id: "kimi",
        label: "Kimi Code CLI",
        executable: "kimi",
        resume_recipe: None,
        resume_latest_recipe: None,
    },
    AgentSpec {
        id: "droid",
        label: "Factory Droid",
        executable: "droid",
        resume_recipe: None,
        resume_latest_recipe: None,
    },
    AgentSpec {
        id: "grok",
        label: "Grok CLI",
        executable: "grok",
        resume_recipe: None,
        resume_latest_recipe: None,
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
    /// Whether a saved launch item can resume the latest context without
    /// persisting a native session identifier.
    pub resume_latest_supported: bool,
    /// Whether this CLI's conversation can be read for a handoff to another CLI.
    pub transcript_supported: bool,
    pub installed: bool,
    pub installed_path: Option<String>,
    /// Whether this installation selected Gemini's retired personal Google
    /// OAuth client. Enterprise, API-key and Vertex authentication remain
    /// valid, so the warning must follow the configured auth mode, not merely
    /// the executable name.
    pub consumer_oauth_deprecated: bool,
    /// Non-secret identity metadata read from each CLI's own local account
    /// file. Tokens and credential values never cross the Tauri boundary.
    pub account: AgentAccountInfo,
    /// Fixed, source-reviewed installation command for this platform.
    pub install: AgentInstallDefinition,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentAccountState {
    SignedIn,
    SignedOut,
    Unknown,
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAccountInfo {
    pub state: AgentAccountState,
    pub label: Option<String>,
    pub method: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstallDefinition {
    /// `None` means this platform needs the linked manual installation path.
    pub executable: Option<String>,
    pub arguments: Vec<String>,
    pub display_command: String,
    pub source_url: String,
    pub available: bool,
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

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub reasoning_tokens: u64,
    pub total_tokens: u64,
    pub api_calls: u64,
}

impl AgentTokenUsage {
    fn add_report(&mut self, report: &AgentUsageReport) {
        let add = |current: u64, increment: u64| {
            current
                .saturating_add(increment)
                .min(MAX_SERIALIZED_USAGE_VALUE)
        };
        self.input_tokens = add(self.input_tokens, report.input_tokens);
        self.output_tokens = add(self.output_tokens, report.output_tokens);
        self.cache_read_tokens = add(self.cache_read_tokens, report.cache_read_tokens);
        self.cache_write_tokens = add(self.cache_write_tokens, report.cache_write_tokens);
        self.reasoning_tokens = add(self.reasoning_tokens, report.reasoning_tokens);
        self.total_tokens = add(self.total_tokens, report.total_tokens());
        self.api_calls = add(self.api_calls, 1);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionSummary {
    pub session_id: String,
    /// Groups CLIs that share one tab; defaults to the session's own id.
    pub group_id: String,
    /// User-facing tab name shared by every CLI in the same group.
    pub group_label: String,
    pub definition_id: String,
    /// CLI name. This stays independent from the user-facing tab name.
    pub label: String,
    /// Model announced by the CLI or explicitly supplied through `--model`.
    pub model: Option<String>,
    pub executable: String,
    /// Original requested arguments, retained for a safe relaunch elsewhere.
    pub launch_arguments: Vec<String>,
    pub working_directory: String,
    pub state: AgentLifecycle,
    pub state_source: AgentStateSource,
    pub process_id: Option<u32>,
    /// Token buckets reported by an authenticated semantic adapter. `None`
    /// means this CLI has not supplied trustworthy usage data.
    pub token_usage: Option<AgentTokenUsage>,
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
    /// The tab this CLI joins. Absent means it starts its own group (a new tab);
    /// present means it docks into an existing tab's CLI switcher.
    #[serde(default)]
    pub group_id: Option<String>,
    /// A handoff brief pasted into the CLI once it is interactive, so a new CLI
    /// can pick up the previous one's conversation. Absent means a clean start.
    #[serde(default)]
    pub seed_input: Option<String>,
    /// Automatic workspace restoration resumes existing work. It must not
    /// prepend instructions intended only for a newly started CLI task.
    #[serde(default)]
    pub restore_existing_session: bool,
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
    /// Free-text memo, e.g. which project this CLI works on. Never launched.
    #[serde(default)]
    pub note: String,
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
    /// Free-text memo shown in the saved list so a plan's purpose is obvious.
    #[serde(default)]
    pub note: String,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentModelChanged {
    session_id: String,
    model: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentUsageChanged {
    session_id: String,
    token_usage: AgentTokenUsage,
}

pub trait AgentSink: Send + Sync + 'static {
    fn data(&self, session_id: &str, offset: u64, bytes: &[u8]);
    fn state(&self, session_id: &str, state: AgentLifecycle, source: AgentStateSource);
    fn closed(&self, session_id: &str, reason: &str);
    fn captured(&self, session_id: &str, native_session_id: &str);
    fn model(&self, session_id: &str, model: &str);
    fn usage(&self, session_id: &str, token_usage: &AgentTokenUsage);
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

    fn model(&self, session_id: &str, model: &str) {
        let _ = self.0.emit(
            EVENT_MODEL,
            AgentModelChanged {
                session_id: session_id.to_string(),
                model: model.to_string(),
            },
        );
    }

    fn usage(&self, session_id: &str, token_usage: &AgentTokenUsage) {
        let _ = self.0.emit(
            EVENT_USAGE,
            AgentUsageChanged {
                session_id: session_id.to_string(),
                token_usage: token_usage.clone(),
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
    model_capture: Mutex<ModelCaptureState>,
    output: Mutex<OutputBuffer>,
    startup_gate: StartupGate,
    completion_gate: Mutex<CompletionReadiness>,
    /// An official CLI lifecycle hook will report completion for this session,
    /// so prompt-rendering control codes must never guess that it is done.
    integrated_completion: AtomicBool,
    /// Copilot can leave background subagents running after its main agent
    /// emits Stop. Track them independently so Stop is not mistaken for the
    /// end of all work in the PTY.
    copilot_activity: Option<Mutex<CopilotActivity>>,
    /// Hermes emits lifecycle events for both the main conversation and each
    /// delegated child. Keep their identities separate so a child finishing
    /// can never mark the main turn done.
    hermes_activity: Option<Mutex<HermesActivity>>,
    /// Reporter retries must be idempotent: if the local acknowledgement is
    /// lost, the same successful API request can be delivered more than once.
    reported_usage_requests: Mutex<ReportedUsageRequests>,
    /// Keeps per-session integration files alive only as long as their PTY.
    _integration_settings: Option<AgentIntegrationSettings>,
}

enum AgentIntegrationSettings {
    Copilot(CopilotReporterPlugin),
    Gemini(tempfile::NamedTempFile),
    Hermes(HermesReporterPlugin),
    Qwen(tempfile::NamedTempFile),
    OpenCode(OpenCodeReporterPlugin),
}

struct CopilotReporterPlugin {
    directory: tempfile::TempDir,
}

impl CopilotReporterPlugin {
    fn path(&self) -> &Path {
        self.directory.path()
    }
}

struct HermesReporterPlugin {
    directory: tempfile::TempDir,
}

impl HermesReporterPlugin {
    fn path(&self) -> &Path {
        self.directory.path()
    }
}

struct OpenCodeReporterPlugin {
    _file: tempfile::NamedTempFile,
    config_content: String,
}

#[derive(Debug, Default)]
struct StartupReadiness {
    saw_output: bool,
    prompt_ready: bool,
    last_output_at: Option<Instant>,
    control_window: Vec<u8>,
}

impl StartupReadiness {
    fn observe(&mut self, bytes: &[u8], now: Instant) {
        self.saw_output = true;
        self.last_output_at = Some(now);
        self.control_window.extend_from_slice(bytes);
        if self
            .control_window
            .windows(b"\x1b[?2004h".len())
            .any(|window| window == b"\x1b[?2004h")
        {
            self.prompt_ready = true;
        }
        if self.control_window.len() > STARTUP_CONTROL_WINDOW_BYTES {
            let overflow = self.control_window.len() - STARTUP_CONTROL_WINDOW_BYTES;
            self.control_window.drain(..overflow);
        }
    }

    fn should_deliver(&self, started_at: Instant, now: Instant) -> bool {
        let elapsed = now.saturating_duration_since(started_at);
        if elapsed >= STARTUP_SEED_TIMEOUT {
            return true;
        }
        let Some(last_output_at) = self.last_output_at else {
            return false;
        };
        let quiet_for = now.saturating_duration_since(last_output_at);
        if self.prompt_ready {
            quiet_for >= STARTUP_SEED_PROMPT_SETTLE
        } else {
            self.saw_output
                && elapsed >= STARTUP_SEED_MIN_WAIT
                && quiet_for >= STARTUP_SEED_OUTPUT_QUIET
        }
    }

    fn wait_duration(&self, started_at: Instant, now: Instant) -> Duration {
        let until_timeout =
            STARTUP_SEED_TIMEOUT.saturating_sub(now.saturating_duration_since(started_at));
        if let Some(last_output_at) = self.last_output_at {
            let quiet_target = if self.prompt_ready {
                STARTUP_SEED_PROMPT_SETTLE
            } else {
                STARTUP_SEED_OUTPUT_QUIET
            };
            let until_quiet =
                quiet_target.saturating_sub(now.saturating_duration_since(last_output_at));
            let until_min_wait = if self.prompt_ready {
                Duration::ZERO
            } else {
                STARTUP_SEED_MIN_WAIT.saturating_sub(now.saturating_duration_since(started_at))
            };
            return until_timeout
                .min(until_quiet.max(until_min_wait))
                .max(Duration::from_millis(1));
        }
        until_timeout
            .min(Duration::from_millis(250))
            .max(Duration::from_millis(1))
    }
}

#[derive(Debug, Default)]
struct CompletionReadiness {
    submitted: bool,
    control_window: Vec<u8>,
}

impl CompletionReadiness {
    fn observe_input(&mut self, bytes: &[u8]) {
        if bytes.iter().any(|byte| matches!(byte, b'\r' | b'\n')) {
            self.submitted = true;
            self.control_window.clear();
        }
    }

    fn observe_output(
        &mut self,
        bytes: &[u8],
        integrated_completion: bool,
    ) -> Option<AgentLifecycle> {
        self.control_window.extend_from_slice(bytes);

        // PTY reads may split a human-input prompt anywhere, including in the
        // middle of "permission required". Inspect the bounded tail instead
        // of only the newest read, and let an attention prompt win when the
        // same redraw also re-enables bracketed paste.
        if lifecycle_from_output(&self.control_window) == AgentLifecycle::NeedsAttention {
            self.cancel();
            return Some(AgentLifecycle::NeedsAttention);
        }

        // Bracketed-paste mode is enabled when an interactive prompt is ready
        // for the next command. Cursor visibility (`CSI ? 25 h`) is not a
        // completion signal: spinners and full-screen CLIs toggle it while a
        // response is still being generated.
        let prompt_ready = self.submitted
            && !integrated_completion
            && self
                .control_window
                .windows(b"\x1b[?2004h".len())
                .any(|window| window == b"\x1b[?2004h");
        if prompt_ready {
            self.submitted = false;
            self.control_window.clear();
            return Some(AgentLifecycle::Done);
        }
        if self.control_window.len() > STARTUP_CONTROL_WINDOW_BYTES {
            let overflow = self.control_window.len() - STARTUP_CONTROL_WINDOW_BYTES;
            self.control_window.drain(..overflow);
        }
        None
    }

    fn cancel(&mut self) {
        self.submitted = false;
        self.control_window.clear();
    }
}

fn heuristic_state_from_output(
    completion: &mut CompletionReadiness,
    bytes: &[u8],
    integrated_completion: bool,
) -> Option<AgentLifecycle> {
    completion.observe_output(bytes, integrated_completion)
}

#[derive(Debug, Default)]
struct StartupGate {
    readiness: Mutex<StartupReadiness>,
    changed: Condvar,
}

impl StartupGate {
    fn observe(&self, bytes: &[u8]) {
        if let Ok(mut readiness) = self.readiness.lock() {
            readiness.observe(bytes, Instant::now());
            self.changed.notify_all();
        }
    }

    fn wait_until_ready(&self, started_at: Instant) {
        let Ok(mut readiness) = self.readiness.lock() else {
            return;
        };
        loop {
            let now = Instant::now();
            if readiness.should_deliver(started_at, now) {
                return;
            }
            let duration = readiness.wait_duration(started_at, now);
            let Ok((next, _)) = self.changed.wait_timeout(readiness, duration) else {
                return;
            };
            readiness = next;
        }
    }
}

fn startup_seed_payload(seed: &str) -> Vec<u8> {
    format!("\u{1b}[200~{seed}\u{1b}[201~\r").into_bytes()
}

#[derive(Default)]
struct OutputBuffer {
    bytes: VecDeque<u8>,
    start_offset: u64,
    end_offset: u64,
}

impl OutputBuffer {
    fn from_tail(bytes: &[u8]) -> Self {
        let start = bytes.len().saturating_sub(MAX_OUTPUT_SNAPSHOT_BYTES);
        let tail = &bytes[start..];
        Self {
            bytes: tail.iter().copied().collect(),
            start_offset: 0,
            end_offset: tail.len() as u64,
        }
    }

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

    fn tail(&self) -> Vec<u8> {
        self.bytes.iter().copied().collect()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentTerminalHistorySnapshot {
    pub group_id: String,
    pub definition_id: String,
    pub output: Vec<u8>,
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

/// Reads only the CLI's startup output (and explicit `/model` responses) so a
/// model name printed later by generated content is never mistaken for state.
struct ModelCaptureState {
    definition_id: String,
    enabled: bool,
    buffer: String,
    scanned_chars: usize,
    input_buffer: String,
    model_command_active: bool,
}

const MODEL_CAPTURE_WINDOW_CHARS: usize = 4096;
const MODEL_CAPTURE_LIMIT_CHARS: usize = 32 * 1024;

impl ModelCaptureState {
    fn feed(&mut self, bytes: &[u8]) -> Option<String> {
        if !self.enabled {
            return None;
        }
        let stripped = strip_ansi(&String::from_utf8_lossy(bytes));
        self.scanned_chars = self.scanned_chars.saturating_add(stripped.chars().count());
        self.buffer.push_str(&stripped);
        let length = self.buffer.chars().count();
        if length > MODEL_CAPTURE_WINDOW_CHARS {
            self.buffer = self
                .buffer
                .chars()
                .skip(length - MODEL_CAPTURE_WINDOW_CHARS)
                .collect();
        }
        if let Some(model) = find_model_name(&self.definition_id, &self.buffer) {
            if self.model_command_active {
                // A /model picker lists several names before the choice
                // lands, so the first sighting is usually the menu itself.
                // Stay armed and let the last sighting win; the watch ends
                // when the next ordinary command line is submitted.
                self.scanned_chars = 0;
                self.buffer.clear();
                return Some(model);
            }
            self.enabled = false;
            self.buffer.clear();
            return Some(model);
        }
        if self.scanned_chars >= MODEL_CAPTURE_LIMIT_CHARS {
            self.enabled = false;
            self.buffer.clear();
        }
        None
    }

    fn input(&mut self, bytes: &[u8]) {
        let input = strip_ansi(&String::from_utf8_lossy(bytes));
        // xterm sends terminal-generated replies (device attributes, cursor
        // position, focus, colour queries, and similar CSI/OSC sequences)
        // through the same onData channel as keyboard input. Those replies are
        // stripped to an empty string and must not end startup model capture.
        if input.is_empty() {
            return;
        }
        if !self.model_command_active {
            self.enabled = false;
            self.buffer.clear();
        }
        for character in input.chars() {
            match character {
                '\r' | '\n' => {
                    let submitted = self.input_buffer.trim();
                    if submitted.starts_with("/model") {
                        self.enabled = true;
                        self.model_command_active = true;
                        self.buffer.clear();
                        self.scanned_chars = 0;
                    } else if self.model_command_active && !submitted.is_empty() {
                        // Picking with arrows submits an empty line and keeps
                        // the watch; the next real command ends it so later
                        // generated content is never read as a model change.
                        self.model_command_active = false;
                        self.enabled = false;
                        self.buffer.clear();
                    }
                    self.input_buffer.clear();
                }
                '\u{8}' | '\u{7f}' => {
                    self.input_buffer.pop();
                }
                value if !value.is_control() && self.input_buffer.len() < 256 => {
                    self.input_buffer.push(value);
                }
                _ => {}
            }
        }
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    state: Option<AgentLifecycle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    copilot_event: Option<CopilotReporterEvent>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    hermes_event: Option<HermesReporterEvent>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    usage: Option<AgentUsageReport>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentUsageReport {
    source_session_id: String,
    request_id: String,
    input_tokens: u64,
    output_tokens: u64,
    cache_read_tokens: u64,
    cache_write_tokens: u64,
    reasoning_tokens: u64,
}

impl AgentUsageReport {
    fn total_tokens(&self) -> u64 {
        self.input_tokens
            .saturating_add(self.output_tokens)
            .saturating_add(self.cache_read_tokens)
            .saturating_add(self.cache_write_tokens)
    }

    fn validate(&self) -> Result<(), String> {
        for (label, value) in [
            ("input", self.input_tokens),
            ("output", self.output_tokens),
            ("cache read", self.cache_read_tokens),
            ("cache write", self.cache_write_tokens),
            ("reasoning", self.reasoning_tokens),
        ] {
            if value > MAX_REPORTED_TOKENS_PER_REQUEST {
                return Err(format!("Reported {label} token usage is too large."));
            }
        }
        for (label, value) in [
            ("source session", self.source_session_id.as_str()),
            ("request", self.request_id.as_str()),
        ] {
            if value.is_empty()
                || value.len() > MAX_RESUME_SESSION_ID_BYTES
                || value.chars().any(char::is_control)
            {
                return Err(format!("Reported usage {label} id is invalid."));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Default)]
struct ReportedUsageRequests {
    order: VecDeque<(String, String)>,
    ids: HashSet<(String, String)>,
}

impl ReportedUsageRequests {
    fn remember(&mut self, report: &AgentUsageReport) -> bool {
        let key = (report.source_session_id.clone(), report.request_id.clone());
        if !self.ids.insert(key.clone()) {
            return false;
        }
        self.order.push_back(key);
        if self.order.len() > MAX_REPORTED_USAGE_REQUESTS {
            if let Some(expired) = self.order.pop_front() {
                self.ids.remove(&expired);
            }
        }
        true
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CopilotReporterEvent {
    source_session_id: String,
    #[serde(flatten)]
    action: CopilotReporterAction,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum CopilotReporterAction {
    SessionStarted,
    TurnStarted,
    Working,
    Stop,
    NeedsAttention,
    RecoverableError,
    FatalError,
    BackgroundSubagentQueued,
    SubagentStart {
        #[serde(rename = "agentName")]
        agent_name: String,
    },
    SubagentStop {
        #[serde(rename = "agentName")]
        agent_name: String,
    },
    BackgroundCompleted,
    BackgroundIdle,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HermesReporterEvent {
    source_session_id: String,
    #[serde(flatten)]
    action: HermesReporterAction,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum HermesReporterAction {
    SessionStarted,
    TurnStarted,
    TurnEnded {
        completed: bool,
        failed: bool,
        interrupted: bool,
    },
    SubagentStarted {
        #[serde(rename = "childSessionId")]
        child_session_id: String,
    },
    SubagentStopped {
        #[serde(rename = "childSessionId")]
        child_session_id: String,
    },
    NeedsAttention,
    ApprovalResolved,
}

#[derive(Debug, Default)]
struct CopilotActivity {
    primary_session_id: Option<String>,
    main_stopped: bool,
    fatal_error: bool,
    pending_background_subagents: usize,
    active_subagents: HashMap<String, usize>,
}

impl CopilotActivity {
    fn begin_turn(&mut self) {
        self.main_stopped = false;
        self.fatal_error = false;
    }

    fn has_background_work(&self) -> bool {
        self.pending_background_subagents > 0 || !self.active_subagents.is_empty()
    }

    fn is_primary(&self, source_session_id: &str) -> bool {
        self.primary_session_id.as_deref() == Some(source_session_id)
    }

    fn apply(&mut self, event: &CopilotReporterEvent) -> Option<AgentLifecycle> {
        match &event.action {
            CopilotReporterAction::SessionStarted => {
                self.primary_session_id
                    .get_or_insert_with(|| event.source_session_id.clone());
                None
            }
            CopilotReporterAction::TurnStarted => {
                self.primary_session_id
                    .get_or_insert_with(|| event.source_session_id.clone());
                if self.is_primary(&event.source_session_id) {
                    self.begin_turn();
                }
                Some(AgentLifecycle::Working)
            }
            CopilotReporterAction::Working | CopilotReporterAction::RecoverableError => {
                Some(AgentLifecycle::Working)
            }
            CopilotReporterAction::Stop if !self.is_primary(&event.source_session_id) => None,
            CopilotReporterAction::Stop => {
                self.main_stopped = true;
                Some(if self.fatal_error {
                    AgentLifecycle::NeedsAttention
                } else if !self.has_background_work() {
                    AgentLifecycle::Done
                } else {
                    AgentLifecycle::Working
                })
            }
            CopilotReporterAction::NeedsAttention => Some(AgentLifecycle::NeedsAttention),
            CopilotReporterAction::FatalError => {
                if self.is_primary(&event.source_session_id) {
                    self.fatal_error = true;
                }
                Some(AgentLifecycle::NeedsAttention)
            }
            CopilotReporterAction::BackgroundSubagentQueued => {
                self.pending_background_subagents =
                    self.pending_background_subagents.saturating_add(1);
                Some(AgentLifecycle::Working)
            }
            CopilotReporterAction::SubagentStart { agent_name } => {
                self.pending_background_subagents =
                    self.pending_background_subagents.saturating_sub(1);
                *self.active_subagents.entry(agent_name.clone()).or_default() += 1;
                Some(AgentLifecycle::Working)
            }
            CopilotReporterAction::SubagentStop { agent_name } => {
                if let Some(count) = self.active_subagents.get_mut(agent_name) {
                    *count = count.saturating_sub(1);
                    if *count == 0 {
                        self.active_subagents.remove(agent_name);
                    }
                }
                Some(if self.main_stopped && self.fatal_error {
                    AgentLifecycle::NeedsAttention
                } else if self.main_stopped && !self.has_background_work() {
                    AgentLifecycle::Done
                } else {
                    AgentLifecycle::Working
                })
            }
            CopilotReporterAction::BackgroundCompleted | CopilotReporterAction::BackgroundIdle => {
                // Older Copilot versions may notify completion without a
                // matching subagentStart/subagentStop pair. Consume only the
                // pending launch so current versions cannot double-decrement
                // their independently tracked active subagents.
                self.pending_background_subagents =
                    self.pending_background_subagents.saturating_sub(1);
                if !self.main_stopped {
                    None
                } else if self.fatal_error {
                    Some(AgentLifecycle::NeedsAttention)
                } else if self.has_background_work() {
                    Some(AgentLifecycle::Working)
                } else if matches!(&event.action, CopilotReporterAction::BackgroundIdle) {
                    Some(AgentLifecycle::Idle)
                } else {
                    Some(AgentLifecycle::Done)
                }
            }
        }
    }
}

#[derive(Debug, Default)]
struct HermesActivity {
    primary_session_id: Option<String>,
    active_subagents: HashSet<String>,
    main_outcome: Option<AgentLifecycle>,
}

impl HermesActivity {
    fn is_primary(&self, source_session_id: &str) -> bool {
        self.primary_session_id.as_deref() == Some(source_session_id)
    }

    fn is_child(&self, source_session_id: &str) -> bool {
        self.active_subagents.contains(source_session_id)
    }

    fn begin_turn(&mut self) {
        self.main_outcome = None;
    }

    fn current_or_working(&self) -> AgentLifecycle {
        if self.active_subagents.is_empty() {
            self.main_outcome.unwrap_or(AgentLifecycle::Working)
        } else {
            AgentLifecycle::Working
        }
    }

    fn apply(&mut self, event: &HermesReporterEvent) -> Option<AgentLifecycle> {
        match &event.action {
            HermesReporterAction::SessionStarted | HermesReporterAction::TurnStarted => {
                if self.is_child(&event.source_session_id) {
                    return None;
                }
                self.primary_session_id
                    .get_or_insert_with(|| event.source_session_id.clone());
                if !self.is_primary(&event.source_session_id) {
                    return None;
                }
                self.begin_turn();
                Some(AgentLifecycle::Working)
            }
            HermesReporterAction::TurnEnded {
                completed,
                failed,
                interrupted,
            } => {
                if !self.is_primary(&event.source_session_id) {
                    return None;
                }
                let outcome = if *failed {
                    AgentLifecycle::NeedsAttention
                } else if *interrupted {
                    AgentLifecycle::Idle
                } else if *completed {
                    AgentLifecycle::Done
                } else {
                    AgentLifecycle::NeedsAttention
                };
                self.main_outcome = Some(outcome);
                Some(self.current_or_working())
            }
            HermesReporterAction::SubagentStarted { child_session_id } => {
                self.primary_session_id
                    .get_or_insert_with(|| event.source_session_id.clone());
                self.active_subagents.insert(child_session_id.clone());
                Some(AgentLifecycle::Working)
            }
            HermesReporterAction::SubagentStopped { child_session_id } => {
                self.active_subagents.remove(child_session_id);
                Some(self.current_or_working())
            }
            HermesReporterAction::NeedsAttention => Some(AgentLifecycle::NeedsAttention),
            HermesReporterAction::ApprovalResolved => Some(self.current_or_working()),
        }
    }
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
        let executable = std::env::current_exe()
            .map_err(|error| format!("Cannot locate the LatticeTerm executable: {error}"))?;
        Self::with_local_reporter_executable(sink, executable)
    }

    fn with_local_reporter_executable(
        sink: Arc<dyn AgentSink>,
        executable: PathBuf,
    ) -> Result<Arc<Self>, String> {
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .map_err(|error| format!("Cannot start the local agent reporter: {error}"))?;
        let address = listener
            .local_addr()
            .map_err(|error| format!("Cannot read the local reporter address: {error}"))?;
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

    /// User input starts a new lifecycle turn, even when the previous turn was
    /// completed by an authoritative integration event.
    fn mark_working_from_input(&self, session_id: &str) -> bool {
        let Ok(entry) = self.get(session_id) else {
            return false;
        };
        if let Some(activity) = &entry.copilot_activity {
            if let Ok(mut activity) = activity.lock() {
                activity.begin_turn();
            }
        }
        if let Some(activity) = &entry.hermes_activity {
            if let Ok(mut activity) = activity.lock() {
                activity.begin_turn();
            }
        }
        let Ok(mut summary) = entry.summary.lock() else {
            return false;
        };
        if summary.state == AgentLifecycle::Working
            && summary.state_source == AgentStateSource::Heuristic
        {
            return false;
        }
        summary.state = AgentLifecycle::Working;
        summary.state_source = AgentStateSource::Heuristic;
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

    fn scan_for_model(&self, session_id: &str, bytes: &[u8]) -> Option<String> {
        let entry = self.get(session_id).ok()?;
        let found = entry.model_capture.lock().ok()?.feed(bytes)?;

        let mut summary = entry.summary.lock().ok()?;
        if summary.model.as_deref() == Some(found.as_str()) {
            return None;
        }
        summary.model = Some(found.clone());
        Some(found)
    }

    fn mark_model_input(&self, session_id: &str, bytes: &[u8]) {
        let Ok(entry) = self.get(session_id) else {
            return;
        };
        if let Ok(mut capture) = entry.model_capture.lock() {
            capture.input(bytes);
        };
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
        // A real authenticated report proves the child integration is active.
        // From this point onward prompt-control rendering must not guess that
        // the turn completed, even for integrations whose config can be
        // disabled by a higher-precedence user mode.
        entry.integrated_completion.store(true, Ordering::Release);
        Ok(self.update_state(session_id, next, AgentStateSource::Integration))
    }

    fn update_reported_usage(
        &self,
        session_id: &str,
        token: &str,
        report: &AgentUsageReport,
    ) -> Result<Option<AgentTokenUsage>, String> {
        let entry = self.get(session_id)?;
        if entry.report_token.as_deref() != Some(token) {
            return Err("Reporter authentication failed.".to_string());
        }
        report.validate()?;
        let is_new = entry
            .reported_usage_requests
            .lock()
            .map_err(|error| error.to_string())?
            .remember(report);
        if !is_new {
            return Ok(None);
        }
        let mut summary = entry.summary.lock().map_err(|error| error.to_string())?;
        let usage = summary
            .token_usage
            .get_or_insert_with(AgentTokenUsage::default);
        usage.add_report(report);
        Ok(Some(usage.clone()))
    }

    fn update_copilot_event(
        &self,
        session_id: &str,
        token: &str,
        event: &CopilotReporterEvent,
    ) -> Result<Option<(bool, AgentLifecycle)>, String> {
        let entry = self.get(session_id)?;
        if entry.report_token.as_deref() != Some(token) {
            return Err("Reporter authentication failed.".to_string());
        }
        let activity = entry
            .copilot_activity
            .as_ref()
            .ok_or_else(|| "Copilot lifecycle tracking is unavailable.".to_string())?;
        let next = activity
            .lock()
            .map_err(|error| error.to_string())?
            .apply(event);
        entry.integrated_completion.store(true, Ordering::Release);
        Ok(next.map(|next| {
            (
                self.update_state(session_id, next, AgentStateSource::Integration),
                next,
            )
        }))
    }

    fn update_hermes_event(
        &self,
        session_id: &str,
        token: &str,
        event: &HermesReporterEvent,
    ) -> Result<Option<(bool, AgentLifecycle)>, String> {
        let entry = self.get(session_id)?;
        if entry.report_token.as_deref() != Some(token) {
            return Err("Reporter authentication failed.".to_string());
        }
        let activity = entry
            .hermes_activity
            .as_ref()
            .ok_or_else(|| "Hermes lifecycle tracking is unavailable.".to_string())?;
        let next = activity
            .lock()
            .map_err(|error| error.to_string())?
            .apply(event);
        entry.integrated_completion.store(true, Ordering::Release);
        Ok(next.map(|next| {
            (
                self.update_state(session_id, next, AgentStateSource::Integration),
                next,
            )
        }))
    }

    #[cfg(test)]
    fn reporter_credentials(&self, session_id: &str) -> Option<(SocketAddr, String)> {
        let endpoint = self.reporter.as_ref()?;
        let entry = self.get(session_id).ok()?;
        Some((endpoint.address, entry.report_token.clone()?))
    }

    pub fn session_summary(&self, session_id: &str) -> Option<AgentSessionSummary> {
        let sessions = self.sessions.lock().ok()?;
        let entry = sessions.get(session_id)?;
        entry.summary.lock().ok().map(|summary| summary.clone())
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

    /// Renames a CLI group's tab without changing any CLI's own name. The new
    /// label flows into the next hydration snapshot so it survives a reload.
    pub fn rename(&self, session_id: &str, label: &str) -> Result<AgentSessionSummary, String> {
        let label = validate_text(label, "Session name", 80)?;
        let entry = self.get(session_id)?;
        let group_id = entry
            .summary
            .lock()
            .map_err(|error| error.to_string())?
            .group_id
            .clone();
        let sessions = self.sessions.lock().map_err(|error| error.to_string())?;
        for candidate in sessions.values() {
            let mut summary = candidate
                .summary
                .lock()
                .map_err(|error| error.to_string())?;
            if summary.group_id == group_id {
                summary.group_label = label.clone();
            }
        }
        entry
            .summary
            .lock()
            .map_err(|error| error.to_string())
            .map(|summary| summary.clone())
    }

    fn group_label(&self, group_id: &str) -> Option<String> {
        let sessions = self.sessions.lock().ok()?;
        sessions.values().find_map(|entry| {
            let summary = entry.summary.lock().ok()?;
            (summary.group_id == group_id).then(|| summary.group_label.clone())
        })
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

    pub fn terminal_history_snapshots(&self) -> Vec<AgentTerminalHistorySnapshot> {
        let Ok(sessions) = self.sessions.lock() else {
            return Vec::new();
        };
        let mut snapshots = sessions
            .values()
            .filter_map(|entry| {
                let summary = entry.summary.lock().ok()?;
                let output = entry.output.lock().ok()?.tail();
                (!output.is_empty()).then(|| AgentTerminalHistorySnapshot {
                    group_id: summary.group_id.clone(),
                    definition_id: summary.definition_id.clone(),
                    output,
                })
            })
            .collect::<Vec<_>>();
        snapshots.sort_by(|left, right| {
            left.group_id
                .cmp(&right.group_id)
                .then_with(|| left.definition_id.cmp(&right.definition_id))
        });
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

    let result = entry
        .killer
        .lock()
        .map_err(|error| error.to_string())?
        .kill();
    #[cfg(windows)]
    if result
        .as_ref()
        .is_err_and(|error| error.raw_os_error() == Some(0))
    {
        // ConPTY can report a false failure after TerminateProcess succeeded:
        // GetLastError is ERROR_SUCCESS, so there is no actionable failure.
        return Ok(());
    }
    result.map_err(|error| format!("Cannot stop the agent process: {error}"))
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
    let update = match (
        message.state,
        message.copilot_event.as_ref(),
        message.hermes_event.as_ref(),
        message.usage.as_ref(),
    ) {
        (Some(state), None, None, None) => registry
            .update_reported_state(&message.session_id, &message.token, state)
            .map(|changed| Some(ReporterUpdate::State { changed, state })),
        (None, Some(event), None, None) => registry
            .update_copilot_event(&message.session_id, &message.token, event)
            .map(|update| update.map(|(changed, state)| ReporterUpdate::State { changed, state })),
        (None, None, Some(event), None) => registry
            .update_hermes_event(&message.session_id, &message.token, event)
            .map(|update| update.map(|(changed, state)| ReporterUpdate::State { changed, state })),
        (None, None, None, Some(usage)) => registry
            .update_reported_usage(&message.session_id, &message.token, usage)
            .map(|usage| usage.map(ReporterUpdate::Usage)),
        _ => Err("Reporter message must contain exactly one update.".to_string()),
    };
    let accepted = match update {
        Ok(Some(ReporterUpdate::State { changed, state })) => {
            if changed {
                sink.state(&message.session_id, state, AgentStateSource::Integration);
            }
            true
        }
        Ok(Some(ReporterUpdate::Usage(usage))) => {
            sink.usage(&message.session_id, &usage);
            true
        }
        Ok(None) => true,
        Err(_) => false,
    };
    write_report_response(&mut stream, accepted);
}

enum ReporterUpdate {
    State {
        changed: bool,
        state: AgentLifecycle,
    },
    Usage(AgentTokenUsage),
}

fn send_report_once(
    address: SocketAddr,
    session_id: &str,
    token: &str,
    state: Option<AgentLifecycle>,
    copilot_event: Option<&CopilotReporterEvent>,
    hermes_event: Option<&HermesReporterEvent>,
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
        copilot_event: copilot_event.cloned(),
        hermes_event: hermes_event.cloned(),
        usage: None,
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

fn send_usage_once(
    address: SocketAddr,
    session_id: &str,
    token: &str,
    usage: &AgentUsageReport,
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
        state: None,
        copilot_event: None,
        hermes_event: None,
        usage: Some(usage.clone()),
    })
    .map_err(|error| format!("Cannot encode the agent usage: {error}"))?;
    if payload.len() as u64 > MAX_REPORT_BYTES {
        return Err("The agent usage report is too large.".to_string());
    }
    stream
        .write_all(&payload)
        .and_then(|_| stream.shutdown(Shutdown::Write))
        .map_err(|error| format!("Cannot send the agent usage: {error}"))?;
    let mut response = String::new();
    stream
        .take(16)
        .read_to_string(&mut response)
        .map_err(|error| format!("Cannot read the agent reporter response: {error}"))?;
    if response == "ok\n" {
        Ok(())
    } else {
        Err("The agent reporter rejected the usage update.".to_string())
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
        match send_report_once(address, session_id, token, Some(state), None, None) {
            Ok(()) => return Ok(()),
            Err(error) => last_error = Some(error),
        }
        if attempt + 1 < REPORT_RETRIES {
            std::thread::sleep(Duration::from_millis(40));
        }
    }
    Err(last_error.unwrap_or_else(|| "The agent state report failed.".to_string()))
}

fn send_copilot_event(
    address: SocketAddr,
    session_id: &str,
    token: &str,
    event: &CopilotReporterEvent,
) -> Result<(), String> {
    let mut last_error = None;
    for attempt in 0..REPORT_RETRIES {
        match send_report_once(address, session_id, token, None, Some(event), None) {
            Ok(()) => return Ok(()),
            Err(error) => last_error = Some(error),
        }
        if attempt + 1 < REPORT_RETRIES {
            std::thread::sleep(Duration::from_millis(40));
        }
    }
    Err(last_error.unwrap_or_else(|| "The Copilot lifecycle report failed.".to_string()))
}

fn send_hermes_event(
    address: SocketAddr,
    session_id: &str,
    token: &str,
    event: &HermesReporterEvent,
) -> Result<(), String> {
    let mut last_error = None;
    for attempt in 0..REPORT_RETRIES {
        match send_report_once(address, session_id, token, None, None, Some(event)) {
            Ok(()) => return Ok(()),
            Err(error) => last_error = Some(error),
        }
        if attempt + 1 < REPORT_RETRIES {
            std::thread::sleep(Duration::from_millis(40));
        }
    }
    Err(last_error.unwrap_or_else(|| "The Hermes lifecycle report failed.".to_string()))
}

fn send_usage(
    address: SocketAddr,
    session_id: &str,
    token: &str,
    usage: &AgentUsageReport,
) -> Result<(), String> {
    let mut last_error = None;
    for attempt in 0..REPORT_RETRIES {
        match send_usage_once(address, session_id, token, usage) {
            Ok(()) => return Ok(()),
            Err(error) => last_error = Some(error),
        }
        if attempt + 1 < REPORT_RETRIES {
            std::thread::sleep(Duration::from_millis(40));
        }
    }
    Err(last_error.unwrap_or_else(|| "The agent usage report failed.".to_string()))
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

fn codex_notify_command_from_config(raw: &str) -> Option<Vec<String>> {
    let value = toml::from_str::<toml::Table>(raw).ok()?;
    let command = value
        .get("notify")?
        .as_array()?
        .iter()
        .map(|value| value.as_str().map(str::to_string))
        .collect::<Option<Vec<_>>>()?;
    let total_bytes = command.iter().map(String::len).sum::<usize>();
    (!command.is_empty()
        && command.len() <= MAX_NOTIFY_FORWARD_ARGUMENTS
        && total_bytes <= MAX_NOTIFY_FORWARD_BYTES
        && command
            .iter()
            .all(|argument| !argument.chars().any(char::is_control)))
    .then_some(command)
}

fn configured_codex_notify_command() -> Option<Vec<String>> {
    read_account_file(&[".codex", "config.toml"])
        .and_then(|raw| codex_notify_command_from_config(&raw))
}

fn codex_reporter_arguments_with_forward(
    mut arguments: Vec<String>,
    reporter_executable: &Path,
    forward_command: Option<Vec<String>>,
) -> Vec<String> {
    let explicitly_overridden = arguments.windows(2).any(|pair| {
        pair[0] == "-c"
            && pair[1]
                .trim_start()
                .strip_prefix("notify")
                .is_some_and(|value| value.trim_start().starts_with('='))
    });
    if explicitly_overridden {
        return arguments;
    }

    let forwarded = forward_command
        .and_then(|command| serde_json::to_vec(&command).ok())
        .map(|encoded| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(encoded))
        .unwrap_or_default();
    let command = vec![
        reporter_executable.display().to_string(),
        "agent-notify".to_string(),
        forwarded,
    ];
    let Ok(command) = serde_json::to_string(&command) else {
        return arguments;
    };
    arguments.insert(0, format!("notify={command}"));
    arguments.insert(0, "-c".to_string());
    arguments
}

fn codex_reporter_arguments(arguments: Vec<String>, reporter_executable: &Path) -> Vec<String> {
    codex_reporter_arguments_with_forward(
        arguments,
        reporter_executable,
        configured_codex_notify_command(),
    )
}

fn has_explicit_claude_settings(arguments: &[String]) -> bool {
    arguments.iter().any(|argument| {
        argument == "--settings" || argument.trim_start().starts_with("--settings=")
    })
}

fn claude_reporter_arguments(
    mut arguments: Vec<String>,
    reporter_executable: &Path,
) -> Vec<String> {
    // A second --settings value has version-dependent precedence. Preserve an
    // explicit caller override instead of risking replacement of its hooks.
    if has_explicit_claude_settings(&arguments) {
        return arguments;
    }

    let handler = serde_json::json!({
        "type": "command",
        "command": reporter_executable.display().to_string(),
        "args": ["agent-claude-hook"],
        "timeout": 5
    });
    let hook = |matcher: Option<&str>| {
        let mut value = serde_json::json!({ "hooks": [handler.clone()] });
        if let Some(matcher) = matcher {
            value["matcher"] = serde_json::Value::String(matcher.to_string());
        }
        value
    };
    let settings = serde_json::json!({
        "hooks": {
            "UserPromptSubmit": [hook(None)],
            "PermissionRequest": [hook(None)],
            "Elicitation": [hook(None)],
            "Stop": [hook(None)],
            "StopFailure": [hook(None)],
            "Notification": [hook(None)]
        }
    });
    let Ok(settings) = serde_json::to_string(&settings) else {
        return arguments;
    };
    arguments.insert(0, settings);
    arguments.insert(0, "--settings".to_string());
    arguments
}

#[cfg(windows)]
const GEMINI_REPORTER_COMMAND: &str = r#"& "$env:LATTICETERM_AGENT_REPORTER" agent-gemini-hook"#;
#[cfg(not(windows))]
const GEMINI_REPORTER_COMMAND: &str = r#""$LATTICETERM_AGENT_REPORTER" agent-gemini-hook"#;

fn gemini_reporter_settings_value() -> serde_json::Value {
    let handler = serde_json::json!({
        "name": "latticeterm-agent-status",
        "type": "command",
        "command": GEMINI_REPORTER_COMMAND,
        "timeout": 5000
    });
    let hook = |matcher: Option<&str>| {
        let mut value = serde_json::json!({ "hooks": [handler.clone()] });
        if let Some(matcher) = matcher {
            value["matcher"] = serde_json::Value::String(matcher.to_string());
        }
        value
    };
    serde_json::json!({
        "hooks": {
            "BeforeAgent": [hook(None)],
            "AfterAgent": [hook(None)],
            "Notification": [hook(Some("ToolPermission"))]
        }
    })
}

fn default_gemini_system_settings_paths() -> Option<(PathBuf, PathBuf)> {
    #[cfg(target_os = "windows")]
    let directory = std::env::var_os("ProgramData")
        .map(PathBuf::from)
        .map(|path| path.join("gemini-cli"));
    #[cfg(target_os = "macos")]
    let directory = Some(PathBuf::from("/Library/Application Support/GeminiCli"));
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let directory = Some(PathBuf::from("/etc/gemini-cli"));

    directory.map(|directory| {
        (
            directory.join("settings.json"),
            directory.join("system-defaults.json"),
        )
    })
}

fn gemini_reporter_settings_file() -> Result<Option<tempfile::NamedTempFile>, String> {
    // Never replace an administrator-selected settings layer. Pointing Gemini
    // at our temporary file would otherwise bypass system policy for this PTY.
    if std::env::var_os("GEMINI_CLI_SYSTEM_SETTINGS_PATH").is_some() {
        return Ok(None);
    }
    if let Some((system, defaults)) = default_gemini_system_settings_paths() {
        if system.exists()
            || (std::env::var_os("GEMINI_CLI_SYSTEM_DEFAULTS_PATH").is_none() && defaults.exists())
        {
            return Ok(None);
        }
    }

    let mut file = tempfile::Builder::new()
        .prefix("latticeterm-gemini-hooks-")
        .suffix(".json")
        .tempfile()
        .map_err(|error| format!("Cannot create Gemini hook settings: {error}"))?;
    serde_json::to_writer(&mut file, &gemini_reporter_settings_value())
        .map_err(|error| format!("Cannot write Gemini hook settings: {error}"))?;
    file.flush()
        .map_err(|error| format!("Cannot finish Gemini hook settings: {error}"))?;
    Ok(Some(file))
}

#[cfg(windows)]
const QWEN_REPORTER_COMMAND: &str = r#"& "$env:LATTICETERM_AGENT_REPORTER" agent-qwen-hook"#;
#[cfg(not(windows))]
const QWEN_REPORTER_COMMAND: &str = r#""$LATTICETERM_AGENT_REPORTER" agent-qwen-hook"#;

fn qwen_reporter_settings_value() -> serde_json::Value {
    let handler = serde_json::json!({
        "name": "latticeterm-agent-status",
        "type": "command",
        "command": QWEN_REPORTER_COMMAND,
        "timeout": 5000
    });
    let hook = |matcher: Option<&str>| {
        let mut value = serde_json::json!({ "hooks": [handler.clone()] });
        if let Some(matcher) = matcher {
            value["matcher"] = serde_json::Value::String(matcher.to_string());
        }
        value
    };
    serde_json::json!({
        "hooks": {
            "UserPromptSubmit": [hook(None)],
            "PermissionRequest": [hook(None)],
            "PermissionDenied": [hook(None)],
            "PostToolUse": [hook(None)],
            "PostToolUseFailure": [hook(None)],
            "Stop": [hook(None)],
            "StopFailure": [hook(None)],
            "Notification": [hook(Some("permission_prompt"))]
        }
    })
}

fn qwen_reporter_allowed(arguments: &[String]) -> bool {
    !arguments.iter().any(|argument| {
        argument == "--bare"
            || argument == "--bare=true"
            || argument == "--bare=1"
            || argument == "--safe-mode"
            || argument == "--safe-mode=true"
            || argument == "--safe-mode=1"
    })
}

fn default_qwen_system_settings_paths() -> Option<(PathBuf, PathBuf)> {
    #[cfg(target_os = "windows")]
    let directory = std::env::var_os("ProgramData")
        .map(PathBuf::from)
        .map(|path| path.join("qwen-code"));
    #[cfg(target_os = "macos")]
    let directory = Some(PathBuf::from("/Library/Application Support/QwenCode"));
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let directory = Some(PathBuf::from("/etc/qwen-code"));

    directory.map(|directory| {
        (
            directory.join("settings.json"),
            directory.join("system-defaults.json"),
        )
    })
}

fn qwen_reporter_settings_file(
    arguments: &[String],
) -> Result<Option<tempfile::NamedTempFile>, String> {
    // Bare and safe mode intentionally disable hooks. Existing administrator
    // paths also win so a per-session status integration never bypasses policy.
    if !qwen_reporter_allowed(arguments)
        || std::env::var_os("QWEN_CODE_SYSTEM_SETTINGS_PATH").is_some()
    {
        return Ok(None);
    }
    if let Some((system, defaults)) = default_qwen_system_settings_paths() {
        if system.exists()
            || (std::env::var_os("QWEN_CODE_SYSTEM_DEFAULTS_PATH").is_none() && defaults.exists())
        {
            return Ok(None);
        }
    }

    let mut file = tempfile::Builder::new()
        .prefix("latticeterm-qwen-hooks-")
        .suffix(".json")
        .tempfile()
        .map_err(|error| format!("Cannot create Qwen hook settings: {error}"))?;
    serde_json::to_writer(&mut file, &qwen_reporter_settings_value())
        .map_err(|error| format!("Cannot write Qwen hook settings: {error}"))?;
    file.flush()
        .map_err(|error| format!("Cannot finish Qwen hook settings: {error}"))?;
    Ok(Some(file))
}

const HERMES_REPORTER_PLUGIN: &str = include_str!("agent_hermes_plugin.py");
const HERMES_REPORTER_MANIFEST: &str = include_str!("agent_hermes_plugin.yaml");
const HERMES_REPORTER_PLUGIN_NAME: &str = "latticeterm-session-status-bridge";

fn is_hermes_bundled_plugins_directory(path: &Path) -> bool {
    path.is_dir() && path.join("model-providers").is_dir()
}

fn hermes_bundled_plugins_directory(executable: &Path) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("HERMES_BUNDLED_PLUGINS") {
        candidates.push(PathBuf::from(path));
    }

    if let Some(home) = std::env::var_os("HERMES_HOME").map(PathBuf::from) {
        candidates.push(home.join("hermes-agent").join("plugins"));
        if home.parent().and_then(Path::file_name) == Some(OsStr::new("profiles")) {
            if let Some(root) = home.parent().and_then(Path::parent) {
                candidates.push(root.join("hermes-agent").join("plugins"));
            }
        }
    }

    if let Some(home) = user_home_directory() {
        candidates.push(home.join(".hermes").join("hermes-agent").join("plugins"));
    }
    #[cfg(windows)]
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        candidates.push(
            PathBuf::from(local_app_data)
                .join("hermes")
                .join("hermes-agent")
                .join("plugins"),
        );
    }

    for ancestor in executable.ancestors().skip(1) {
        candidates.push(ancestor.join("plugins"));
        candidates.push(ancestor.join("hermes-agent").join("plugins"));
    }

    candidates
        .into_iter()
        .find(|path| is_hermes_bundled_plugins_directory(path))
}

#[cfg(unix)]
fn mirror_hermes_bundled_plugins(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::unix::fs::symlink;

    for entry in std::fs::read_dir(source)
        .map_err(|error| format!("Cannot read Hermes bundled plugins: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Cannot inspect Hermes plugin: {error}"))?;
        let target = std::fs::canonicalize(entry.path())
            .map_err(|error| format!("Cannot resolve Hermes plugin: {error}"))?;
        symlink(target, destination.join(entry.file_name()))
            .map_err(|error| format!("Cannot mirror Hermes plugin: {error}"))?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn mirror_hermes_bundled_plugins(source: &Path, destination: &Path) -> Result<(), String> {
    fn copy_tree(source: &Path, destination: &Path) -> Result<(), String> {
        std::fs::create_dir(destination)
            .map_err(|error| format!("Cannot create Hermes plugin directory: {error}"))?;
        for entry in std::fs::read_dir(source)
            .map_err(|error| format!("Cannot read Hermes plugin directory: {error}"))?
        {
            let entry = entry.map_err(|error| format!("Cannot inspect Hermes plugin: {error}"))?;
            let source = entry.path();
            let destination = destination.join(entry.file_name());
            let file_type = entry
                .file_type()
                .map_err(|error| format!("Cannot inspect Hermes plugin type: {error}"))?;
            if file_type.is_dir() {
                copy_tree(&source, &destination)?;
            } else if file_type.is_file() {
                std::fs::copy(&source, &destination)
                    .map_err(|error| format!("Cannot copy Hermes plugin: {error}"))?;
            } else {
                return Err("Hermes bundled plugins contain an unsupported link.".to_string());
            }
        }
        Ok(())
    }

    for entry in std::fs::read_dir(source)
        .map_err(|error| format!("Cannot read Hermes bundled plugins: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Cannot inspect Hermes plugin: {error}"))?;
        let source = entry.path();
        let destination = destination.join(entry.file_name());
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Cannot inspect Hermes plugin type: {error}"))?;
        if file_type.is_dir() {
            copy_tree(&source, &destination)?;
        } else if file_type.is_file() {
            std::fs::copy(&source, &destination)
                .map_err(|error| format!("Cannot copy Hermes plugin: {error}"))?;
        } else {
            return Err("Hermes bundled plugins contain an unsupported link.".to_string());
        }
    }
    Ok(())
}

fn write_hermes_reporter_plugin_from_bundle(
    bundled_plugins: &Path,
) -> Result<HermesReporterPlugin, String> {
    let directory = tempfile::Builder::new()
        .prefix("latticeterm-hermes-status-")
        .tempdir()
        .map_err(|error| format!("Cannot create Hermes status plugin overlay: {error}"))?;
    mirror_hermes_bundled_plugins(bundled_plugins, directory.path())?;

    let plugin = directory.path().join(HERMES_REPORTER_PLUGIN_NAME);
    std::fs::create_dir(&plugin)
        .map_err(|error| format!("Cannot create Hermes status plugin: {error}"))?;
    std::fs::write(plugin.join("plugin.yaml"), HERMES_REPORTER_MANIFEST)
        .map_err(|error| format!("Cannot write Hermes status manifest: {error}"))?;
    std::fs::write(plugin.join("__init__.py"), HERMES_REPORTER_PLUGIN)
        .map_err(|error| format!("Cannot write Hermes status observer: {error}"))?;
    Ok(HermesReporterPlugin { directory })
}

fn hermes_reporter_plugin(
    executable: &Path,
    arguments: &[String],
) -> Result<Option<HermesReporterPlugin>, String> {
    if environment_flag_is_true("HERMES_SAFE_MODE")
        || arguments.iter().any(|argument| {
            argument == "--safe-mode"
                || argument == "--safe-mode=1"
                || argument.eq_ignore_ascii_case("--safe-mode=true")
        })
    {
        return Ok(None);
    }
    let Some(bundled_plugins) = hermes_bundled_plugins_directory(executable) else {
        return Ok(None);
    };
    if bundled_plugins.join(HERMES_REPORTER_PLUGIN_NAME).exists() {
        // A future Hermes release or administrator may already own this
        // namespace. Never replace it merely to add status observability.
        return Ok(None);
    }
    write_hermes_reporter_plugin_from_bundle(&bundled_plugins).map(Some)
}

fn copilot_reporter_command(event: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "command",
        "bash": format!(
            "\"$LATTICETERM_AGENT_REPORTER\" agent-copilot-hook {event}"
        ),
        "powershell": format!(
            "& \"$env:LATTICETERM_AGENT_REPORTER\" agent-copilot-hook {event}"
        ),
        "timeoutSec": 5
    })
}

fn copilot_reporter_hooks_value() -> serde_json::Value {
    let hook = |event: &str, matcher: Option<&str>| {
        let mut value = copilot_reporter_command(event);
        if let Some(matcher) = matcher {
            value["matcher"] = serde_json::Value::String(matcher.to_string());
        }
        serde_json::Value::Array(vec![value])
    };
    serde_json::json!({
        "version": 1,
        "hooks": {
            "sessionStart": hook("sessionStart", None),
            "userPromptSubmitted": hook("userPromptSubmitted", None),
            "postToolUse": hook("postToolUse", None),
            "postToolUseFailure": hook("postToolUseFailure", None),
            "agentStop": hook("agentStop", None),
            "permissionRequest": hook("permissionRequest", None),
            "notification": hook(
                "notification",
                Some("permission_prompt|elicitation_dialog|agent_completed|agent_idle")
            ),
            "errorOccurred": hook("errorOccurred", None),
            "subagentStart": hook("subagentStart", None),
            "subagentStop": hook("subagentStop", None)
        }
    })
}

fn write_copilot_reporter_plugin() -> Result<CopilotReporterPlugin, String> {
    let directory = tempfile::Builder::new()
        .prefix("latticeterm-copilot-status-")
        .tempdir()
        .map_err(|error| format!("Cannot create Copilot status plugin: {error}"))?;
    let manifest = serde_json::json!({
        "name": "latticeterm-agent-status",
        "version": "1.0.0",
        "hooks": "hooks.json"
    });
    let manifest = serde_json::to_vec(&manifest)
        .map_err(|error| format!("Cannot encode Copilot status plugin: {error}"))?;
    let hooks = serde_json::to_vec(&copilot_reporter_hooks_value())
        .map_err(|error| format!("Cannot encode Copilot status hooks: {error}"))?;
    std::fs::write(directory.path().join("plugin.json"), manifest)
        .map_err(|error| format!("Cannot write Copilot status plugin: {error}"))?;
    std::fs::write(directory.path().join("hooks.json"), hooks)
        .map_err(|error| format!("Cannot write Copilot status hooks: {error}"))?;
    Ok(CopilotReporterPlugin { directory })
}

fn copilot_reporter_arguments(
    mut arguments: Vec<String>,
    plugin: &CopilotReporterPlugin,
) -> Vec<String> {
    arguments.insert(0, plugin.path().display().to_string());
    arguments.insert(0, "--plugin-dir".to_string());
    arguments
}

const OPENCODE_REPORTER_PLUGIN: &str = include_str!("agent_opencode_plugin.js");

fn opencode_reporter_allowed(
    arguments: &[String],
    config_content_is_set: bool,
    pure_environment: Option<&OsStr>,
) -> bool {
    if config_content_is_set {
        return false;
    }
    let pure_environment = pure_environment
        .and_then(OsStr::to_str)
        .is_some_and(|value| value == "1" || value.eq_ignore_ascii_case("true"));
    if pure_environment {
        return false;
    }
    !arguments.iter().any(|argument| {
        argument == "--pure"
            || argument == "--pure=1"
            || argument.eq_ignore_ascii_case("--pure=true")
    })
}

fn write_opencode_reporter_plugin() -> Result<OpenCodeReporterPlugin, String> {
    let mut file = tempfile::Builder::new()
        .prefix("latticeterm-opencode-status-")
        .suffix(".js")
        .tempfile()
        .map_err(|error| format!("Cannot create OpenCode status plugin: {error}"))?;
    file.write_all(OPENCODE_REPORTER_PLUGIN.as_bytes())
        .map_err(|error| format!("Cannot write OpenCode status plugin: {error}"))?;
    file.flush()
        .map_err(|error| format!("Cannot finish OpenCode status plugin: {error}"))?;
    let path = file
        .path()
        .to_str()
        .ok_or_else(|| "OpenCode status plugin path is not valid UTF-8.".to_string())?;
    let config_content = serde_json::json!({ "plugin": [path] }).to_string();
    Ok(OpenCodeReporterPlugin {
        _file: file,
        config_content,
    })
}

fn opencode_reporter_plugin(
    arguments: &[String],
) -> Result<Option<OpenCodeReporterPlugin>, String> {
    if !opencode_reporter_allowed(
        arguments,
        std::env::var_os("OPENCODE_CONFIG_CONTENT").is_some(),
        std::env::var_os("OPENCODE_PURE").as_deref(),
    ) {
        return Ok(None);
    }
    write_opencode_reporter_plugin().map(Some)
}

#[derive(Debug, Deserialize)]
struct ClaudeHookPayload {
    hook_event_name: String,
    #[serde(default)]
    notification_type: Option<String>,
    #[serde(default)]
    background_tasks: Vec<serde_json::Value>,
    #[serde(default)]
    session_crons: Vec<serde_json::Value>,
}

fn lifecycle_from_claude_hook_payload(raw: &[u8]) -> Result<Option<AgentLifecycle>, String> {
    let payload: ClaudeHookPayload =
        serde_json::from_slice(raw).map_err(|_| "Claude hook payload is invalid.".to_string())?;
    let state = match payload.hook_event_name.as_str() {
        "UserPromptSubmit" => Some(AgentLifecycle::Working),
        "PermissionRequest" | "Elicitation" | "StopFailure" => Some(AgentLifecycle::NeedsAttention),
        "Stop" if !payload.background_tasks.is_empty() => Some(AgentLifecycle::Working),
        "Stop" if !payload.session_crons.is_empty() => Some(AgentLifecycle::Idle),
        "Stop" => Some(AgentLifecycle::Done),
        "Notification" => match payload.notification_type.as_deref() {
            Some(
                "permission_prompt"
                | "elicitation_dialog"
                | "elicitation_url_dialog"
                | "agent_needs_input"
                | "quota_auto_resume_stale"
                | "quota_auto_resume_disabled",
            ) => Some(AgentLifecycle::NeedsAttention),
            Some("quota_auto_resume_fired" | "elicitation_response") => {
                Some(AgentLifecycle::Working)
            }
            _ => None,
        },
        _ => None,
    };
    Ok(state)
}

fn report_claude_hook_from_stdin() -> Result<(), String> {
    let mut payload = Vec::new();
    std::io::stdin()
        .take(MAX_LIFECYCLE_HOOK_BYTES + 1)
        .read_to_end(&mut payload)
        .map_err(|error| format!("Cannot read the Claude hook payload: {error}"))?;
    if payload.len() as u64 > MAX_LIFECYCLE_HOOK_BYTES {
        return Err("Claude hook payload is too large.".to_string());
    }
    if let Some(state) = lifecycle_from_claude_hook_payload(&payload)? {
        report_from_environment(state)?;
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
struct GeminiHookPayload {
    hook_event_name: String,
    #[serde(default)]
    notification_type: Option<String>,
}

fn lifecycle_from_gemini_hook_payload(raw: &[u8]) -> Result<Option<AgentLifecycle>, String> {
    let payload: GeminiHookPayload =
        serde_json::from_slice(raw).map_err(|_| "Gemini hook payload is invalid.".to_string())?;
    Ok(match payload.hook_event_name.as_str() {
        "BeforeAgent" => Some(AgentLifecycle::Working),
        "AfterAgent" => Some(AgentLifecycle::Done),
        "Notification" if payload.notification_type.as_deref() == Some("ToolPermission") => {
            Some(AgentLifecycle::NeedsAttention)
        }
        _ => None,
    })
}

fn report_gemini_hook_from_stdin() -> Result<(), String> {
    let mut payload = Vec::new();
    std::io::stdin()
        .take(MAX_LIFECYCLE_HOOK_BYTES + 1)
        .read_to_end(&mut payload)
        .map_err(|error| format!("Cannot read the Gemini hook payload: {error}"))?;
    if payload.len() as u64 > MAX_LIFECYCLE_HOOK_BYTES {
        return Err("Gemini hook payload is too large.".to_string());
    }
    if let Some(state) = lifecycle_from_gemini_hook_payload(&payload)? {
        report_from_environment(state)?;
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
struct QwenHookPayload {
    hook_event_name: String,
    #[serde(default)]
    notification_type: Option<String>,
    #[serde(default)]
    background_tasks: Vec<serde_json::Value>,
    #[serde(default)]
    crons: Vec<serde_json::Value>,
}

fn lifecycle_from_qwen_hook_payload(raw: &[u8]) -> Result<Option<AgentLifecycle>, String> {
    let payload: QwenHookPayload =
        serde_json::from_slice(raw).map_err(|_| "Qwen hook payload is invalid.".to_string())?;
    Ok(match payload.hook_event_name.as_str() {
        "UserPromptSubmit" | "PermissionDenied" | "PostToolUse" | "PostToolUseFailure" => {
            Some(AgentLifecycle::Working)
        }
        "Stop" if !payload.background_tasks.is_empty() => Some(AgentLifecycle::Working),
        "Stop" if !payload.crons.is_empty() => Some(AgentLifecycle::Idle),
        "Stop" => Some(AgentLifecycle::Done),
        "StopFailure" | "PermissionRequest" => Some(AgentLifecycle::NeedsAttention),
        "Notification" if payload.notification_type.as_deref() == Some("permission_prompt") => {
            Some(AgentLifecycle::NeedsAttention)
        }
        _ => None,
    })
}

fn report_qwen_hook_from_stdin() -> Result<(), String> {
    let mut payload = Vec::new();
    std::io::stdin()
        .take(MAX_LIFECYCLE_HOOK_BYTES + 1)
        .read_to_end(&mut payload)
        .map_err(|error| format!("Cannot read the Qwen hook payload: {error}"))?;
    if payload.len() as u64 > MAX_LIFECYCLE_HOOK_BYTES {
        return Err("Qwen hook payload is too large.".to_string());
    }
    if let Some(state) = lifecycle_from_qwen_hook_payload(&payload)? {
        report_from_environment(state)?;
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
struct HermesHookPayload {
    hook_event_name: String,
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    parent_session_id: Option<String>,
    #[serde(default)]
    child_session_id: Option<String>,
    #[serde(default)]
    api_request_id: Option<String>,
    #[serde(default)]
    usage: Option<HermesHookUsage>,
    #[serde(default)]
    completed: bool,
    #[serde(default)]
    failed: bool,
    #[serde(default)]
    interrupted: bool,
}

#[derive(Debug, Deserialize)]
struct HermesHookUsage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
    #[serde(default)]
    cache_read_tokens: u64,
    #[serde(default)]
    cache_write_tokens: u64,
    #[serde(default)]
    reasoning_tokens: u64,
}

fn valid_hermes_session_id(value: Option<String>, label: &str) -> Result<String, String> {
    let value = value.ok_or_else(|| format!("Hermes {label} session id is missing."))?;
    if value.is_empty()
        || value.len() > MAX_RESUME_SESSION_ID_BYTES
        || value.chars().any(char::is_control)
    {
        return Err(format!("Hermes {label} session id is invalid."));
    }
    Ok(value)
}

fn hermes_event_from_hook_payload(raw: &[u8]) -> Result<HermesReporterEvent, String> {
    let payload: HermesHookPayload =
        serde_json::from_slice(raw).map_err(|_| "Hermes hook payload is invalid.".to_string())?;
    let (source_session_id, action) = match payload.hook_event_name.as_str() {
        "on_session_start" => (
            valid_hermes_session_id(payload.session_id, "source")?,
            HermesReporterAction::SessionStarted,
        ),
        "pre_llm_call" => (
            valid_hermes_session_id(payload.session_id, "source")?,
            HermesReporterAction::TurnStarted,
        ),
        "on_session_end" => (
            valid_hermes_session_id(payload.session_id, "source")?,
            HermesReporterAction::TurnEnded {
                completed: payload.completed,
                failed: payload.failed,
                interrupted: payload.interrupted,
            },
        ),
        "subagent_start" => (
            valid_hermes_session_id(payload.parent_session_id, "parent")?,
            HermesReporterAction::SubagentStarted {
                child_session_id: valid_hermes_session_id(payload.child_session_id, "child")?,
            },
        ),
        "subagent_stop" => (
            valid_hermes_session_id(payload.parent_session_id, "parent")?,
            HermesReporterAction::SubagentStopped {
                child_session_id: valid_hermes_session_id(payload.child_session_id, "child")?,
            },
        ),
        "pre_approval_request" => (
            payload.session_id.unwrap_or_default(),
            HermesReporterAction::NeedsAttention,
        ),
        "post_approval_response" => (
            payload.session_id.unwrap_or_default(),
            HermesReporterAction::ApprovalResolved,
        ),
        _ => return Err("Hermes hook event is unknown.".to_string()),
    };
    Ok(HermesReporterEvent {
        source_session_id,
        action,
    })
}

fn hermes_usage_from_hook_payload(raw: &[u8]) -> Result<AgentUsageReport, String> {
    let payload: HermesHookPayload =
        serde_json::from_slice(raw).map_err(|_| "Hermes hook payload is invalid.".to_string())?;
    if payload.hook_event_name != "post_api_request" {
        return Err("Hermes hook event is not a usage report.".to_string());
    }
    let usage = payload
        .usage
        .ok_or_else(|| "Hermes token usage is missing.".to_string())?;
    let report = AgentUsageReport {
        source_session_id: valid_hermes_session_id(payload.session_id, "source")?,
        request_id: valid_hermes_session_id(payload.api_request_id, "request")?,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_read_tokens: usage.cache_read_tokens,
        cache_write_tokens: usage.cache_write_tokens,
        reasoning_tokens: usage.reasoning_tokens,
    };
    report.validate()?;
    Ok(report)
}

fn report_hermes_hook_from_stdin() -> Result<(), String> {
    let mut payload = Vec::new();
    std::io::stdin()
        .take(MAX_LIFECYCLE_HOOK_BYTES + 1)
        .read_to_end(&mut payload)
        .map_err(|error| format!("Cannot read the Hermes hook payload: {error}"))?;
    if payload.len() as u64 > MAX_LIFECYCLE_HOOK_BYTES {
        return Err("Hermes hook payload is too large.".to_string());
    }
    let hook_event_name = serde_json::from_slice::<serde_json::Value>(&payload)
        .ok()
        .and_then(|value| value.get("hook_event_name")?.as_str().map(str::to_string))
        .ok_or_else(|| "Hermes hook payload is invalid.".to_string())?;
    if hook_event_name == "post_api_request" {
        report_usage_from_environment(&hermes_usage_from_hook_payload(&payload)?)
    } else {
        report_hermes_event_from_environment(&hermes_event_from_hook_payload(&payload)?)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CopilotHookPayload {
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    agent_name: Option<String>,
    #[serde(default, alias = "notification_type")]
    notification_type: Option<String>,
    #[serde(default)]
    recoverable: Option<bool>,
    #[serde(default)]
    tool_name: Option<String>,
    #[serde(default)]
    tool_args: Option<serde_json::Value>,
}

fn valid_copilot_session_id(value: Option<String>) -> Result<String, String> {
    let value = value.ok_or_else(|| "Copilot hook session id is missing.".to_string())?;
    if value.is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
        return Err("Copilot hook session id is invalid.".to_string());
    }
    Ok(value)
}

fn valid_copilot_agent_name(value: Option<String>) -> Result<String, String> {
    let value = value.ok_or_else(|| "Copilot subagent name is missing.".to_string())?;
    if value.is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
        return Err("Copilot subagent name is invalid.".to_string());
    }
    Ok(value)
}

fn copilot_event_from_hook_payload(
    event: &str,
    raw: &[u8],
) -> Result<Option<CopilotReporterEvent>, String> {
    let payload: CopilotHookPayload =
        serde_json::from_slice(raw).map_err(|_| "Copilot hook payload is invalid.".to_string())?;
    let action = match event {
        "sessionStart" => Some(CopilotReporterAction::SessionStarted),
        "userPromptSubmitted" => Some(CopilotReporterAction::TurnStarted),
        "postToolUse"
            if payload.tool_name.as_deref() == Some("task")
                && payload
                    .tool_args
                    .as_ref()
                    .and_then(|args| args.get("mode"))
                    .and_then(serde_json::Value::as_str)
                    == Some("background") =>
        {
            Some(CopilotReporterAction::BackgroundSubagentQueued)
        }
        "postToolUse" | "postToolUseFailure" => Some(CopilotReporterAction::Working),
        "agentStop" => Some(CopilotReporterAction::Stop),
        "permissionRequest" => Some(CopilotReporterAction::NeedsAttention),
        "notification" => match payload.notification_type.as_deref() {
            Some("permission_prompt" | "elicitation_dialog") => {
                Some(CopilotReporterAction::NeedsAttention)
            }
            Some("agent_completed") => Some(CopilotReporterAction::BackgroundCompleted),
            Some("agent_idle") => Some(CopilotReporterAction::BackgroundIdle),
            _ => None,
        },
        "errorOccurred" if payload.recoverable == Some(true) => {
            Some(CopilotReporterAction::RecoverableError)
        }
        "errorOccurred" => Some(CopilotReporterAction::FatalError),
        "subagentStart" => Some(CopilotReporterAction::SubagentStart {
            agent_name: valid_copilot_agent_name(payload.agent_name)?,
        }),
        "subagentStop" => Some(CopilotReporterAction::SubagentStop {
            agent_name: valid_copilot_agent_name(payload.agent_name)?,
        }),
        _ => return Err("Copilot hook event is unknown.".to_string()),
    };
    let Some(action) = action else {
        return Ok(None);
    };
    Ok(Some(CopilotReporterEvent {
        source_session_id: valid_copilot_session_id(payload.session_id)?,
        action,
    }))
}

fn report_copilot_hook_from_stdin(event: &str) -> Result<(), String> {
    let mut payload = Vec::new();
    std::io::stdin()
        .take(MAX_LIFECYCLE_HOOK_BYTES + 1)
        .read_to_end(&mut payload)
        .map_err(|error| format!("Cannot read the Copilot hook payload: {error}"))?;
    if payload.len() as u64 > MAX_LIFECYCLE_HOOK_BYTES {
        return Err("Copilot hook payload is too large.".to_string());
    }
    if let Some(event) = copilot_event_from_hook_payload(event, &payload)? {
        report_copilot_event_from_environment(&event)?;
    }
    Ok(())
}

fn report_from_environment(state: AgentLifecycle) -> Result<(), String> {
    let address: SocketAddr = std::env::var("LATTICETERM_AGENT_REPORT_ADDR")
        .map_err(|_| "Agent reporter environment is unavailable.".to_string())?
        .parse()
        .map_err(|_| "Agent reporter address is invalid.".to_string())?;
    let session_id = std::env::var("LATTICETERM_AGENT_SESSION")
        .map_err(|_| "Agent reporter session is unavailable.".to_string())?;
    let token = std::env::var("LATTICETERM_AGENT_REPORT_TOKEN")
        .map_err(|_| "Agent reporter token is unavailable.".to_string())?;
    send_report(address, &session_id, &token, state)
}

fn report_copilot_event_from_environment(event: &CopilotReporterEvent) -> Result<(), String> {
    let address: SocketAddr = std::env::var("LATTICETERM_AGENT_REPORT_ADDR")
        .map_err(|_| "Agent reporter environment is unavailable.".to_string())?
        .parse()
        .map_err(|_| "Agent reporter address is invalid.".to_string())?;
    let session_id = std::env::var("LATTICETERM_AGENT_SESSION")
        .map_err(|_| "Agent reporter session is unavailable.".to_string())?;
    let token = std::env::var("LATTICETERM_AGENT_REPORT_TOKEN")
        .map_err(|_| "Agent reporter token is unavailable.".to_string())?;
    send_copilot_event(address, &session_id, &token, event)
}

fn report_hermes_event_from_environment(event: &HermesReporterEvent) -> Result<(), String> {
    let address: SocketAddr = std::env::var("LATTICETERM_AGENT_REPORT_ADDR")
        .map_err(|_| "Agent reporter environment is unavailable.".to_string())?
        .parse()
        .map_err(|_| "Agent reporter address is invalid.".to_string())?;
    let session_id = std::env::var("LATTICETERM_AGENT_SESSION")
        .map_err(|_| "Agent reporter session is unavailable.".to_string())?;
    let token = std::env::var("LATTICETERM_AGENT_REPORT_TOKEN")
        .map_err(|_| "Agent reporter token is unavailable.".to_string())?;
    send_hermes_event(address, &session_id, &token, event)
}

fn report_usage_from_environment(usage: &AgentUsageReport) -> Result<(), String> {
    let address: SocketAddr = std::env::var("LATTICETERM_AGENT_REPORT_ADDR")
        .map_err(|_| "Agent reporter environment is unavailable.".to_string())?
        .parse()
        .map_err(|_| "Agent reporter address is invalid.".to_string())?;
    let session_id = std::env::var("LATTICETERM_AGENT_SESSION")
        .map_err(|_| "Agent reporter session is unavailable.".to_string())?;
    let token = std::env::var("LATTICETERM_AGENT_REPORT_TOKEN")
        .map_err(|_| "Agent reporter token is unavailable.".to_string())?;
    send_usage(address, &session_id, &token, usage)
}

fn decode_forward_notify(value: &str) -> Option<Vec<String>> {
    if value.is_empty() || value.len() > MAX_NOTIFY_FORWARD_BYTES * 2 {
        return None;
    }
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(value)
        .ok()?;
    let command: Vec<String> = serde_json::from_slice(&decoded).ok()?;
    let total_bytes = command.iter().map(String::len).sum::<usize>();
    (!command.is_empty()
        && command.len() <= MAX_NOTIFY_FORWARD_ARGUMENTS
        && total_bytes <= MAX_NOTIFY_FORWARD_BYTES
        && command
            .iter()
            .all(|argument| !argument.chars().any(char::is_control)))
    .then_some(command)
}

fn forward_codex_notification(encoded: &str, payload: &OsStr) {
    let Some(command) = decode_forward_notify(encoded) else {
        return;
    };
    let mut child = std::process::Command::new(&command[0]);
    child.args(&command[1..]).arg(payload);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        child.creation_flags(0x08000000);
    }
    let _ = child.spawn();
}

#[derive(Debug, Deserialize)]
struct CodexNotificationKind {
    #[serde(rename = "type")]
    kind: String,
}

fn is_codex_turn_complete_notification(payload: &OsStr) -> bool {
    payload
        .to_str()
        .and_then(|raw| serde_json::from_str::<CodexNotificationKind>(raw).ok())
        .is_some_and(|notification| notification.kind == "agent-turn-complete")
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
    let command = args.next()?;
    let result = if command.as_ref() == OsStr::new("agent-report") {
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
        report_from_environment(state)
    } else if command.as_ref() == OsStr::new("agent-notify") {
        let encoded = args
            .next()
            .and_then(|value| value.as_ref().to_str().map(str::to_string));
        let payload = args.next();
        if args.next().is_some() {
            eprintln!("agent-notify accepts one forwarded command and one payload");
            return Some(2);
        }
        let Some(encoded) = encoded else {
            eprintln!("agent-notify is missing its forwarded command");
            return Some(2);
        };
        let Some(payload) = payload.as_ref() else {
            eprintln!("agent-notify is missing its notification payload");
            return Some(2);
        };
        forward_codex_notification(&encoded, payload.as_ref());
        if is_codex_turn_complete_notification(payload.as_ref()) {
            report_from_environment(AgentLifecycle::Done)
        } else {
            Ok(())
        }
    } else if command.as_ref() == OsStr::new("agent-claude-hook") {
        if args.next().is_some() {
            eprintln!("agent-claude-hook accepts no arguments");
            return Some(2);
        }
        report_claude_hook_from_stdin()
    } else if command.as_ref() == OsStr::new("agent-gemini-hook") {
        if args.next().is_some() {
            eprintln!("agent-gemini-hook accepts no arguments");
            return Some(2);
        }
        let result = report_gemini_hook_from_stdin();
        if result.is_ok() {
            // Gemini parses successful hook stdout as JSON. Suppress its
            // internal status hook from adding noise to the terminal UI.
            println!(r#"{{"suppressOutput":true}}"#);
        }
        result
    } else if command.as_ref() == OsStr::new("agent-copilot-hook") {
        let event = args
            .next()
            .and_then(|value| value.as_ref().to_str().map(str::to_string));
        if args.next().is_some() {
            eprintln!("agent-copilot-hook accepts exactly one event");
            return Some(2);
        }
        let Some(event) = event else {
            eprintln!("agent-copilot-hook is missing its event");
            return Some(2);
        };
        report_copilot_hook_from_stdin(&event)
    } else if command.as_ref() == OsStr::new("agent-hermes-hook") {
        if args.next().is_some() {
            eprintln!("agent-hermes-hook accepts no arguments");
            return Some(2);
        }
        report_hermes_hook_from_stdin()
    } else if command.as_ref() == OsStr::new("agent-qwen-hook") {
        if args.next().is_some() {
            eprintln!("agent-qwen-hook accepts no arguments");
            return Some(2);
        }
        report_qwen_hook_from_stdin()
    } else {
        return None;
    };
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
            let path = find_agent_executable(agent);
            AgentDefinition {
                id: agent.id.to_string(),
                label: agent.label.to_string(),
                executable: agent.executable.to_string(),
                adapter_version: AGENT_ADAPTER_VERSION,
                resume_supported: agent.resume_recipe.is_some(),
                resume_latest_supported: agent.resume_latest_recipe.is_some(),
                transcript_supported: crate::transcript::TranscriptKind::from_definition(agent.id)
                    .is_some(),
                installed: path.is_some(),
                installed_path: path.map(|path| path.display().to_string()),
                consumer_oauth_deprecated: agent.id == "gemini"
                    && gemini_consumer_oauth_deprecated(),
                account: detect_agent_account(agent.id),
                install: install_definition(agent.id),
            }
        })
        .collect()
}

fn account_info(
    state: AgentAccountState,
    label: Option<String>,
    method: Option<&str>,
) -> AgentAccountInfo {
    AgentAccountInfo {
        state,
        label,
        method: method.map(str::to_string),
    }
}

fn safe_account_label(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty() && value.len() <= 320 && !value.chars().any(char::is_control))
        .then(|| value.to_string())
}

fn user_home_directory() -> Option<PathBuf> {
    #[cfg(windows)]
    let variable = "USERPROFILE";
    #[cfg(not(windows))]
    let variable = "HOME";
    std::env::var_os(variable)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn read_account_file(relative: &[&str]) -> Option<String> {
    let mut path = user_home_directory()?;
    for component in relative {
        path.push(component);
    }
    std::fs::read_to_string(path).ok()
}

fn gemini_auth_type_from_json(raw: &str) -> Option<String> {
    let document = serde_json::from_str::<serde_json::Value>(raw).ok()?;
    document
        .pointer("/security/auth/selectedType")
        .or_else(|| document.get("selectedAuthType"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 80)
        .map(str::to_string)
}

fn environment_value_is_present(name: &str) -> bool {
    std::env::var_os(name).is_some_and(|value| !value.is_empty())
}

fn environment_flag_is_true(name: &str) -> bool {
    std::env::var_os(name).is_some_and(|value| {
        matches!(
            value.to_string_lossy().trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    })
}

fn gemini_consumer_oauth_deprecated() -> bool {
    if [
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "GOOGLE_APPLICATION_CREDENTIALS",
        "GOOGLE_CLOUD_PROJECT",
        "GOOGLE_CLOUD_PROJECT_ID",
    ]
    .iter()
    .any(|name| environment_value_is_present(name))
        || environment_flag_is_true("GOOGLE_GENAI_USE_VERTEXAI")
    {
        return false;
    }
    read_account_file(&[".gemini", "settings.json"])
        .and_then(|raw| gemini_auth_type_from_json(&raw))
        .is_some_and(|auth_type| auth_type.eq_ignore_ascii_case("oauth-personal"))
}

fn codex_account_from_json(raw: &str) -> AgentAccountInfo {
    let Ok(document) = serde_json::from_str::<serde_json::Value>(raw) else {
        return account_info(AgentAccountState::Unknown, None, None);
    };
    let mode = document
        .get("auth_mode")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    let method = if mode.eq_ignore_ascii_case("chatgpt") {
        "ChatGPT"
    } else if mode.to_ascii_lowercase().contains("api") {
        "OpenAI API Key"
    } else {
        "OpenAI Codex"
    };
    let email = document
        .pointer("/tokens/id_token")
        .and_then(serde_json::Value::as_str)
        .and_then(|token| token.split('.').nth(1))
        .and_then(|payload| {
            base64::engine::general_purpose::URL_SAFE_NO_PAD
                .decode(payload)
                .ok()
        })
        .and_then(|payload| serde_json::from_slice::<serde_json::Value>(&payload).ok())
        .and_then(|claims| {
            claims
                .get("email")
                .and_then(serde_json::Value::as_str)
                .and_then(safe_account_label)
        });
    if email.is_some() || !mode.is_empty() {
        account_info(AgentAccountState::SignedIn, email, Some(method))
    } else {
        account_info(AgentAccountState::Unknown, None, None)
    }
}

fn claude_account_from_json(raw: &str) -> AgentAccountInfo {
    let Ok(document) = serde_json::from_str::<serde_json::Value>(raw) else {
        return account_info(AgentAccountState::Unknown, None, None);
    };
    let email = document
        .pointer("/oauthAccount/emailAddress")
        .and_then(serde_json::Value::as_str)
        .and_then(safe_account_label);
    if email.is_some() {
        account_info(AgentAccountState::SignedIn, email, Some("Claude.ai"))
    } else {
        account_info(AgentAccountState::Unknown, None, None)
    }
}

fn gemini_account_from_json(raw: &str) -> AgentAccountInfo {
    let Ok(document) = serde_json::from_str::<serde_json::Value>(raw) else {
        return account_info(AgentAccountState::Unknown, None, None);
    };
    let email = document
        .get("active")
        .and_then(serde_json::Value::as_str)
        .and_then(safe_account_label);
    if email.is_some() {
        account_info(AgentAccountState::SignedIn, email, Some("Google"))
    } else {
        account_info(AgentAccountState::Unknown, None, None)
    }
}

fn detect_agent_account(definition_id: &str) -> AgentAccountInfo {
    match definition_id {
        "codex" => read_account_file(&[".codex", "auth.json"])
            .map(|raw| codex_account_from_json(&raw))
            .unwrap_or_else(|| account_info(AgentAccountState::Unknown, None, None)),
        "claude" => read_account_file(&[".claude.json"])
            .map(|raw| claude_account_from_json(&raw))
            .unwrap_or_else(|| account_info(AgentAccountState::Unknown, None, None)),
        "gemini" => read_account_file(&[".gemini", "google_accounts.json"])
            .map(|raw| gemini_account_from_json(&raw))
            .unwrap_or_else(|| account_info(AgentAccountState::Unknown, None, None)),
        _ => account_info(AgentAccountState::Unsupported, None, None),
    }
}

fn find_agent_executable(agent: &AgentSpec) -> Option<PathBuf> {
    find_executable(agent.executable)
        .or_else(|| find_well_known_agent_executable(agent))
        .or_else(|| {
            (agent.id == "cursor")
                .then(|| find_executable("cursor-agent"))
                .flatten()
        })
}

#[cfg(windows)]
fn well_known_agent_path(agent_id: &str, local_app_data: &Path) -> Option<PathBuf> {
    match agent_id {
        // The official Windows installer adds this new directory to the user
        // PATH. The running desktop process keeps its old environment block,
        // so catalog refresh also checks the documented install location.
        "antigravity" => Some(local_app_data.join("agy").join("bin").join("agy.exe")),
        _ => None,
    }
}

#[cfg(windows)]
fn find_well_known_agent_executable(agent: &AgentSpec) -> Option<PathBuf> {
    let local_app_data = std::env::var_os("LOCALAPPDATA").map(PathBuf::from)?;
    let candidate = well_known_agent_path(agent.id, &local_app_data)?;
    is_executable(&candidate)
        .then(|| plain_win32_path(candidate.canonicalize().unwrap_or(candidate)))
}

#[cfg(not(windows))]
fn find_well_known_agent_executable(_agent: &AgentSpec) -> Option<PathBuf> {
    None
}

fn direct_install(
    executable: &str,
    arguments: &[&str],
    display_command: &str,
    source_url: &str,
) -> AgentInstallDefinition {
    AgentInstallDefinition {
        executable: Some(executable.to_string()),
        arguments: arguments.iter().map(|value| value.to_string()).collect(),
        display_command: display_command.to_string(),
        source_url: source_url.to_string(),
        available: find_executable(executable).is_some(),
    }
}

fn manual_install(display_command: &str, source_url: &str) -> AgentInstallDefinition {
    AgentInstallDefinition {
        executable: None,
        arguments: Vec::new(),
        display_command: display_command.to_string(),
        source_url: source_url.to_string(),
        available: false,
    }
}

fn npm_install(package: &str, source_url: &str) -> AgentInstallDefinition {
    direct_install(
        "npm",
        &["install", "-g", package],
        &format!("npm install -g {package}"),
        source_url,
    )
}

#[cfg(windows)]
fn official_script_install(
    script_url: &str,
    display_command: &str,
    source_url: &str,
) -> AgentInstallDefinition {
    let command = format!("Invoke-RestMethod '{script_url}' | Invoke-Expression");
    direct_install(
        "powershell.exe",
        &[
            "-NoLogo",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &command,
        ],
        display_command,
        source_url,
    )
}

#[cfg(not(windows))]
fn official_script_install(
    _script_url: &str,
    display_command: &str,
    source_url: &str,
) -> AgentInstallDefinition {
    direct_install("sh", &["-c", display_command], display_command, source_url)
}

fn install_definition(definition_id: &str) -> AgentInstallDefinition {
    match definition_id {
        "codex" => npm_install(
            "@openai/codex",
            "https://developers.openai.com/codex/cli/",
        ),
        "claude" => npm_install(
            "@anthropic-ai/claude-code",
            "https://docs.anthropic.com/en/docs/claude-code/getting-started",
        ),
        "gemini" => npm_install(
            "@google/gemini-cli",
            "https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/installation.md",
        ),
        "antigravity" => official_script_install(
            if cfg!(windows) {
                "https://antigravity.google/cli/install.ps1"
            } else {
                "https://antigravity.google/cli/install.sh"
            },
            if cfg!(windows) {
                "irm https://antigravity.google/cli/install.ps1 | iex"
            } else {
                "curl -fsSL https://antigravity.google/cli/install.sh | bash"
            },
            "https://codelabs.developers.google.com/antigravity-cli-hands-on",
        ),
        "opencode" => npm_install("opencode-ai", "https://opencode.ai/docs/"),
        "copilot" => npm_install("@github/copilot", "https://github.com/features/copilot/cli/"),
        "hermes" => official_script_install(
            if cfg!(windows) {
                "https://hermes-agent.nousresearch.com/install.ps1"
            } else {
                "https://hermes-agent.nousresearch.com/install.sh"
            },
            if cfg!(windows) {
                "irm https://hermes-agent.nousresearch.com/install.ps1 | iex"
            } else {
                "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash"
            },
            "https://github.com/NousResearch/hermes-agent#quick-install",
        ),
        "cursor" => official_script_install(
            if cfg!(windows) {
                "https://cursor.com/install?win32=true"
            } else {
                "https://cursor.com/install"
            },
            if cfg!(windows) {
                "irm 'https://cursor.com/install?win32=true' | iex"
            } else {
                "curl https://cursor.com/install -fsS | bash"
            },
            "https://cursor.com/docs/cli/installation",
        ),
        "aider" => official_script_install(
            if cfg!(windows) {
                "https://aider.chat/install.ps1"
            } else {
                "https://aider.chat/install.sh"
            },
            if cfg!(windows) {
                "powershell -ExecutionPolicy ByPass -c \"irm https://aider.chat/install.ps1 | iex\""
            } else {
                "curl -LsSf https://aider.chat/install.sh | sh"
            },
            "https://aider.chat/docs/install.html",
        ),
        "qwen" => npm_install(
            "@qwen-code/qwen-code@latest",
            "https://github.com/QwenLM/qwen-code/blob/main/scripts/installation/INSTALLATION_GUIDE.md",
        ),
        "kimi" => official_script_install(
            if cfg!(windows) {
                "https://code.kimi.com/kimi-code/install.ps1"
            } else {
                "https://code.kimi.com/kimi-code/install.sh"
            },
            if cfg!(windows) {
                "irm https://code.kimi.com/kimi-code/install.ps1 | iex"
            } else {
                "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash"
            },
            "https://github.com/MoonshotAI/kimi-code#install",
        ),
        "droid" => npm_install("droid", "https://github.com/Factory-AI/factory#installation"),
        "grok" => {
            #[cfg(windows)]
            {
                manual_install(
                    "curl -fsSL https://raw.githubusercontent.com/superagent-ai/grok-cli/main/install.sh | bash",
                    "https://github.com/superagent-ai/grok-cli#install",
                )
            }
            #[cfg(not(windows))]
            {
                official_script_install(
                    "https://raw.githubusercontent.com/superagent-ai/grok-cli/main/install.sh",
                    "curl -fsSL https://raw.githubusercontent.com/superagent-ai/grok-cli/main/install.sh | bash",
                    "https://github.com/superagent-ai/grok-cli#install",
                )
            }
        }
        _ => manual_install("", ""),
    }
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
                // .cmd/.bat cover npm/pnpm/yarn global shims — how Claude Code,
                // Gemini CLI and most Node-based agents land on Windows PATH.
                extension.eq_ignore_ascii_case("exe")
                    || extension.eq_ignore_ascii_case("com")
                    || extension.eq_ignore_ascii_case("cmd")
                    || extension.eq_ignore_ascii_case("bat")
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
        let path_ext =
            std::env::var_os("PATHEXT").unwrap_or_else(|| OsString::from(".COM;.EXE;.BAT;.CMD"));
        values.extend(
            path_ext
                .to_string_lossy()
                .split(';')
                .filter(|value| {
                    value.eq_ignore_ascii_case(".COM")
                        || value.eq_ignore_ascii_case(".EXE")
                        || value.eq_ignore_ascii_case(".CMD")
                        || value.eq_ignore_ascii_case(".BAT")
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
                return Some(plain_win32_path(
                    candidate.canonicalize().unwrap_or(candidate),
                ));
            }
        }
    }
    None
}

/// Resolves how to actually launch a detected executable.
///
/// Converts the verbatim path returned by `canonicalize` into a Win32 path.
/// Some executables accept `\\?\` while others do not; notably Windows
/// PowerShell 5.1 fails during .NET initialization when launched that way.
#[cfg(windows)]
fn plain_windows_path(path: &Path) -> OsString {
    let raw = path.as_os_str().to_string_lossy();
    const VERBATIM_UNC: &str = r"\\?\UNC\";
    if raw
        .get(..VERBATIM_UNC.len())
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(VERBATIM_UNC))
    {
        return OsString::from(format!(r"\\{}", &raw[VERBATIM_UNC.len()..]));
    }
    raw.strip_prefix(r"\\?\")
        .map(OsString::from)
        .unwrap_or_else(|| path.as_os_str().to_os_string())
}

/// `canonicalize` returns verbatim (`\\?\`) paths on Windows, and the prefix
/// leaks into everything downstream: the child CLI records its cwd exactly as
/// given, and detected executable paths show up on the Agent Fleet cards.
/// Every canonicalized path is stripped back to plain Win32 form.
#[cfg(windows)]
fn plain_win32_path(path: PathBuf) -> PathBuf {
    PathBuf::from(plain_windows_path(&path))
}

#[cfg(not(windows))]
fn plain_win32_path(path: PathBuf) -> PathBuf {
    path
}

/// Windows cannot `CreateProcess` a `.cmd`/`.bat` shim directly, so those are
/// routed through the command processor (`cmd.exe /c <script>`). All launch
/// paths are first converted out of verbatim form for child compatibility.
#[cfg(windows)]
fn launch_parts(executable: &Path) -> (OsString, Vec<OsString>) {
    let executable = plain_windows_path(executable);
    let is_script = Path::new(&executable)
        .extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("cmd") || extension.eq_ignore_ascii_case("bat")
        });
    if !is_script {
        return (executable, Vec::new());
    }
    let comspec = std::env::var_os("ComSpec").unwrap_or_else(|| OsString::from("cmd.exe"));
    (comspec, vec![OsString::from("/c"), executable])
}

#[cfg(not(windows))]
fn launch_parts(executable: &Path) -> (OsString, Vec<OsString>) {
    (executable.as_os_str().to_os_string(), Vec::new())
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

/// Validates the optional free-text note on a saved launch plan. Unlike
/// `validate_text`, an empty note is allowed and normalises to `""`.
fn validate_optional_note(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    if trimmed.len() > MAX_PLAN_NOTE_BYTES {
        return Err(format!(
            "Note is too long (maximum {MAX_PLAN_NOTE_BYTES} bytes)."
        ));
    }
    if trimmed.chars().any(char::is_control) {
        return Err("Note contains unsupported control characters.".to_string());
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
    let working_directory = plain_win32_path(
        PathBuf::from(validate_text(
            &draft.working_directory,
            "Working directory",
            4096,
        )?)
        .canonicalize()
        .map_err(|error| format!("Cannot open the working directory: {error}"))?,
    );
    if !working_directory.is_dir() {
        return Err("Working directory is not a directory.".to_string());
    }

    let note = validate_optional_note(&draft.note)?;

    Ok(AgentLaunchPlan {
        id,
        definition_id,
        label,
        executable,
        arguments,
        resume_session_id,
        note,
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
            note: plan.note.clone(),
            working_directory: plan.working_directory.clone(),
        },
    )?;
    // A saved Codex item means "continue this directory" rather than "open a
    // blank chat". Codex itself resolves --last within the current working
    // directory, so LatticeTerm does not need to persist a session id or read
    // the CLI's private transcript store. Explicit legacy resume ids still win.
    let mut restore_existing_session = validated.resume_session_id.is_some();
    let arguments = if validated.resume_session_id.is_none() && validated.arguments.is_empty() {
        let resume_arguments = AGENTS
            .iter()
            .find(|agent| agent.id == validated.definition_id)
            .and_then(|agent| agent.resume_latest_recipe)
            .map(AgentResumeLatestRecipe::arguments);
        restore_existing_session = resume_arguments.is_some();
        resume_arguments.unwrap_or_default()
    } else {
        validated.arguments
    };

    Ok(AgentLaunchRequest {
        definition_id: validated.definition_id,
        label: validated.label,
        executable: validated.executable,
        arguments,
        resume_session_id: validated.resume_session_id,
        // A saved plan launches its own tab; grouping is a live-tab action.
        group_id: None,
        seed_input: None,
        restore_existing_session,
        working_directory: validated.working_directory,
        cols,
        rows,
    })
}

/// Adds the user's opt-in workspace instructions ahead of any one-off handoff
/// seed. Custom sessions are installation/helper commands rather than AI CLIs
/// and must never receive the workspace prompt.
pub fn apply_startup_instructions(
    request: &mut AgentLaunchRequest,
    instructions: &str,
) -> Result<(), String> {
    let instructions = instructions.trim();
    if instructions.is_empty()
        || request.definition_id == "custom"
        || request.restore_existing_session
    {
        return Ok(());
    }
    let existing = request
        .seed_input
        .take()
        .filter(|value| !value.trim().is_empty());
    let merged = existing
        .map(|seed| format!("{instructions}\n\n---\n\n{seed}"))
        .unwrap_or_else(|| instructions.to_string());
    if merged.len() > MAX_INPUT_BYTES {
        return Err(format!(
            "Startup instructions and handoff text exceed {MAX_INPUT_BYTES} bytes."
        ));
    }
    request.seed_input = Some(merged);
    Ok(())
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

    let executable = spec
        .and_then(find_agent_executable)
        .or_else(|| {
            (definition_id == "custom")
                .then(|| find_executable(&command))
                .flatten()
        })
        .ok_or_else(|| format!("{default_label} is not installed or is not available on PATH."))?;
    let working_directory = plain_win32_path(
        PathBuf::from(validate_text(
            &request.working_directory,
            "Working directory",
            4096,
        )?)
        .canonicalize()
        .map_err(|error| format!("Cannot open the working directory: {error}"))?,
    );
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

fn migrate_deprecated_google_consumer_request(
    request: &AgentLaunchRequest,
    deprecated: bool,
) -> Result<AgentLaunchRequest, String> {
    if request.definition_id != "gemini" || !deprecated {
        return Ok(request.clone());
    }
    if (!request.arguments.is_empty() || request.resume_session_id.is_some())
        && !request.restore_existing_session
    {
        return Err(
            "Gemini CLI personal OAuth moved to Google Antigravity CLI, but Gemini-specific arguments or session IDs cannot be migrated safely. Start a new Antigravity session instead."
                .to_string(),
        );
    }

    let mut migrated = request.clone();
    migrated.definition_id = "antigravity".to_string();
    migrated.executable = "agy".to_string();
    if migrated.label.trim().is_empty() || migrated.label.trim() == "Gemini CLI" {
        migrated.label = "Google Antigravity CLI".to_string();
    }
    // Gemini and Antigravity use different native conversation identifiers
    // and flags. Reopening the project is safe; pretending the old identifier
    // can be resumed is not.
    migrated.arguments.clear();
    migrated.resume_session_id = None;
    Ok(migrated)
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

fn clean_model_token(value: &str) -> Option<String> {
    let value = value.trim().trim_matches(|character: char| {
        matches!(
            character,
            '`' | '"' | '\'' | '[' | ']' | '(' | ')' | '│' | '┃'
        )
    });
    let token = value
        .split_whitespace()
        .next()?
        .trim_matches(|character: char| !character.is_ascii_alphanumeric() && character != '.')
        .trim_end_matches([',', ';', ':']);
    if token.is_empty()
        || token.len() > 80
        || !token.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_' | '/' | ':')
        })
    {
        return None;
    }
    let lowered = token.to_ascii_lowercase();
    let named_alias = matches!(
        lowered.as_str(),
        "auto" | "default" | "opus" | "sonnet" | "haiku" | "flash" | "pro"
    );
    (token.chars().any(|character| character.is_ascii_digit()) || named_alias)
        .then(|| token.to_string())
}

fn model_from_arguments(arguments: &[String]) -> Option<String> {
    for (index, argument) in arguments.iter().enumerate() {
        if matches!(argument.as_str(), "--model" | "-m") {
            return arguments
                .get(index + 1)
                .and_then(|value| clean_model_token(value));
        }
        if let Some(value) = argument.strip_prefix("--model=") {
            return clean_model_token(value);
        }
    }
    None
}

fn codex_model_from_config(raw: &str) -> Option<String> {
    for line in raw.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            // Codex profiles and other sections may contain their own model.
            // Only the top-level value describes the model used by default.
            break;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if key.trim() == "model" {
            return clean_model_token(value);
        }
    }
    None
}

fn configured_agent_model(definition_id: &str) -> Option<String> {
    match definition_id {
        "codex" => read_account_file(&[".codex", "config.toml"])
            .and_then(|raw| codex_model_from_config(&raw)),
        _ => None,
    }
}

fn claude_family_model(line: &str) -> Option<String> {
    let lowered = line.to_ascii_lowercase();
    for family in ["opus", "sonnet", "haiku"] {
        let Some(index) = lowered.find(family) else {
            continue;
        };
        let suffix = &line[index + family.len()..];
        let version = suffix.split_whitespace().next().and_then(clean_model_token);
        let title = format!("{}{}", family[..1].to_ascii_uppercase(), &family[1..]);
        return Some(match version {
            Some(version) if version.chars().any(|character| character.is_ascii_digit()) => {
                format!("Claude {title} {version}")
            }
            _ => format!("Claude {title}"),
        });
    }
    None
}

fn status_model_token(definition_id: &str, line: &str) -> Option<String> {
    let prefixes: &[&str] = match definition_id {
        "codex" => &["gpt-", "o1-", "o3-", "o4-", "codex-"],
        "claude" => &["claude-"],
        "gemini" => &["gemini-"],
        "qwen" => &["qwen"],
        "kimi" => &["kimi-", "moonshot-"],
        "grok" => &["grok-"],
        _ => &[],
    };
    line.split_whitespace().find_map(|value| {
        let token = clean_model_token(value)?;
        let lowered = token.to_ascii_lowercase();
        prefixes
            .iter()
            .any(|prefix| lowered.starts_with(prefix))
            .then_some(token)
    })
}

/// Conservatively reads model fields from CLI startup/status output. Generic
/// matching requires an explicit `model:`/`model=` label; Claude's TUI is the
/// one verified exception because it prints family names as a status badge.
fn find_model_name(definition_id: &str, text: &str) -> Option<String> {
    for line in text.lines().rev() {
        if definition_id == "claude" {
            if let Some(model) = claude_family_model(line) {
                return Some(model);
            }
        }
        if let Some(model) = status_model_token(definition_id, line) {
            return Some(model);
        }
        let lowered = line.to_ascii_lowercase();
        let marker = lowered
            .find("model:")
            .map(|index| (index, "model:".len()))
            .or_else(|| {
                lowered
                    .find("model =")
                    .map(|index| (index, "model =".len()))
            })
            .or_else(|| lowered.find("model=").map(|index| (index, "model=".len())));
        if let Some((index, marker_length)) = marker {
            if let Some(model) = clean_model_token(&line[index + marker_length..]) {
                if definition_id == "claude" {
                    let lowered = model.to_ascii_lowercase();
                    if matches!(lowered.as_str(), "opus" | "sonnet" | "haiku") {
                        return Some(format!(
                            "Claude {}{}",
                            lowered[..1].to_ascii_uppercase(),
                            &lowered[1..]
                        ));
                    }
                }
                return Some(model);
            }
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
    launch_with_replay(sink, registry, request, None)
}

pub fn launch_with_replay(
    sink: Arc<dyn AgentSink>,
    registry: Arc<AgentRegistry>,
    request: AgentLaunchRequest,
    restored_output: Option<Vec<u8>>,
) -> Result<AgentSessionSummary, String> {
    let request =
        migrate_deprecated_google_consumer_request(&request, gemini_consumer_oauth_deprecated())?;
    let launched_at = Instant::now();
    let size = validated_size(request.cols, request.rows)?;
    let launch_arguments = request.arguments.clone();
    let (definition_id, label, executable, mut arguments, working_directory) =
        resolve_launch(&request)?;
    let launch_model =
        model_from_arguments(&arguments).or_else(|| configured_agent_model(&definition_id));
    let session_id = registry.next_id();
    let reporter = registry.reporter.clone();
    let report_token = reporter
        .as_ref()
        .map(|_| random_report_token())
        .transpose()?;
    let mut integration_settings = None;
    let mut integrated_completion = false;
    if definition_id == "codex" {
        if let Some(endpoint) = reporter.as_ref() {
            let adapted = codex_reporter_arguments(arguments.clone(), &endpoint.executable);
            integrated_completion = adapted != arguments;
            arguments = adapted;
        }
    } else if definition_id == "claude" {
        if let Some(endpoint) = reporter.as_ref() {
            let adapted = claude_reporter_arguments(arguments.clone(), &endpoint.executable);
            integrated_completion = adapted != arguments;
            arguments = adapted;
        }
    } else if definition_id == "gemini" && reporter.is_some() {
        // Gemini has no one-shot --settings argument. Its documented system
        // settings path is process-scoped, so a temporary file adds hooks
        // without touching ~/.gemini or the selected workspace.
        integration_settings = gemini_reporter_settings_file()
            .ok()
            .flatten()
            .map(AgentIntegrationSettings::Gemini);
        // Only disable prompt-control completion guesses when the settings
        // file was actually installed. Managed-policy fallbacks stay
        // heuristic, while an active official AfterAgent hook is authoritative.
        integrated_completion = integration_settings.is_some();
    } else if definition_id == "opencode" && reporter.is_some() {
        // OpenCode merges runtime config with global/project/admin layers. A
        // temporary local plugin observes only this process and never edits
        // the user's files. Explicit inline config or pure mode wins.
        integration_settings = opencode_reporter_plugin(&arguments)
            .ok()
            .flatten()
            .map(AgentIntegrationSettings::OpenCode);
        integrated_completion = integration_settings.is_some();
    } else if definition_id == "copilot" && reporter.is_some() {
        // Copilot's repeatable --plugin-dir flag mounts lifecycle hooks only
        // for this child process while preserving the user's home, login,
        // history, permissions, project hooks, and installed plugins.
        if let Ok(plugin) = write_copilot_reporter_plugin() {
            arguments = copilot_reporter_arguments(arguments, &plugin);
            integration_settings = Some(AgentIntegrationSettings::Copilot(plugin));
        }
        // Repository settings may intentionally disable all non-policy hooks.
        // Keep heuristics enabled until the first real hook event arrives.
    } else if definition_id == "hermes" && reporter.is_some() {
        // Hermes has no per-invocation hook flag. Build a temporary overlay of
        // its official bundled plugin tree and add one observer backend there;
        // HERMES_HOME, credentials, user config/plugins, and the workspace are
        // untouched. Safe mode and an unrecognised package layout fall back to
        // conservative terminal heuristics.
        integration_settings = hermes_reporter_plugin(&executable, &arguments)
            .ok()
            .flatten()
            .map(AgentIntegrationSettings::Hermes);
    } else if definition_id == "qwen" && reporter.is_some() {
        // Qwen's system settings override can be scoped to this child process.
        // Keep heuristics enabled until the first hook actually reports: user
        // settings may intentionally disable hooks even when this file loads.
        integration_settings = qwen_reporter_settings_file(&arguments)
            .ok()
            .flatten()
            .map(AgentIntegrationSettings::Qwen);
    }

    let pair = native_pty_system()
        .openpty(size)
        .map_err(|error| format!("Cannot create a local terminal: {error}"))?;
    let (program, prefix_args) = launch_parts(&executable);
    let mut command = CommandBuilder::new(&program);
    for prefix in &prefix_args {
        command.arg(prefix);
    }
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
    if let Some(settings) = integration_settings.as_ref() {
        match settings {
            AgentIntegrationSettings::Copilot(plugin) => {
                // The path is already present in --plugin-dir; retaining and
                // touching the TempDir here documents its launch-time lifetime.
                let _ = plugin.path();
            }
            AgentIntegrationSettings::Gemini(file) => {
                command.env("GEMINI_CLI_SYSTEM_SETTINGS_PATH", file.path());
            }
            AgentIntegrationSettings::Hermes(plugin) => {
                command.env("HERMES_BUNDLED_PLUGINS", plugin.path());
            }
            AgentIntegrationSettings::Qwen(file) => {
                command.env("QWEN_CODE_SYSTEM_SETTINGS_PATH", file.path());
            }
            AgentIntegrationSettings::OpenCode(plugin) => {
                command.env("OPENCODE_CONFIG_CONTENT", &plugin.config_content);
            }
        }
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

    let group_id = request
        .group_id
        .clone()
        .filter(|id| !id.trim().is_empty())
        .unwrap_or_else(|| session_id.clone());
    let group_label = registry
        .group_label(&group_id)
        .unwrap_or_else(|| label.clone());
    let summary = AgentSessionSummary {
        session_id: session_id.clone(),
        group_id,
        group_label,
        definition_id,
        label,
        model: launch_model,
        executable: executable.display().to_string(),
        launch_arguments,
        working_directory: working_directory.display().to_string(),
        state: AgentLifecycle::Working,
        state_source: AgentStateSource::Heuristic,
        process_id,
        token_usage: None,
        // A session launched as a native resume already knows its id; a
        // fresh announcement in the output still overwrites it.
        captured_session_id: request.resume_session_id.clone(),
    };
    let copilot_activity = matches!(
        integration_settings.as_ref(),
        Some(AgentIntegrationSettings::Copilot(_))
    )
    .then(|| Mutex::new(CopilotActivity::default()));
    let hermes_activity = matches!(
        integration_settings.as_ref(),
        Some(AgentIntegrationSettings::Hermes(_))
    )
    .then(|| Mutex::new(HermesActivity::default()));
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
        model_capture: Mutex::new(ModelCaptureState {
            definition_id: summary.definition_id.clone(),
            enabled: true,
            buffer: String::new(),
            scanned_chars: 0,
            input_buffer: String::new(),
            model_command_active: false,
        }),
        output: Mutex::new(OutputBuffer::from_tail(
            restored_output.as_deref().unwrap_or_default(),
        )),
        startup_gate: StartupGate::default(),
        completion_gate: Mutex::new(CompletionReadiness::default()),
        integrated_completion: AtomicBool::new(integrated_completion),
        copilot_activity,
        hermes_activity,
        reported_usage_requests: Mutex::new(ReportedUsageRequests::default()),
        _integration_settings: integration_settings,
    });
    if let Err(error) = registry.insert(&summary, Arc::clone(&entry)) {
        let _ = terminate_agent_entry(entry.as_ref());
        return Err(error);
    }

    if let Some(bytes) = restored_output.as_deref().filter(|bytes| !bytes.is_empty()) {
        let start = bytes.len().saturating_sub(MAX_OUTPUT_SNAPSHOT_BYTES);
        sink.data(&session_id, 0, &bytes[start..]);
    }

    let reader_id = session_id.clone();
    let reader_sink = Arc::clone(&sink);
    let reader_registry = Arc::clone(&registry);
    let reader_entry = Arc::clone(&entry);
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    let bytes = &buffer[..count];
                    reader_entry.startup_gate.observe(bytes);
                    let Ok(offset) = reader_registry.record_output(&reader_id, bytes) else {
                        break;
                    };
                    reader_sink.data(&reader_id, offset, bytes);
                    let state = if let Ok(mut completion) = reader_entry.completion_gate.lock() {
                        heuristic_state_from_output(
                            &mut completion,
                            bytes,
                            reader_entry.integrated_completion.load(Ordering::Acquire),
                        )
                    } else {
                        Some(lifecycle_from_output(bytes))
                    };
                    if let Some(state) = state {
                        if reader_registry.update_state(
                            &reader_id,
                            state,
                            AgentStateSource::Heuristic,
                        ) {
                            reader_sink.state(&reader_id, state, AgentStateSource::Heuristic);
                        }
                    }
                    if let Some(native_id) = reader_registry.scan_for_session_id(&reader_id, bytes)
                    {
                        reader_sink.captured(&reader_id, &native_id);
                    }
                    if let Some(model) = reader_registry.scan_for_model(&reader_id, bytes) {
                        reader_sink.model(&reader_id, &model);
                    }
                }
                Err(_) => break,
            }
        }
    });

    if let Some(seed) = request
        .seed_input
        .clone()
        .filter(|value| !value.trim().is_empty())
    {
        let seed_id = session_id.clone();
        let seed_registry = Arc::clone(&registry);
        let seed_entry = Arc::clone(&entry);
        std::thread::spawn(move || {
            // Each terminal starts at a different speed, especially when the
            // user launches several CLIs together. Wait for this PTY to enable
            // bracketed paste or for its own startup output to settle.
            seed_entry.startup_gate.wait_until_ready(launched_at);
            let payload = startup_seed_payload(&seed);
            if let Ok(entry) = seed_registry.get(&seed_id) {
                if let Ok(mut completion) = entry.completion_gate.lock() {
                    completion.observe_input(&payload);
                }
                if let Ok(mut capture) = entry.model_capture.lock() {
                    capture.input(&payload);
                }
                if let Ok(mut writer) = entry.writer.lock() {
                    let _ = writer.write_all(&payload);
                    let _ = writer.flush();
                }
            }
        });
    }

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
    registry.mark_model_input(session_id, bytes);
    let mut writer = entry.writer.lock().map_err(|error| error.to_string())?;
    writer
        .write_all(bytes)
        .and_then(|_| writer.flush())
        .map_err(|error| format!("Cannot write to the agent terminal: {error}"))?;
    if let Ok(mut completion) = entry.completion_gate.lock() {
        completion.observe_input(bytes);
    }
    let submitted = bytes.iter().any(|byte| matches!(byte, b'\r' | b'\n'));
    if submitted && registry.mark_working_from_input(session_id) {
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
    // Removing a session the registry no longer holds is a success, not a
    // failure: a CLI that already exited has nothing left to stop, and the
    // caller only wants it gone.
    let Ok(entry) = registry.get(session_id) else {
        return Ok(());
    };
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
    use std::time::{Duration, Instant};

    #[derive(Default)]
    struct TestSink {
        data: Mutex<Vec<u8>>,
        session_data: Mutex<HashMap<String, Vec<u8>>>,
        chunks: Mutex<Vec<(String, u64, Vec<u8>)>>,
        states: Mutex<Vec<(String, AgentLifecycle, AgentStateSource)>>,
        closed: Mutex<Vec<String>>,
        captured: Mutex<Vec<(String, String)>>,
        models: Mutex<Vec<(String, String)>>,
        usages: Mutex<Vec<(String, AgentTokenUsage)>>,
    }

    impl AgentSink for TestSink {
        fn data(&self, session_id: &str, offset: u64, bytes: &[u8]) {
            self.data.lock().unwrap().extend_from_slice(bytes);
            self.chunks
                .lock()
                .unwrap()
                .push((session_id.to_string(), offset, bytes.to_vec()));
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

        fn model(&self, session_id: &str, model: &str) {
            self.models
                .lock()
                .unwrap()
                .push((session_id.to_string(), model.to_string()));
        }

        fn usage(&self, session_id: &str, token_usage: &AgentTokenUsage) {
            self.usages
                .lock()
                .unwrap()
                .push((session_id.to_string(), token_usage.clone()));
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
    fn model_capture_requires_cli_status_shaped_output() {
        assert_eq!(
            find_model_name("codex", "│ model: gpt-5.3-codex xhigh │").as_deref(),
            Some("gpt-5.3-codex")
        );
        assert_eq!(
            find_model_name("codex", "gpt-5.6-sol xhigh · ~/project").as_deref(),
            Some("gpt-5.6-sol")
        );
        assert_eq!(
            find_model_name("claude", "Claude Sonnet 4.6 · API Usage Billing").as_deref(),
            Some("Claude Sonnet 4.6")
        );
        assert!(find_model_name("codex", "please review the model layer").is_none());
    }

    #[test]
    fn account_parsers_return_identity_metadata_without_credentials() {
        let claims = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(r#"{"email":"developer@example.com"}"#);
        let codex = codex_account_from_json(
            &serde_json::json!({
                "auth_mode": "chatgpt",
                "tokens": {
                    "id_token": format!("header.{claims}.signature"),
                    "access_token": "must-not-escape"
                }
            })
            .to_string(),
        );
        assert_eq!(codex.state, AgentAccountState::SignedIn);
        assert_eq!(codex.label.as_deref(), Some("developer@example.com"));
        assert_eq!(codex.method.as_deref(), Some("ChatGPT"));
        assert!(!format!("{codex:?}").contains("must-not-escape"));

        let claude = claude_account_from_json(
            r#"{"oauthAccount":{"emailAddress":"claude@example.com"},"token":"secret"}"#,
        );
        assert_eq!(claude.label.as_deref(), Some("claude@example.com"));
        assert_eq!(claude.method.as_deref(), Some("Claude.ai"));

        let gemini =
            gemini_account_from_json(r#"{"active":"gemini@example.com","oauth":"secret"}"#);
        assert_eq!(gemini.label.as_deref(), Some("gemini@example.com"));
        assert_eq!(gemini.method.as_deref(), Some("Google"));
    }

    #[test]
    fn gemini_auth_parser_distinguishes_personal_oauth_from_other_modes() {
        assert_eq!(
            gemini_auth_type_from_json(
                r#"{"security":{"auth":{"selectedType":"oauth-personal"}}}"#,
            )
            .as_deref(),
            Some("oauth-personal")
        );
        assert_eq!(
            gemini_auth_type_from_json(r#"{"selectedAuthType":"gemini-api-key"}"#).as_deref(),
            Some("gemini-api-key")
        );
        assert!(gemini_auth_type_from_json(r#"{"security":{"auth":{}}}"#).is_none());
    }

    #[test]
    fn deprecated_personal_gemini_launches_migrate_without_reusing_native_ids() {
        let request = AgentLaunchRequest {
            definition_id: "gemini".to_string(),
            label: "Gemini CLI".to_string(),
            executable: "gemini".to_string(),
            arguments: vec!["--resume".to_string(), "legacy-session".to_string()],
            resume_session_id: Some("legacy-session".to_string()),
            group_id: Some("google-project".to_string()),
            seed_input: None,
            restore_existing_session: true,
            working_directory: std::env::current_dir().unwrap().display().to_string(),
            cols: 120,
            rows: 32,
        };

        let migrated = migrate_deprecated_google_consumer_request(&request, true).unwrap();
        assert_eq!(migrated.definition_id, "antigravity");
        assert_eq!(migrated.label, "Google Antigravity CLI");
        assert_eq!(migrated.executable, "agy");
        assert!(migrated.arguments.is_empty());
        assert!(migrated.resume_session_id.is_none());
        assert_eq!(migrated.group_id.as_deref(), Some("google-project"));

        let unchanged = migrate_deprecated_google_consumer_request(&request, false).unwrap();
        assert_eq!(unchanged.definition_id, "gemini");
        assert_eq!(
            unchanged.resume_session_id.as_deref(),
            Some("legacy-session")
        );
    }

    #[test]
    fn explicit_gemini_arguments_require_a_manual_antigravity_restart() {
        let request = AgentLaunchRequest {
            definition_id: "gemini".to_string(),
            label: String::new(),
            executable: String::new(),
            arguments: vec!["--model".to_string(), "gemini-2.5-pro".to_string()],
            resume_session_id: None,
            group_id: None,
            seed_input: None,
            restore_existing_session: false,
            working_directory: std::env::current_dir().unwrap().display().to_string(),
            cols: 120,
            rows: 32,
        };

        assert!(migrate_deprecated_google_consumer_request(&request, true)
            .unwrap_err()
            .contains("cannot be migrated safely"));
    }

    #[test]
    fn workspace_instructions_precede_handoffs_but_skip_custom_commands() {
        let mut request = AgentLaunchRequest {
            definition_id: "codex".to_string(),
            label: String::new(),
            executable: String::new(),
            arguments: Vec::new(),
            resume_session_id: None,
            group_id: None,
            seed_input: Some("Continue the previous review.".to_string()),
            restore_existing_session: false,
            working_directory: std::env::current_dir().unwrap().display().to_string(),
            cols: 120,
            rows: 32,
        };
        apply_startup_instructions(&mut request, "Use Traditional Chinese commits.").unwrap();
        assert_eq!(
            request.seed_input.as_deref(),
            Some("Use Traditional Chinese commits.\n\n---\n\nContinue the previous review.")
        );

        request.definition_id = "custom".to_string();
        request.seed_input = None;
        apply_startup_instructions(&mut request, "Never send this to installers.").unwrap();
        assert!(request.seed_input.is_none());

        request.definition_id = "codex".to_string();
        request.restore_existing_session = true;
        apply_startup_instructions(&mut request, "Do not repeat this in resumed work.").unwrap();
        assert!(request.seed_input.is_none());
    }

    #[test]
    fn startup_seed_waits_for_each_terminal_instead_of_a_shared_delay() {
        let started_at = Instant::now();
        let mut fast = StartupReadiness::default();
        let slow = StartupReadiness::default();
        fast.observe(b"loading\x1b[?20", started_at + Duration::from_millis(80));
        let prompt_at = started_at + Duration::from_millis(100);
        fast.observe(b"04h", prompt_at);

        assert!(!fast.should_deliver(
            started_at,
            prompt_at + STARTUP_SEED_PROMPT_SETTLE - Duration::from_millis(1)
        ));
        assert!(fast.should_deliver(started_at, prompt_at + STARTUP_SEED_PROMPT_SETTLE));
        assert!(!slow.should_deliver(started_at, started_at + STARTUP_SEED_MIN_WAIT));

        let mut noisy = StartupReadiness::default();
        let mut prompt_then_screen = b"\x1b[?2004h".to_vec();
        prompt_then_screen.extend(vec![b'x'; STARTUP_CONTROL_WINDOW_BYTES * 2]);
        noisy.observe(&prompt_then_screen, prompt_at);
        assert!(noisy.should_deliver(started_at, prompt_at + STARTUP_SEED_PROMPT_SETTLE));
    }

    #[test]
    fn startup_seed_fallback_requires_output_to_settle() {
        let started_at = Instant::now();
        let mut readiness = StartupReadiness::default();
        let last_output_at = started_at + STARTUP_SEED_MIN_WAIT;
        readiness.observe(b"CLI startup without bracketed paste", last_output_at);

        assert!(!readiness.should_deliver(
            started_at,
            last_output_at + STARTUP_SEED_OUTPUT_QUIET - Duration::from_millis(1)
        ));
        assert!(readiness.should_deliver(started_at, last_output_at + STARTUP_SEED_OUTPUT_QUIET));
    }

    #[test]
    fn startup_seed_payload_preserves_the_full_unicode_prompt() {
        let seed = "請使用繁體中文。\n第二行不可截斷。";
        let payload = startup_seed_payload(seed);
        assert_eq!(
            String::from_utf8(payload).unwrap(),
            format!("\u{1b}[200~{seed}\u{1b}[201~\r")
        );
    }

    #[test]
    fn completion_waits_for_a_submitted_prompt_to_return() {
        let mut readiness = CompletionReadiness::default();

        assert_eq!(readiness.observe_output(b"\x1b[?2004h", false), None);
        readiness.observe_input(b"draft text");
        assert_eq!(readiness.observe_output(b"\x1b[?2004h", false), None);

        readiness.observe_input(b"\r");
        assert_eq!(readiness.observe_output(b"answer\x1b[?20", false), None);
        assert_eq!(
            readiness.observe_output(b"04h", false),
            Some(AgentLifecycle::Done)
        );
        assert_eq!(readiness.observe_output(b"\x1b[?2004h", false), None);
    }

    #[test]
    fn completion_ignores_cursor_visibility_while_the_agent_is_working() {
        let mut readiness = CompletionReadiness::default();

        assert_eq!(readiness.observe_output(b"\x1b[?25h", false), None);
        readiness.observe_input(b"review this\r");
        assert_eq!(readiness.observe_output(b"answer\x1b[?2", false), None);
        assert_eq!(readiness.observe_output(b"5hstill working", false), None);
        assert_eq!(
            readiness.observe_output(b"done\x1b[?2004h", false),
            Some(AgentLifecycle::Done)
        );
    }

    #[test]
    fn integrated_completion_never_falls_back_to_prompt_control_codes() {
        let mut readiness = CompletionReadiness::default();
        readiness.observe_input(b"review this\r");

        assert_eq!(
            heuristic_state_from_output(&mut readiness, b"answer\x1b[?2004h", true),
            None
        );
        assert_eq!(
            heuristic_state_from_output(&mut readiness, "是否允許執行？".as_bytes(), true),
            Some(AgentLifecycle::NeedsAttention)
        );
    }

    #[test]
    fn attention_prompt_cancels_the_pending_completion() {
        let mut readiness = CompletionReadiness::default();
        readiness.observe_input(b"\r");

        assert_eq!(readiness.observe_output(b"permission requ", false), None);
        assert_eq!(
            readiness.observe_output(b"ired\x1b[?2004h", false),
            Some(AgentLifecycle::NeedsAttention)
        );
        assert_eq!(readiness.observe_output(b"\x1b[?2004h", false), None);
    }

    #[test]
    fn explicit_model_arguments_are_available_before_startup_output() {
        assert_eq!(
            model_from_arguments(&["--model".to_string(), "gemini-2.5-pro".to_string()]).as_deref(),
            Some("gemini-2.5-pro")
        );
        assert_eq!(
            model_from_arguments(&["--model=sonnet".to_string()]).as_deref(),
            Some("sonnet")
        );
    }

    #[test]
    fn codex_default_model_is_read_from_the_top_level_config() {
        assert_eq!(
            codex_model_from_config(
                r#"
model = "gpt-5.6-sol"
model_reasoning_effort = "high"

[profiles.review]
model = "gpt-5.3-codex"
"#,
            )
            .as_deref(),
            Some("gpt-5.6-sol")
        );
    }

    #[test]
    fn codex_profile_model_is_not_reported_as_the_default() {
        assert!(codex_model_from_config(
            r#"
[profiles.review]
model = "gpt-5.3-codex"
"#,
        )
        .is_none());
    }

    #[test]
    fn model_command_rearms_capture_when_typed_in_separate_events() {
        let mut capture = ModelCaptureState {
            definition_id: "codex".to_string(),
            enabled: true,
            buffer: String::new(),
            scanned_chars: 0,
            input_buffer: String::new(),
            model_command_active: false,
        };
        capture.input(b"hello");
        assert!(!capture.enabled);
        capture.input(b"\r");
        for byte in b"/model\r" {
            capture.input(&[*byte]);
        }
        assert!(capture.enabled);
        assert_eq!(
            capture.feed(b"gpt-5.6-sol xhigh").as_deref(),
            Some("gpt-5.6-sol")
        );
        // The picker may still be open; the watch survives the first match.
        assert!(capture.model_command_active);
        assert!(capture.enabled);
    }

    #[test]
    fn model_picker_keeps_watching_until_the_next_real_command() {
        let mut capture = ModelCaptureState {
            definition_id: "codex".to_string(),
            enabled: false,
            buffer: String::new(),
            scanned_chars: 0,
            input_buffer: String::new(),
            model_command_active: false,
        };
        for byte in b"/model\r" {
            capture.input(&[*byte]);
        }
        // The menu redraw shows the current model first...
        assert_eq!(
            capture.feed(b"model: gpt-5.6-sol").as_deref(),
            Some("gpt-5.6-sol")
        );
        // ...arrow keys and a bare Enter pick another entry...
        capture.input(b"\x1b[B");
        capture.input(b"\r");
        assert!(capture.enabled);
        // ...and the confirmation redraw carries the real choice.
        assert_eq!(
            capture.feed(b"model: gpt-5.6-max").as_deref(),
            Some("gpt-5.6-max")
        );
        // The next ordinary command ends the watch for good.
        for byte in b"run the tests\r" {
            capture.input(&[*byte]);
        }
        assert!(!capture.enabled);
        assert!(!capture.model_command_active);
        assert_eq!(capture.feed(b"model: gpt-9.9-fake"), None);
    }

    #[cfg(windows)]
    #[test]
    fn working_directories_lose_the_verbatim_prefix() {
        assert_eq!(
            plain_win32_path(PathBuf::from(r"\\?\D:\project\demo")),
            PathBuf::from(r"D:\project\demo")
        );
        assert_eq!(
            plain_win32_path(PathBuf::from(r"\\?\UNC\nas\share")),
            PathBuf::from(r"\\nas\share")
        );
    }

    #[test]
    fn terminal_protocol_replies_do_not_cancel_startup_model_capture() {
        let mut capture = ModelCaptureState {
            definition_id: "codex".to_string(),
            enabled: true,
            buffer: String::new(),
            scanned_chars: 0,
            input_buffer: String::new(),
            model_command_active: false,
        };

        // xterm emits these through onData while a full-screen TUI starts.
        capture.input(b"\x1b[?1;2c");
        capture.input(b"\x1b[24;1R");
        capture.input(b"\x1b[I");
        assert!(capture.enabled);
        assert_eq!(
            capture
                .feed(b"\x1b[2m model: \x1b[0mgpt-5.6-sol xhigh")
                .as_deref(),
            Some("gpt-5.6-sol")
        );
    }

    #[test]
    fn catalog_ids_are_unique() {
        let ids: HashSet<_> = AGENTS.iter().map(|agent| agent.id).collect();
        assert_eq!(ids.len(), AGENTS.len());
        assert!(ids.contains("codex"));
        assert!(ids.contains("hermes"));
    }

    #[test]
    fn every_missing_cli_has_a_reviewable_install_path() {
        for definition in catalog() {
            assert!(
                definition.install.source_url.starts_with("https://"),
                "{} needs an HTTPS installation source",
                definition.id
            );
            assert!(
                !definition.install.display_command.is_empty(),
                "{} needs a visible installation command",
                definition.id
            );
            if definition.install.executable.is_some() {
                assert!(
                    !definition.install.arguments.is_empty(),
                    "{} direct installer needs an argument vector",
                    definition.id
                );
            }
        }
    }

    #[test]
    fn native_resume_adapters_use_the_verified_cli_argument_shape() {
        for (definition_id, expected) in [
            ("codex", vec!["resume", "session-42"]),
            ("claude", vec!["--resume", "session-42"]),
            ("gemini", vec!["--resume", "session-42"]),
            ("hermes", vec!["--resume", "session-42"]),
            ("cursor", vec!["--resume", "session-42"]),
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
            HashSet::from(["codex", "claude", "gemini", "hermes", "cursor"])
        );
        let latest_supported: HashSet<_> = definitions
            .iter()
            .filter(|definition| definition.resume_latest_supported)
            .map(|definition| definition.id.as_str())
            .collect();
        assert_eq!(
            latest_supported,
            HashSet::from(["codex", "antigravity", "cursor"])
        );
        assert_eq!(
            AGENTS[0].resume_latest_recipe.unwrap().arguments(),
            vec!["resume", "--last"]
        );
        let antigravity = AGENTS
            .iter()
            .find(|agent| agent.id == "antigravity")
            .unwrap();
        assert_eq!(
            antigravity.resume_latest_recipe.unwrap().arguments(),
            vec!["--continue"]
        );
        let cursor = AGENTS.iter().find(|agent| agent.id == "cursor").unwrap();
        assert_eq!(
            cursor.resume_latest_recipe.unwrap().arguments(),
            vec!["--continue"]
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
    #[ignore = "depends on the host having claude installed on PATH"]
    fn claude_is_detected_on_this_host() {
        let claude = catalog()
            .into_iter()
            .find(|agent| agent.id == "claude")
            .expect("claude is in the catalog");
        println!("claude installed_path = {:?}", claude.installed_path);
        assert!(claude.installed, "claude should be detected on PATH");
    }

    #[test]
    #[ignore = "spawns the real claude CLI; run manually on a host that has it"]
    fn claude_shim_launches_via_launch_parts() {
        // Proves the resolved .cmd shim runs when driven through launch_parts.
        // Uses a plain captured process (the PTY layer is portable_pty's job).
        let executable = find_executable("claude").expect("claude on PATH");
        let (program, prefix_args) = launch_parts(&executable);

        let mut command = std::process::Command::new(&program);
        command.args(&prefix_args);
        command.arg("--version");
        let output = command.output().expect("run claude --version");

        let text = String::from_utf8_lossy(&output.stdout);
        println!("program={program:?} prefix={prefix_args:?} -> {text}");
        assert!(
            output.status.success() && text.chars().any(|character| character.is_ascii_digit()),
            "expected a version string, got status={:?} out={text:?}",
            output.status
        );
    }

    #[test]
    #[ignore = "spawns the real Hermes CLI and uses the configured inference provider"]
    fn hermes_official_hooks_report_a_real_oneshot_completion() {
        let collector = Arc::new(TestSink::default());
        let sink: Arc<dyn AgentSink> = collector.clone();
        let test_executable = std::env::current_exe().unwrap();
        let debug_directory = test_executable
            .parent()
            .and_then(Path::parent)
            .expect("unit test binary should live under target/debug/deps");
        #[cfg(windows)]
        let reporter_executable = debug_directory.join("lattice-term.exe");
        #[cfg(not(windows))]
        let reporter_executable = debug_directory.join("lattice-term");
        assert!(
            reporter_executable.is_file(),
            "build the real reporter first with `cargo build --bin lattice-term`"
        );
        let registry =
            AgentRegistry::with_local_reporter_executable(sink.clone(), reporter_executable)
                .unwrap();
        let request = AgentLaunchRequest {
            definition_id: "hermes".to_string(),
            label: "Hermes lifecycle probe".to_string(),
            executable: String::new(),
            arguments: vec![
                "--oneshot".to_string(),
                "Reply with exactly LATTICETERM_HERMES_OK and no other text.".to_string(),
                "--ignore-rules".to_string(),
            ],
            resume_session_id: None,
            group_id: None,
            seed_input: None,
            restore_existing_session: false,
            working_directory: std::env::current_dir().unwrap().display().to_string(),
            cols: 100,
            rows: 30,
        };
        let session = launch(sink.clone(), registry.clone(), request).unwrap();

        let deadline = Instant::now() + Duration::from_secs(180);
        while Instant::now() < deadline {
            let done =
                collector
                    .states
                    .lock()
                    .unwrap()
                    .iter()
                    .any(|(session_id, state, source)| {
                        session_id == &session.session_id
                            && *state == AgentLifecycle::Done
                            && *source == AgentStateSource::Integration
                    });
            let output = collector.data.lock().unwrap();
            let answered = String::from_utf8_lossy(&output).contains("LATTICETERM_HERMES_OK");
            drop(output);
            let closed = !collector.closed.lock().unwrap().is_empty();
            let usage_reported = !collector.usages.lock().unwrap().is_empty();
            if (done && answered && usage_reported) || closed {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }

        let states = collector.states.lock().unwrap();
        let integrated_done = states.iter().any(|(session_id, state, source)| {
            session_id == &session.session_id
                && *state == AgentLifecycle::Done
                && *source == AgentStateSource::Integration
        });
        let observed_states = states.clone();
        drop(states);
        let output = String::from_utf8_lossy(&collector.data.lock().unwrap()).to_string();
        let closed = collector.closed.lock().unwrap().clone();
        let observed_usage = collector.usages.lock().unwrap().clone();
        let latest_usage = observed_usage.last().map(|(_, usage)| usage);
        assert!(
            integrated_done
                && output.contains("LATTICETERM_HERMES_OK")
                && latest_usage.is_some_and(|usage| {
                    usage.api_calls > 0 && usage.total_tokens > 0
                }),
            "states={observed_states:?} usage={observed_usage:?} closed={closed:?} output={output:?}"
        );
        disconnect(sink.as_ref(), registry.as_ref(), &session.session_id).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn detects_and_wraps_windows_script_shims() {
        // npm/pnpm global installs land as .cmd shims (e.g. claude.cmd).
        let dir = tempfile::tempdir().unwrap();
        let shim = dir.path().join("faux-agent.cmd");
        std::fs::write(&shim, "@echo off\r\n").unwrap();

        assert!(is_executable(&shim), ".cmd shims must count as executable");

        let (program, prefix) = launch_parts(&shim);
        assert!(
            program
                .to_string_lossy()
                .to_ascii_lowercase()
                .contains("cmd"),
            "a .cmd shim must launch through the command processor"
        );
        assert_eq!(
            prefix.first().map(|arg| arg.to_string_lossy().to_string()),
            Some("/c".to_string())
        );

        // A real .exe launches directly, with no wrapper.
        let exe = dir.path().join("faux-agent.exe");
        std::fs::write(&exe, "MZ").unwrap();
        let (exe_program, exe_prefix) = launch_parts(&exe);
        assert_eq!(exe_program, exe.as_os_str());
        assert!(exe_prefix.is_empty());

        let canonical_exe = exe.canonicalize().unwrap();
        let (canonical_program, canonical_prefix) = launch_parts(&canonical_exe);
        assert_eq!(canonical_program, exe.as_os_str());
        assert!(canonical_prefix.is_empty());

        assert_eq!(
            plain_windows_path(Path::new(r"\\?\UNC\server\share\agent.exe")),
            OsString::from(r"\\server\share\agent.exe")
        );

        assert_eq!(
            well_known_agent_path("antigravity", Path::new(r"C:\Users\dev\AppData\Local")),
            Some(PathBuf::from(r"C:\Users\dev\AppData\Local\agy\bin\agy.exe"))
        );
        assert!(well_known_agent_path("custom", Path::new(r"C:\Temp")).is_none());
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
                note: "  審查 payments 專案  ".to_string(),
                working_directory: directory.display().to_string(),
            },
        )
        .unwrap();
        assert_eq!(plan.executable, "codex");
        // The note is trimmed and preserved for the saved list.
        assert_eq!(plan.note, "審查 payments 專案");
        assert_eq!(
            PathBuf::from(&plan.working_directory),
            plain_win32_path(directory.canonicalize().unwrap())
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
                    note: String::new(),
                    working_directory: directory.display().to_string(),
                },
            )
            .unwrap_err();
            assert!(error.contains("cannot contain"));
        }
    }

    #[test]
    fn plan_notes_reject_oversized_or_control_characters() {
        let directory = std::env::current_dir().unwrap();
        let make = |note: &str| {
            normalize_launch_plan(
                "agent-plan-note".to_string(),
                AgentLaunchPlanDraft {
                    definition_id: "codex".to_string(),
                    label: "Agent".to_string(),
                    executable: String::new(),
                    arguments: Vec::new(),
                    resume_session_id: None,
                    note: note.to_string(),
                    working_directory: directory.display().to_string(),
                },
            )
        };
        // Empty is allowed and normalises to "".
        assert_eq!(make("").unwrap().note, "");
        assert!(make(&"x".repeat(MAX_PLAN_NOTE_BYTES + 1)).is_err());
        assert!(make("line one\nline two").is_err());
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
                note: String::new(),
                working_directory: directory.display().to_string(),
            },
        )
        .unwrap();
        assert_eq!(plan.resume_session_id.as_deref(), Some("session-42"));

        let request = launch_request_from_plan(&plan, 80, 24).unwrap();
        assert_eq!(request.resume_session_id.as_deref(), Some("session-42"));
        assert!(request.arguments.is_empty());
        assert!(request.restore_existing_session);
    }

    #[test]
    fn saved_sessions_resume_latest_only_for_verified_cli_adapters() {
        let directory = std::env::current_dir().unwrap();
        let plan = normalize_launch_plan(
            "agent-plan-latest-codex".to_string(),
            AgentLaunchPlanDraft {
                definition_id: "codex".to_string(),
                label: String::new(),
                executable: String::new(),
                arguments: Vec::new(),
                resume_session_id: None,
                note: String::new(),
                working_directory: directory.display().to_string(),
            },
        )
        .unwrap();

        let request = launch_request_from_plan(&plan, 80, 24).unwrap();
        assert_eq!(request.arguments, vec!["resume", "--last"]);
        assert!(request.resume_session_id.is_none());
        assert!(request.restore_existing_session);

        let antigravity = normalize_launch_plan(
            "agent-plan-latest-antigravity".to_string(),
            AgentLaunchPlanDraft {
                definition_id: "antigravity".to_string(),
                label: String::new(),
                executable: String::new(),
                arguments: Vec::new(),
                resume_session_id: None,
                note: String::new(),
                working_directory: directory.display().to_string(),
            },
        )
        .unwrap();
        let antigravity_request = launch_request_from_plan(&antigravity, 80, 24).unwrap();
        assert_eq!(antigravity_request.arguments, vec!["--continue"]);
        assert!(antigravity_request.restore_existing_session);

        let cursor = normalize_launch_plan(
            "agent-plan-latest-cursor".to_string(),
            AgentLaunchPlanDraft {
                definition_id: "cursor".to_string(),
                label: String::new(),
                executable: String::new(),
                arguments: Vec::new(),
                resume_session_id: None,
                note: String::new(),
                working_directory: directory.display().to_string(),
            },
        )
        .unwrap();
        let cursor_request = launch_request_from_plan(&cursor, 80, 24).unwrap();
        assert_eq!(cursor_request.arguments, vec!["--continue"]);
        assert!(cursor_request.restore_existing_session);

        let hermes = normalize_launch_plan(
            "agent-plan-fresh-hermes".to_string(),
            AgentLaunchPlanDraft {
                definition_id: "hermes".to_string(),
                label: String::new(),
                executable: String::new(),
                arguments: Vec::new(),
                resume_session_id: None,
                note: String::new(),
                working_directory: directory.display().to_string(),
            },
        )
        .unwrap();
        let hermes_request = launch_request_from_plan(&hermes, 80, 24).unwrap();
        assert!(hermes_request.arguments.is_empty());
        assert!(!hermes_request.restore_existing_session);
    }

    #[test]
    fn rename_validates_label_and_requires_an_existing_session() {
        let registry = AgentRegistry::new();
        // Empty/blank labels are rejected before any lookup.
        assert!(registry.rename("agent-session-1", "   ").is_err());
        assert!(registry.rename("agent-session-1", &"x".repeat(81)).is_err());
        // A valid label still fails when the session does not exist.
        assert!(registry.rename("missing", "payments 重構").is_err());
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
    fn codex_completion_requires_the_documented_notification_type() {
        assert!(is_codex_turn_complete_notification(OsStr::new(
            r#"{"type":"agent-turn-complete","turn-id":"turn-1"}"#,
        )));
        assert!(!is_codex_turn_complete_notification(OsStr::new(
            r#"{"type":"tool-complete"}"#,
        )));
        assert!(!is_codex_turn_complete_notification(OsStr::new("not-json")));
        assert_eq!(
            run_reporter_cli(["agent-notify", "", r#"{"type":"tool-complete"}"#]),
            Some(0),
        );
        assert_eq!(run_reporter_cli(["agent-notify", ""]), Some(2));
    }

    #[test]
    fn codex_notify_config_is_parsed_with_conservative_limits() {
        assert_eq!(
            codex_notify_command_from_config(
                r#"model = "gpt-5"
notify = ["notify.exe", "turn-ended"]"#,
            ),
            Some(vec!["notify.exe".to_string(), "turn-ended".to_string()])
        );
        assert_eq!(codex_notify_command_from_config("notify = []"), None);
        assert_eq!(
            codex_notify_command_from_config("notify = [\"ok\", 1]"),
            None
        );
        assert_eq!(
            codex_notify_command_from_config("notify = [\"bad\\ncommand\"]"),
            None
        );
    }

    #[test]
    fn codex_reporter_preserves_the_existing_notify_command() {
        let original = vec!["notify.exe".to_string(), "turn-ended".to_string()];
        let arguments = codex_reporter_arguments_with_forward(
            vec!["--model".to_string(), "gpt-5".to_string()],
            Path::new(r"C:\Program Files\LatticeTerm\lattice-term.exe"),
            Some(original.clone()),
        );

        assert_eq!(arguments[0], "-c");
        let encoded_command = arguments[1].strip_prefix("notify=").unwrap();
        let command: Vec<String> = serde_json::from_str(encoded_command).unwrap();
        assert_eq!(command[1], "agent-notify");
        assert_eq!(decode_forward_notify(&command[2]), Some(original));
        assert_eq!(&arguments[2..], &["--model", "gpt-5"]);
    }

    #[test]
    fn codex_reporter_respects_an_explicit_launch_override() {
        let arguments = vec!["-c".to_string(), "notify=[\"custom.exe\"]".to_string()];
        assert_eq!(
            codex_reporter_arguments_with_forward(
                arguments.clone(),
                Path::new("lattice-term"),
                None,
            ),
            arguments
        );
    }

    #[test]
    fn claude_reporter_uses_exec_hooks_without_replacing_user_files() {
        let arguments = claude_reporter_arguments(
            vec!["--model".to_string(), "sonnet".to_string()],
            Path::new(r"C:\Program Files\LatticeTerm\lattice-term.exe"),
        );
        assert_eq!(arguments[0], "--settings");
        let settings: serde_json::Value = serde_json::from_str(&arguments[1]).unwrap();
        let stop = &settings["hooks"]["Stop"][0]["hooks"][0];
        assert_eq!(stop["type"], "command");
        assert_eq!(
            stop["command"],
            r"C:\Program Files\LatticeTerm\lattice-term.exe"
        );
        assert_eq!(stop["args"], serde_json::json!(["agent-claude-hook"]));
        assert_eq!(&arguments[2..], &["--model", "sonnet"]);

        let explicit = vec!["--settings=/tmp/claude.json".to_string()];
        assert_eq!(
            claude_reporter_arguments(explicit.clone(), Path::new("lattice-term")),
            explicit
        );
    }

    #[test]
    fn claude_hooks_distinguish_done_background_work_and_attention() {
        let state = |payload: &str| lifecycle_from_claude_hook_payload(payload.as_bytes()).unwrap();
        assert_eq!(
            state(r#"{"hook_event_name":"UserPromptSubmit"}"#),
            Some(AgentLifecycle::Working)
        );
        assert_eq!(
            state(r#"{"hook_event_name":"Stop","background_tasks":[],"session_crons":[]}"#),
            Some(AgentLifecycle::Done)
        );
        assert_eq!(
            state(r#"{"hook_event_name":"Stop","background_tasks":[{"status":"running"}]}"#),
            Some(AgentLifecycle::Working)
        );
        assert_eq!(
            state(r#"{"hook_event_name":"Stop","session_crons":[{"id":"cron-1"}]}"#),
            Some(AgentLifecycle::Idle)
        );
        assert_eq!(
            state(r#"{"hook_event_name":"StopFailure","error":"rate_limit"}"#),
            Some(AgentLifecycle::NeedsAttention)
        );
        assert_eq!(
            state(r#"{"hook_event_name":"Notification","notification_type":"permission_prompt"}"#),
            Some(AgentLifecycle::NeedsAttention)
        );
        assert_eq!(
            state(r#"{"hook_event_name":"Notification","notification_type":"idle_prompt"}"#),
            None
        );
        assert!(lifecycle_from_claude_hook_payload(b"not-json").is_err());
    }

    #[test]
    fn gemini_reporter_uses_process_scoped_lifecycle_hooks() {
        let settings = gemini_reporter_settings_value();
        let before = &settings["hooks"]["BeforeAgent"][0]["hooks"][0];
        let after = &settings["hooks"]["AfterAgent"][0]["hooks"][0];
        let permission = &settings["hooks"]["Notification"][0];

        assert_eq!(before["name"], "latticeterm-agent-status");
        assert_eq!(before["type"], "command");
        assert_eq!(before["command"], GEMINI_REPORTER_COMMAND);
        assert_eq!(before, after);
        assert_eq!(permission["matcher"], "ToolPermission");
        assert_eq!(permission["hooks"][0], *before);
        assert!(settings.get("hooksConfig").is_none());
    }

    #[test]
    fn gemini_hooks_distinguish_work_done_and_permission() {
        let state = |payload: &str| lifecycle_from_gemini_hook_payload(payload.as_bytes()).unwrap();
        assert_eq!(
            state(r#"{"hook_event_name":"BeforeAgent"}"#),
            Some(AgentLifecycle::Working)
        );
        assert_eq!(
            state(r#"{"hook_event_name":"AfterAgent"}"#),
            Some(AgentLifecycle::Done)
        );
        assert_eq!(
            state(r#"{"hook_event_name":"Notification","notification_type":"ToolPermission"}"#),
            Some(AgentLifecycle::NeedsAttention)
        );
        assert_eq!(
            state(r#"{"hook_event_name":"Notification","notification_type":"Info"}"#),
            None
        );
        assert!(lifecycle_from_gemini_hook_payload(b"not-json").is_err());
    }

    #[test]
    fn qwen_reporter_uses_process_scoped_lifecycle_hooks() {
        let settings = qwen_reporter_settings_value();
        let submitted = &settings["hooks"]["UserPromptSubmit"][0]["hooks"][0];
        let stop = &settings["hooks"]["Stop"][0]["hooks"][0];
        let permission = &settings["hooks"]["Notification"][0];

        assert_eq!(submitted["name"], "latticeterm-agent-status");
        assert_eq!(submitted["type"], "command");
        assert_eq!(submitted["command"], QWEN_REPORTER_COMMAND);
        assert_eq!(submitted, stop);
        assert_eq!(permission["matcher"], "permission_prompt");
        assert_eq!(permission["hooks"][0], *submitted);
        assert!(settings.get("disableAllHooks").is_none());
        assert!(qwen_reporter_allowed(&[]));
        assert!(!qwen_reporter_allowed(&["--safe-mode".to_string()]));
        assert!(!qwen_reporter_allowed(&["--bare=true".to_string()]));
        assert!(qwen_reporter_allowed(&["--safe-mode=false".to_string()]));
    }

    #[test]
    fn qwen_hooks_distinguish_work_done_failure_and_permission() {
        let state = |payload: &str| lifecycle_from_qwen_hook_payload(payload.as_bytes()).unwrap();
        assert_eq!(
            state(r#"{"hook_event_name":"UserPromptSubmit"}"#),
            Some(AgentLifecycle::Working)
        );
        assert_eq!(
            state(r#"{"hook_event_name":"Stop"}"#),
            Some(AgentLifecycle::Done)
        );
        assert_eq!(
            state(r#"{"hook_event_name":"Stop","background_tasks":[{"status":"running"}]}"#),
            Some(AgentLifecycle::Working)
        );
        assert_eq!(
            state(r#"{"hook_event_name":"Stop","crons":[{"id":"cron-1"}]}"#),
            Some(AgentLifecycle::Idle)
        );
        assert_eq!(
            state(r#"{"hook_event_name":"StopFailure","error":"rate_limit"}"#),
            Some(AgentLifecycle::NeedsAttention)
        );
        assert_eq!(
            state(r#"{"hook_event_name":"PermissionRequest"}"#),
            Some(AgentLifecycle::NeedsAttention)
        );
        assert_eq!(
            state(r#"{"hook_event_name":"PermissionDenied"}"#),
            Some(AgentLifecycle::Working)
        );
        assert_eq!(
            state(r#"{"hook_event_name":"Notification","notification_type":"permission_prompt"}"#),
            Some(AgentLifecycle::NeedsAttention)
        );
        assert_eq!(
            state(r#"{"hook_event_name":"Notification","notification_type":"idle_prompt"}"#),
            None
        );
        assert!(lifecycle_from_qwen_hook_payload(b"not-json").is_err());
    }

    #[test]
    fn hermes_reporter_uses_a_process_scoped_bundled_plugin_overlay() {
        let source = tempfile::tempdir().unwrap();
        let provider = source.path().join("model-providers").join("mock");
        std::fs::create_dir_all(&provider).unwrap();
        std::fs::write(
            provider.join("plugin.yaml"),
            "name: mock\nkind: model-provider\n",
        )
        .unwrap();

        let plugin = write_hermes_reporter_plugin_from_bundle(source.path()).unwrap();
        assert!(plugin
            .path()
            .join("model-providers/mock/plugin.yaml")
            .is_file());
        let bridge = plugin.path().join(HERMES_REPORTER_PLUGIN_NAME);
        let manifest = std::fs::read_to_string(bridge.join("plugin.yaml")).unwrap();
        let observer = std::fs::read_to_string(bridge.join("__init__.py")).unwrap();
        assert!(manifest.contains("kind: backend"));
        assert!(manifest.contains("on_session_end"));
        assert!(manifest.contains("post_api_request"));
        assert!(observer.contains("agent-hermes-hook"));
        assert!(observer.contains("child_session_id"));
        assert!(observer.contains("_USAGE_FIELDS"));
        assert!(!observer.contains("user_message"));
        assert!(!observer.contains("assistant_message"));
        assert!(!source.path().join(HERMES_REPORTER_PLUGIN_NAME).exists());
    }

    #[test]
    fn hermes_hooks_forward_only_valid_lifecycle_events() {
        let action = |payload: &str| {
            hermes_event_from_hook_payload(payload.as_bytes())
                .unwrap()
                .action
        };
        assert_eq!(
            action(r#"{"hook_event_name":"on_session_start","session_id":"main"}"#),
            HermesReporterAction::SessionStarted
        );
        assert_eq!(
            action(r#"{"hook_event_name":"pre_llm_call","session_id":"main"}"#),
            HermesReporterAction::TurnStarted
        );
        assert_eq!(
            action(
                r#"{"hook_event_name":"on_session_end","session_id":"main","completed":true,"failed":false,"interrupted":false}"#
            ),
            HermesReporterAction::TurnEnded {
                completed: true,
                failed: false,
                interrupted: false
            }
        );
        assert_eq!(
            action(
                r#"{"hook_event_name":"subagent_start","parent_session_id":"main","child_session_id":"child"}"#
            ),
            HermesReporterAction::SubagentStarted {
                child_session_id: "child".to_string()
            }
        );
        assert_eq!(
            action(r#"{"hook_event_name":"pre_approval_request"}"#),
            HermesReporterAction::NeedsAttention
        );
        assert!(hermes_event_from_hook_payload(
            br#"{"hook_event_name":"subagent_stop","parent_session_id":"main"}"#
        )
        .is_err());
        assert!(hermes_event_from_hook_payload(
            br#"{"hook_event_name":"pre_llm_call","session_id":"bad\nvalue"}"#
        )
        .is_err());
        let oversized = serde_json::json!({
            "hook_event_name": "pre_llm_call",
            "session_id": "x".repeat(MAX_RESUME_SESSION_ID_BYTES + 1)
        });
        assert!(hermes_event_from_hook_payload(oversized.to_string().as_bytes()).is_err());
        assert!(hermes_event_from_hook_payload(br#"{"hook_event_name":"unknown"}"#).is_err());
        assert!(hermes_event_from_hook_payload(b"not-json").is_err());

        let usage = hermes_usage_from_hook_payload(
            br#"{"hook_event_name":"post_api_request","session_id":"child","api_request_id":"turn-1:api:2","usage":{"input_tokens":120,"output_tokens":30,"cache_read_tokens":40,"cache_write_tokens":5,"reasoning_tokens":12}}"#,
        )
        .unwrap();
        assert_eq!(usage.source_session_id, "child");
        assert_eq!(usage.request_id, "turn-1:api:2");
        assert_eq!(usage.total_tokens(), 195);
        assert_eq!(usage.reasoning_tokens, 12);
        assert!(hermes_usage_from_hook_payload(
            br#"{"hook_event_name":"post_api_request","session_id":"main","api_request_id":"turn-1:api:1"}"#
        )
        .is_err());
        assert!(hermes_usage_from_hook_payload(
            format!(
                r#"{{"hook_event_name":"post_api_request","session_id":"main","api_request_id":"turn-1:api:1","usage":{{"input_tokens":{}}}}}"#,
                MAX_REPORTED_TOKENS_PER_REQUEST + 1
            )
            .as_bytes()
        )
        .is_err());
    }

    #[test]
    fn reported_usage_totals_stay_exact_for_webview_numbers() {
        let mut totals = AgentTokenUsage {
            input_tokens: MAX_SERIALIZED_USAGE_VALUE - 1,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            reasoning_tokens: 0,
            total_tokens: MAX_SERIALIZED_USAGE_VALUE - 1,
            api_calls: MAX_SERIALIZED_USAGE_VALUE,
        };
        totals.add_report(&AgentUsageReport {
            source_session_id: "main".to_string(),
            request_id: "turn-1:api:1".to_string(),
            input_tokens: 10,
            output_tokens: 2,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            reasoning_tokens: 1,
        });
        assert_eq!(totals.input_tokens, MAX_SERIALIZED_USAGE_VALUE);
        assert_eq!(totals.total_tokens, MAX_SERIALIZED_USAGE_VALUE);
        assert_eq!(totals.api_calls, MAX_SERIALIZED_USAGE_VALUE);
    }

    #[test]
    fn hermes_child_completion_never_finishes_the_main_turn() {
        let mut activity = HermesActivity::default();
        let event = |source: &str, action| HermesReporterEvent {
            source_session_id: source.to_string(),
            action,
        };

        assert_eq!(
            activity.apply(&event("main", HermesReporterAction::SessionStarted)),
            Some(AgentLifecycle::Working)
        );
        assert_eq!(
            activity.apply(&event(
                "main",
                HermesReporterAction::SubagentStarted {
                    child_session_id: "child".to_string()
                }
            )),
            Some(AgentLifecycle::Working)
        );
        assert_eq!(
            activity.apply(&event("child", HermesReporterAction::SessionStarted)),
            None
        );
        assert_eq!(
            activity.apply(&event(
                "child",
                HermesReporterAction::TurnEnded {
                    completed: true,
                    failed: false,
                    interrupted: false
                }
            )),
            None
        );
        assert_eq!(
            activity.apply(&event(
                "main",
                HermesReporterAction::TurnEnded {
                    completed: true,
                    failed: false,
                    interrupted: false
                }
            )),
            Some(AgentLifecycle::Working)
        );
        assert_eq!(
            activity.apply(&event(
                "main",
                HermesReporterAction::SubagentStopped {
                    child_session_id: "child".to_string()
                }
            )),
            Some(AgentLifecycle::Done)
        );

        assert_eq!(
            activity.apply(&event("main", HermesReporterAction::TurnStarted)),
            Some(AgentLifecycle::Working)
        );
        assert_eq!(
            activity.apply(&event(
                "main",
                HermesReporterAction::TurnEnded {
                    completed: false,
                    failed: true,
                    interrupted: false
                }
            )),
            Some(AgentLifecycle::NeedsAttention)
        );
    }

    #[test]
    fn copilot_plugin_is_process_scoped_without_replacing_user_config() {
        let hooks = copilot_reporter_hooks_value();
        let submitted = &hooks["hooks"]["userPromptSubmitted"][0];
        let stop = &hooks["hooks"]["agentStop"][0];
        let notification = &hooks["hooks"]["notification"][0];

        assert_eq!(hooks["version"], 1);
        assert_eq!(submitted["type"], "command");
        assert!(submitted["bash"]
            .as_str()
            .unwrap()
            .ends_with("agent-copilot-hook userPromptSubmitted"));
        assert!(submitted["powershell"]
            .as_str()
            .unwrap()
            .ends_with("agent-copilot-hook userPromptSubmitted"));
        assert!(stop["bash"]
            .as_str()
            .unwrap()
            .ends_with("agent-copilot-hook agentStop"));
        assert_eq!(
            notification["matcher"],
            "permission_prompt|elicitation_dialog|agent_completed|agent_idle"
        );
        assert!(hooks.get("disableAllHooks").is_none());

        let plugin = write_copilot_reporter_plugin().unwrap();
        let manifest: serde_json::Value =
            serde_json::from_slice(&std::fs::read(plugin.path().join("plugin.json")).unwrap())
                .unwrap();
        let written_hooks: serde_json::Value =
            serde_json::from_slice(&std::fs::read(plugin.path().join("hooks.json")).unwrap())
                .unwrap();
        assert_eq!(manifest["name"], "latticeterm-agent-status");
        assert_eq!(manifest["hooks"], "hooks.json");
        assert_eq!(written_hooks, hooks);

        let arguments = copilot_reporter_arguments(vec!["--model=auto".to_string()], &plugin);
        assert_eq!(arguments[0], "--plugin-dir");
        assert_eq!(arguments[1], plugin.path().display().to_string());
        assert_eq!(arguments[2], "--model=auto");
    }

    #[test]
    fn copilot_hooks_distinguish_work_stop_attention_errors_and_subagents() {
        let event = |name: &str, payload: &str| {
            let mut payload: serde_json::Value = serde_json::from_str(payload).unwrap();
            payload["sessionId"] = serde_json::json!("main-session");
            copilot_event_from_hook_payload(name, payload.to_string().as_bytes())
                .unwrap()
                .map(|event| event.action)
        };
        assert_eq!(
            event("userPromptSubmitted", "{}"),
            Some(CopilotReporterAction::TurnStarted)
        );
        assert_eq!(
            event("sessionStart", "{}"),
            Some(CopilotReporterAction::SessionStarted)
        );
        assert_eq!(event("agentStop", "{}"), Some(CopilotReporterAction::Stop));
        assert_eq!(
            event("permissionRequest", "{}"),
            Some(CopilotReporterAction::NeedsAttention)
        );
        assert_eq!(
            event("errorOccurred", r#"{"recoverable":true}"#),
            Some(CopilotReporterAction::RecoverableError)
        );
        assert_eq!(
            event("errorOccurred", r#"{"recoverable":false}"#),
            Some(CopilotReporterAction::FatalError)
        );
        assert_eq!(
            event(
                "postToolUse",
                r#"{"toolName":"task","toolArgs":{"mode":"background"}}"#
            ),
            Some(CopilotReporterAction::BackgroundSubagentQueued)
        );
        assert_eq!(
            event(
                "notification",
                r#"{"notification_type":"permission_prompt"}"#
            ),
            Some(CopilotReporterAction::NeedsAttention)
        );
        assert_eq!(
            event("notification", r#"{"notificationType":"agent_idle"}"#),
            Some(CopilotReporterAction::BackgroundIdle)
        );
        assert_eq!(
            event("notification", r#"{"notificationType":"shell_completed"}"#),
            None
        );
        assert_eq!(
            event("subagentStart", r#"{"agentName":"explore"}"#),
            Some(CopilotReporterAction::SubagentStart {
                agent_name: "explore".to_string()
            })
        );
        assert_eq!(
            event("subagentStop", r#"{"agentName":"explore"}"#),
            Some(CopilotReporterAction::SubagentStop {
                agent_name: "explore".to_string()
            })
        );
        assert!(copilot_event_from_hook_payload("subagentStart", b"{}").is_err());
        assert!(copilot_event_from_hook_payload("agentStop", b"{}").is_err());
        assert!(copilot_event_from_hook_payload("unknown", b"{}").is_err());
        assert!(copilot_event_from_hook_payload("agentStop", b"not-json").is_err());
    }

    #[test]
    fn copilot_stop_waits_for_every_active_subagent() {
        let mut activity = CopilotActivity::default();
        let event = |source: &str, action| CopilotReporterEvent {
            source_session_id: source.to_string(),
            action,
        };
        assert_eq!(
            activity.apply(&event(
                "main-session",
                CopilotReporterAction::SessionStarted
            )),
            None
        );
        assert_eq!(
            activity.apply(&event(
                "main-session",
                CopilotReporterAction::BackgroundSubagentQueued
            )),
            Some(AgentLifecycle::Working)
        );
        assert_eq!(
            activity.apply(&event("main-session", CopilotReporterAction::Stop)),
            Some(AgentLifecycle::Working)
        );
        assert_eq!(
            activity.apply(&event(
                "main-session",
                CopilotReporterAction::SubagentStart {
                    agent_name: "general-purpose".to_string()
                }
            )),
            Some(AgentLifecycle::Working)
        );
        assert_eq!(
            activity.apply(&event("child-session", CopilotReporterAction::TurnStarted)),
            Some(AgentLifecycle::Working)
        );
        assert_eq!(
            activity.apply(&event("child-session", CopilotReporterAction::Stop)),
            None
        );
        assert_eq!(
            activity.apply(&event(
                "main-session",
                CopilotReporterAction::SubagentStop {
                    agent_name: "general-purpose".to_string()
                }
            )),
            Some(AgentLifecycle::Done)
        );

        activity.begin_turn();
        assert_eq!(
            activity.apply(&event("main-session", CopilotReporterAction::FatalError)),
            Some(AgentLifecycle::NeedsAttention)
        );
        assert_eq!(
            activity.apply(&event("main-session", CopilotReporterAction::Stop)),
            Some(AgentLifecycle::NeedsAttention)
        );

        activity.begin_turn();
        assert_eq!(
            activity.apply(&event("main-session", CopilotReporterAction::Stop)),
            Some(AgentLifecycle::Done)
        );

        activity.begin_turn();
        assert_eq!(
            activity.apply(&event(
                "main-session",
                CopilotReporterAction::BackgroundSubagentQueued
            )),
            Some(AgentLifecycle::Working)
        );
        assert_eq!(
            activity.apply(&event("main-session", CopilotReporterAction::Stop)),
            Some(AgentLifecycle::Working)
        );
        assert_eq!(
            activity.apply(&event(
                "main-session",
                CopilotReporterAction::BackgroundIdle
            )),
            Some(AgentLifecycle::Idle)
        );
    }

    #[test]
    fn copilot_official_background_event_order_never_finishes_early() {
        let mut activity = CopilotActivity::default();
        let mut apply = |name: &str, payload: &str| {
            let event = copilot_event_from_hook_payload(name, payload.as_bytes())
                .unwrap()
                .unwrap();
            activity.apply(&event)
        };

        assert_eq!(
            apply("sessionStart", r#"{"sessionId":"main-session"}"#),
            None
        );
        assert_eq!(
            apply(
                "userPromptSubmitted",
                r#"{"sessionId":"main-session","prompt":"start"}"#
            ),
            Some(AgentLifecycle::Working)
        );
        assert_eq!(
            apply(
                "postToolUse",
                r#"{"sessionId":"main-session","toolName":"task","toolArgs":{"agent_type":"general-purpose","mode":"background"}}"#
            ),
            Some(AgentLifecycle::Working)
        );
        // Current Copilot emits the main stop before subagentStart. The
        // successful background task event above must close this race window.
        assert_eq!(
            apply("agentStop", r#"{"sessionId":"main-session"}"#),
            Some(AgentLifecycle::Working)
        );
        assert_eq!(
            apply(
                "subagentStart",
                r#"{"sessionId":"main-session","agentName":"general-purpose"}"#
            ),
            Some(AgentLifecycle::Working)
        );
        assert_eq!(
            apply(
                "userPromptSubmitted",
                r#"{"sessionId":"child-session","prompt":"work"}"#
            ),
            Some(AgentLifecycle::Working)
        );
        // A child agentStop must never be interpreted as the main turn stop.
        assert_eq!(apply("agentStop", r#"{"sessionId":"child-session"}"#), None);
        assert_eq!(
            apply(
                "subagentStop",
                r#"{"sessionId":"main-session","agentName":"general-purpose"}"#
            ),
            Some(AgentLifecycle::Done)
        );
    }

    #[test]
    fn opencode_plugin_respects_explicit_runtime_config_and_pure_mode() {
        assert!(opencode_reporter_allowed(&[], false, None));
        assert!(!opencode_reporter_allowed(&[], true, None));
        assert!(!opencode_reporter_allowed(
            &[],
            false,
            Some(OsStr::new("true"))
        ));
        assert!(!opencode_reporter_allowed(
            &["--pure".to_string()],
            false,
            None
        ));
        assert!(opencode_reporter_allowed(
            &["--pure=false".to_string()],
            false,
            None
        ));
    }

    #[test]
    fn opencode_plugin_is_process_scoped_without_editing_user_config() {
        let plugin = write_opencode_reporter_plugin().unwrap();
        assert_eq!(
            std::fs::read_to_string(plugin._file.path()).unwrap(),
            OPENCODE_REPORTER_PLUGIN
        );
        let config: serde_json::Value = serde_json::from_str(&plugin.config_content).unwrap();
        assert_eq!(
            config["plugin"][0],
            plugin._file.path().to_string_lossy().as_ref()
        );
        assert!(config.get("permission").is_none());
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
            group_id: None,
            seed_input: None,
            restore_existing_session: false,
            working_directory: std::env::current_dir().unwrap().display().to_string(),
            cols: 80,
            rows: 24,
        };
        let session = launch(sink.clone(), registry.clone(), request).unwrap();
        let (address, token) = registry
            .reporter_credentials(&session.session_id)
            .expect("reporter credentials");
        let entry = registry.get(&session.session_id).unwrap();
        assert!(!entry.integrated_completion.load(Ordering::Acquire));

        assert!(send_report(
            address,
            &session.session_id,
            "wrong-token",
            AgentLifecycle::NeedsAttention,
        )
        .is_err());
        assert_eq!(registry.list()[0].state, AgentLifecycle::Working);
        assert!(!entry.integrated_completion.load(Ordering::Acquire));

        send_report(address, &session.session_id, &token, AgentLifecycle::Done).unwrap();
        assert!(entry.integrated_completion.load(Ordering::Acquire));
        let summary = &registry.list()[0];
        assert_eq!(summary.state, AgentLifecycle::Done);
        assert_eq!(summary.state_source, AgentStateSource::Integration);
        assert!(!registry.update_state(
            &session.session_id,
            AgentLifecycle::NeedsAttention,
            AgentStateSource::Heuristic,
        ));
        assert_eq!(registry.list()[0].state, AgentLifecycle::Done);

        send_bytes(sink.as_ref(), &registry, &session.session_id, b"\x1b[1;1R").unwrap();
        assert_eq!(registry.list()[0].state, AgentLifecycle::Done);

        send_bytes(
            sink.as_ref(),
            &registry,
            &session.session_id,
            b"next turn\r",
        )
        .unwrap();
        let summary = &registry.list()[0];
        assert_eq!(summary.state, AgentLifecycle::Working);
        assert_eq!(summary.state_source, AgentStateSource::Heuristic);
        send_report(address, &session.session_id, &token, AgentLifecycle::Done).unwrap();
        let summary = &registry.list()[0];
        assert_eq!(summary.state, AgentLifecycle::Done);
        assert_eq!(summary.state_source, AgentStateSource::Integration);
        assert!(collector
            .states
            .lock()
            .unwrap()
            .iter()
            .any(|(_, state, source)| *state == AgentLifecycle::Done
                && *source == AgentStateSource::Integration));

        let usage = AgentUsageReport {
            source_session_id: "child-session".to_string(),
            request_id: "turn-1:api:1".to_string(),
            input_tokens: 120,
            output_tokens: 30,
            cache_read_tokens: 40,
            cache_write_tokens: 5,
            reasoning_tokens: 12,
        };
        assert!(send_usage(address, &session.session_id, "wrong-token", &usage).is_err());
        send_usage(address, &session.session_id, &token, &usage).unwrap();
        // A lost acknowledgement can make the sidecar retry the same request;
        // the authenticated request id keeps the totals idempotent.
        send_usage(address, &session.session_id, &token, &usage).unwrap();
        let summary = &registry.list()[0];
        assert_eq!(
            summary.token_usage,
            Some(AgentTokenUsage {
                input_tokens: 120,
                output_tokens: 30,
                cache_read_tokens: 40,
                cache_write_tokens: 5,
                reasoning_tokens: 12,
                total_tokens: 195,
                api_calls: 1,
            })
        );
        assert_eq!(collector.usages.lock().unwrap().len(), 1);

        disconnect(sink.as_ref(), &registry, &session.session_id).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn restored_output_replays_before_new_pty_data() {
        let collector = Arc::new(TestSink::default());
        let sink: Arc<dyn AgentSink> = collector.clone();
        let registry = Arc::new(AgentRegistry::new());
        let request = AgentLaunchRequest {
            definition_id: "custom".to_string(),
            label: "History replay smoke test".to_string(),
            executable: "powershell.exe".to_string(),
            arguments: vec![
                "-NoLogo".to_string(),
                "-NoProfile".to_string(),
                "-Command".to_string(),
                "Write-Output 'fresh-terminal-output'; Start-Sleep -Seconds 5".to_string(),
            ],
            resume_session_id: None,
            group_id: Some("restored-project".to_string()),
            seed_input: None,
            restore_existing_session: true,
            working_directory: std::env::current_dir().unwrap().display().to_string(),
            cols: 80,
            rows: 24,
        };
        let restored = b"previous-terminal-output\r\n".to_vec();
        let session = launch_with_replay(
            sink.clone(),
            registry.clone(),
            request,
            Some(restored.clone()),
        )
        .unwrap();

        let query_deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < query_deadline
            && !collector
                .data
                .lock()
                .unwrap()
                .windows(4)
                .any(|bytes| bytes == b"\x1b[6n")
        {
            std::thread::sleep(Duration::from_millis(20));
        }
        send_bytes(sink.as_ref(), &registry, &session.session_id, b"\x1b[1;1R").unwrap();

        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline
            && !String::from_utf8_lossy(&collector.data.lock().unwrap())
                .contains("fresh-terminal-output")
        {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(String::from_utf8_lossy(&collector.data.lock().unwrap())
            .contains("fresh-terminal-output"));

        let chunks = collector.chunks.lock().unwrap();
        assert_eq!(chunks[0], (session.session_id.clone(), 0, restored.clone()));
        assert!(chunks
            .iter()
            .skip(1)
            .all(|(id, offset, _)| id != &session.session_id || *offset >= restored.len() as u64));
        drop(chunks);

        let history = registry.terminal_history_snapshots();
        let restored_history = history
            .iter()
            .find(|entry| entry.group_id == "restored-project")
            .expect("restored session history");
        assert!(restored_history.output.starts_with(&restored));
        assert!(String::from_utf8_lossy(&restored_history.output).contains("fresh-terminal-output"));
        disconnect(sink.as_ref(), &registry, &session.session_id).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn windows_pty_runs_powershell_install_pipeline_shape() {
        let collector = Arc::new(TestSink::default());
        let sink: Arc<dyn AgentSink> = collector.clone();
        let registry = Arc::new(AgentRegistry::new());
        let request = AgentLaunchRequest {
            definition_id: "custom".to_string(),
            label: "PowerShell installer smoke test".to_string(),
            executable: "powershell.exe".to_string(),
            arguments: vec![
                "-NoLogo".to_string(),
                "-NoProfile".to_string(),
                "-ExecutionPolicy".to_string(),
                "Bypass".to_string(),
                "-Command".to_string(),
                "Write-Output \"Write-Output 'lattice-install-pipeline-ok'\" | Invoke-Expression"
                    .to_string(),
            ],
            resume_session_id: None,
            group_id: None,
            seed_input: None,
            restore_existing_session: false,
            working_directory: std::env::current_dir().unwrap().display().to_string(),
            cols: 80,
            rows: 24,
        };
        let session = launch(sink.clone(), registry.clone(), request).unwrap();

        let query_deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < query_deadline
            && !collector
                .data
                .lock()
                .unwrap()
                .windows(4)
                .any(|bytes| bytes == b"\x1b[6n")
        {
            std::thread::sleep(Duration::from_millis(20));
        }
        send_bytes(sink.as_ref(), &registry, &session.session_id, b"\x1b[1;1R").unwrap();

        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline && collector.closed.lock().unwrap().is_empty() {
            std::thread::sleep(Duration::from_millis(20));
        }

        let output = String::from_utf8_lossy(&collector.data.lock().unwrap()).into_owned();
        let closed = collector.closed.lock().unwrap();
        assert!(
            output.contains("lattice-install-pipeline-ok"),
            "unexpected PTY output {output:?}; closed reasons: {closed:?}"
        );
        assert_eq!(
            closed.as_slice(),
            ["Process exited: ExitStatus { code: 0, signal: None }"]
        );
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
            group_id: None,
            seed_input: None,
            restore_existing_session: false,
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
    fn split_attention_prompt_is_not_reported_as_completed_by_the_pty_reader() {
        let collector = Arc::new(TestSink::default());
        let sink: Arc<dyn AgentSink> = collector.clone();
        let registry = Arc::new(AgentRegistry::new());
        let request = AgentLaunchRequest {
            definition_id: "custom".to_string(),
            label: "Split prompt test".to_string(),
            executable: "/bin/sh".to_string(),
            arguments: vec![
                "-c".to_string(),
                "printf 'permission requ'; sleep 0.1; printf 'ired\\033[?2004h'; sleep 30"
                    .to_string(),
            ],
            resume_session_id: None,
            group_id: None,
            seed_input: None,
            restore_existing_session: false,
            working_directory: std::env::current_dir().unwrap().display().to_string(),
            cols: 80,
            rows: 24,
        };
        let session = launch(sink.clone(), registry.clone(), request).unwrap();

        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline
            && !collector
                .states
                .lock()
                .unwrap()
                .iter()
                .any(|(_, state, _)| *state == AgentLifecycle::NeedsAttention)
        {
            std::thread::sleep(Duration::from_millis(20));
        }

        let states = collector.states.lock().unwrap();
        assert!(states.iter().any(|(_, state, source)| {
            *state == AgentLifecycle::NeedsAttention && *source == AgentStateSource::Heuristic
        }));
        assert!(!states
            .iter()
            .any(|(_, state, _)| *state == AgentLifecycle::Done));
        drop(states);
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
            group_id: None,
            seed_input: None,
            restore_existing_session: false,
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

    #[test]
    fn disconnect_is_idempotent_after_a_session_is_gone() {
        let sink = TestSink::default();
        let registry = AgentRegistry::new();

        disconnect(&sink, &registry, "agent-missing").unwrap();

        assert!(sink.closed.lock().unwrap().is_empty());
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
                        group_id: None,
                        seed_input: None,
                        restore_existing_session: false,
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
            group_id: None,
            seed_input: None,
            restore_existing_session: false,
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
