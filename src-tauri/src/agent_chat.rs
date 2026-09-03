//! Chat-style conversations with an agent CLI.
//!
//! Some people would rather talk to a model in a message thread than in a
//! terminal. Each turn here runs the CLI once in its documented headless mode
//! (`claude -p --output-format stream-json`, `codex exec --json`, or Gemini's
//! stream JSON mode), reads the
//! JSON it prints, and forwards a small normalised event stream to the
//! interface. The CLI's own session id comes back with the first turn so the
//! next one can resume the same conversation; the CLI keeps the transcript,
//! and LatticeTerm keeps nothing of its own on disk.
//!
//! Login, model access and tool permissions stay with the CLI exactly as in
//! the Agent Fleet: nothing here reads a key or a token, and the CLI runs
//! with the user's own rights, not in a sandbox of LatticeTerm's making.

use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};

pub const EVENT_CHAT: &str = "agent-chat://event";

/// Largest prompt a single turn accepts. Well above anything typed by hand;
/// it exists so a pasted file cannot balloon the child's stdin unbounded.
pub const MAX_PROMPT_BYTES: usize = 256 * 1024;
/// Largest tool output forwarded to the interface per tool call. The full
/// output already reached the model; the card only needs enough to read.
const MAX_TOOL_OUTPUT_BYTES: usize = 8 * 1024;
/// Longest single JSON line the reader will parse. A line past this is
/// reported and skipped rather than buffered in full.
const MAX_LINE_BYTES: usize = 16 * 1024 * 1024;
/// Tail of stderr kept to explain a failed turn.
const MAX_STDERR_BYTES: usize = 4 * 1024;
const MAX_MODEL_LEN: usize = 64;
const MAX_SESSION_ID_LEN: usize = 128;
const MAX_ID_LEN: usize = 64;
const CLAUDE_OAUTH_RETRY_DELAYS_MS: [u64; 2] = [750, 2_000];

/// What the CLI may do during a turn, named by effect so the same choice
/// means the same thing whichever CLI is behind it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChatPermission {
    /// Look but never change: `claude --permission-mode plan`,
    /// `codex -s read-only`.
    ReadOnly,
    /// Edit files under the working directory. Claude still refuses shell
    /// commands that would need an interactive approval, and says so in the
    /// reply; Codex runs them inside its workspace-write sandbox.
    WorkspaceWrite,
    /// Everything, with no prompts. Kept behind an explicit choice in the
    /// interface because it hands the CLI the user's full rights.
    Full,
    /// Each tool call the CLI cannot settle from its own rules is put to the
    /// user as an approval card, the way the terminal would prompt. Only
    /// Claude Code offers this headlessly (its stream-json control
    /// protocol); Codex's `exec` mode has no equivalent.
    Ask,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTurnRequest {
    pub thread_id: String,
    pub turn_id: String,
    pub definition_id: String,
    pub working_directory: String,
    pub prompt: String,
    pub permission: ChatPermission,
    #[serde(default)]
    pub model: Option<String>,
    /// The CLI's own id for this conversation, from an earlier `Started` or
    /// `Finished` event. Absent on the first turn.
    #[serde(default)]
    pub native_session_id: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub reasoning_tokens: u64,
}

/// One step of a turn, in the shape the interface renders. Item ids are
/// stable within a turn so a later event can update the card it started.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ChatEvent {
    Started {
        native_session_id: Option<String>,
        model: Option<String>,
    },
    TextDelta {
        item_id: String,
        delta: String,
    },
    /// The complete text of an assistant message; replaces any deltas.
    Text {
        item_id: String,
        text: String,
    },
    Reasoning {
        item_id: String,
        text: String,
    },
    ToolStarted {
        item_id: String,
        name: String,
        summary: String,
    },
    ToolFinished {
        item_id: String,
        name: Option<String>,
        summary: Option<String>,
        output: String,
        is_error: bool,
    },
    /// Something worth showing that does not end the turn.
    Notice {
        message: String,
    },
    /// The CLI is waiting for the user to allow or deny one tool call.
    ApprovalRequested {
        request_id: String,
        tool_use_id: Option<String>,
        name: String,
        summary: String,
        /// The tool's input, pretty-printed and bounded, for the card.
        input: String,
    },
    Finished {
        native_session_id: Option<String>,
        usage: Option<ChatUsage>,
        cost_usd: Option<f64>,
        duration_ms: Option<u64>,
        error: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatEventEnvelope {
    pub thread_id: String,
    pub turn_id: String,
    pub event: ChatEvent,
}

pub trait ChatSink: Send + Sync + 'static {
    fn event(&self, thread_id: &str, turn_id: &str, event: ChatEvent);
}

pub struct EventSink(pub tauri::AppHandle);

impl ChatSink for EventSink {
    fn event(&self, thread_id: &str, turn_id: &str, event: ChatEvent) {
        use tauri::Emitter;
        let _ = self.0.emit(
            EVENT_CHAT,
            ChatEventEnvelope {
                thread_id: thread_id.to_string(),
                turn_id: turn_id.to_string(),
                event,
            },
        );
    }
}

type SharedStdin = Arc<tokio::sync::Mutex<tokio::process::ChildStdin>>;

struct RunningTurn {
    turn_id: String,
    child: Child,
    /// Kept open for the whole turn only when approvals can be asked; a
    /// one-shot turn closes stdin right after the prompt.
    stdin: Option<SharedStdin>,
    /// Inputs of the tool calls awaiting an answer, by request id. The
    /// answer echoes the input back, and the interface only has a bounded
    /// rendering of it.
    pending_inputs: HashMap<String, Value>,
}

/// The turns currently running, one per thread at most.
#[derive(Default)]
pub struct AgentChatRegistry {
    running: Mutex<HashMap<String, RunningTurn>>,
    /// Claude's OAuth refresh lock is cross-process. Starting a model probe
    /// and a turn at the same instant can make one process report that the
    /// other is refreshing the token even though the saved login is valid.
    /// Serialize only the authentication/startup window; turns remain free
    /// to run concurrently after Claude emits its initialization event.
    claude_startup: Arc<tokio::sync::Mutex<()>>,
}

impl AgentChatRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, RunningTurn>> {
        self.running
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    async fn startup_guard(&self, dialect: Dialect) -> Option<tokio::sync::OwnedMutexGuard<()>> {
        if dialect == Dialect::Claude {
            Some(Arc::clone(&self.claude_startup).lock_owned().await)
        } else {
            None
        }
    }

    /// Asks the running turn on `thread_id` to stop. Returns whether there
    /// was one; the `Finished` event still arrives once the process exits.
    pub fn stop(&self, thread_id: &str) -> Result<bool, String> {
        validate_id(thread_id, "thread id")?;
        let mut running = self.lock();
        match running.get_mut(thread_id) {
            Some(turn) => {
                turn.stdin = None;
                turn.pending_inputs.clear();
                turn.child
                    .start_kill()
                    .map_err(|error| format!("Cannot stop the agent: {error}"))?;
                Ok(true)
            }
            None => Ok(false),
        }
    }

    /// Ends every running turn. Called when the application exits so no CLI
    /// keeps working for a window that is gone.
    pub fn shutdown(&self) {
        let mut running = self.lock();
        for turn in running.values_mut() {
            let _ = turn.child.start_kill();
        }
        running.clear();
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Dialect {
    Claude,
    Codex,
    Gemini,
}

impl Dialect {
    fn from_definition(definition_id: &str) -> Option<Self> {
        match definition_id {
            "claude" => Some(Self::Claude),
            "codex" => Some(Self::Codex),
            "gemini" => Some(Self::Gemini),
            _ => None,
        }
    }
}

/// Which CLIs chat mode can drive. Only those with a documented headless
/// JSON mode qualify; anything else stays a terminal in the Agent Fleet.
pub fn supported_definitions() -> &'static [&'static str] {
    &["claude", "codex", "gemini"]
}

fn validate_id(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > MAX_ID_LEN {
        return Err(format!("Invalid {label}."));
    }
    if !value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("Invalid {label}."));
    }
    Ok(())
}

fn validate_model(model: &str) -> Result<(), String> {
    if model.is_empty() || model.len() > MAX_MODEL_LEN {
        return Err("The model name is too long.".to_string());
    }
    if model.starts_with('-')
        || !model
            .chars()
            // Claude's model aliases carry a context suffix, e.g. `opus[1m]`.
            .all(|c| {
                c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ':' | '/' | '[' | ']')
            })
    {
        return Err("The model name contains characters a CLI would not accept.".to_string());
    }
    Ok(())
}

fn validate_native_session_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > MAX_SESSION_ID_LEN {
        return Err("The saved conversation id is invalid.".to_string());
    }
    if id.starts_with('-')
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    {
        return Err("The saved conversation id is invalid.".to_string());
    }
    Ok(())
}

fn validate_working_directory(raw: &str) -> Result<PathBuf, String> {
    let path = Path::new(raw.trim());
    if raw.trim().is_empty() || !path.is_absolute() {
        return Err("Choose a working directory first.".to_string());
    }
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("The working directory cannot be opened: {error}"))?;
    if !canonical.is_dir() {
        return Err("The working directory is not a directory.".to_string());
    }
    Ok(canonical)
}

/// The argument vector for one turn. The prompt is never an argument: it
/// goes to stdin, so it neither hits an argument length limit nor shows in
/// the process list.
fn turn_arguments(
    dialect: Dialect,
    working_directory: &Path,
    permission: ChatPermission,
    model: Option<&str>,
    native_session_id: Option<&str>,
) -> Vec<OsString> {
    let mut args: Vec<OsString> = Vec::new();
    match dialect {
        Dialect::Claude => {
            args.extend(
                [
                    "-p",
                    "--output-format",
                    "stream-json",
                    // stream-json refuses to run without it.
                    "--verbose",
                    "--include-partial-messages",
                    "--permission-mode",
                    match permission {
                        ChatPermission::ReadOnly => "plan",
                        ChatPermission::WorkspaceWrite => "acceptEdits",
                        ChatPermission::Full => "bypassPermissions",
                        // The classic prompt-for-anything-not-allowed mode.
                        ChatPermission::Ask => "manual",
                    },
                ]
                .map(OsString::from),
            );
            if permission == ChatPermission::Ask {
                // Bidirectional: the prompt and every approval answer go in
                // as JSON lines, and permission questions come out as
                // `control_request` lines instead of being auto-denied.
                args.extend(
                    [
                        "--input-format",
                        "stream-json",
                        "--permission-prompt-tool",
                        "stdio",
                    ]
                    .map(OsString::from),
                );
            }
            if let Some(model) = model {
                args.push("--model".into());
                args.push(model.into());
            }
            if let Some(id) = native_session_id {
                args.push("--resume".into());
                args.push(id.into());
            }
        }
        Dialect::Codex => {
            args.push("exec".into());
            args.push("--json".into());
            // The user chose the directory; whether it is a git checkout is
            // not a reason to refuse a conversation.
            args.push("--skip-git-repo-check".into());
            args.push("-C".into());
            args.push(working_directory.as_os_str().to_os_string());
            match permission {
                ChatPermission::ReadOnly => {
                    args.push("-s".into());
                    args.push("read-only".into());
                }
                ChatPermission::WorkspaceWrite => {
                    args.push("-s".into());
                    args.push("workspace-write".into());
                }
                ChatPermission::Full => {
                    args.push("--dangerously-bypass-approvals-and-sandbox".into());
                }
                // Refused before the arguments are built; the closest
                // headless equivalent is the sandbox that changes nothing.
                ChatPermission::Ask => {
                    args.push("-s".into());
                    args.push("read-only".into());
                }
            }
            match native_session_id {
                Some(id) => {
                    // A Codex thread keeps its model; changing it mid-thread
                    // is not something `resume` offers.
                    args.push("resume".into());
                    args.push(id.into());
                }
                None => {
                    if let Some(model) = model {
                        args.push("-m".into());
                        args.push(model.into());
                    }
                }
            }
            // Read the prompt from stdin.
            args.push("-".into());
        }
        Dialect::Gemini => {
            args.extend(["--output-format", "stream-json"].map(OsString::from));
            args.push("--approval-mode".into());
            args.push(
                match permission {
                    ChatPermission::ReadOnly => "plan",
                    ChatPermission::WorkspaceWrite => "auto_edit",
                    ChatPermission::Full => "yolo",
                    // Refused before argument construction.
                    ChatPermission::Ask => "plan",
                }
                .into(),
            );
            if let Some(model) = model {
                args.push("--model".into());
                args.push(model.into());
            }
            if let Some(id) = native_session_id {
                args.push("--resume".into());
                args.push(id.into());
            }
            // A piped stdin makes Gemini enter headless mode without putting
            // the user's prompt in the process list.
        }
    }
    args
}

/// A CLI process driven over pipes, with nothing inherited that would make
/// it behave as part of something else.
fn headless_command(executable: &Path) -> Command {
    let (program, prefix) = crate::agent::launch_parts(executable);
    let mut command = Command::new(&program);
    command.args(prefix);
    #[cfg(windows)]
    if let Some(path) = crate::agent::node_runtime_path_for_script(executable) {
        command.env("PATH", path);
    }
    // A chat turn is its own conversation, not a hook target of whatever
    // launched LatticeTerm. Inherited markers would make the CLI refuse to
    // nest, or report its progress to a fleet session it does not belong to.
    for name in [
        "CLAUDECODE",
        "CLAUDE_CODE_ENTRYPOINT",
        "HERDR_ENV",
        "HERDR_PANE_ID",
        "LATTICETERM_AGENT_REPORTER",
        "LATTICETERM_AGENT_REPORT_ADDR",
        "LATTICETERM_AGENT_REPORT_TOKEN",
        "LATTICETERM_AGENT_SESSION",
    ] {
        command.env_remove(name);
    }
    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    command.kill_on_drop(true);
    // A console program started from a windowed one gets its own console
    // window unless told otherwise; a chat reply must not flash a black
    // window on every turn.
    #[cfg(windows)]
    command.creation_flags(0x0800_0000 /* CREATE_NO_WINDOW */);
    command
}

/// A model the CLI offers, in the shape the model picker shows.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatModelChoice {
    /// What `--model` receives; empty for the CLI's own default.
    pub value: String,
    pub label: String,
    pub description: Option<String>,
    pub is_default: bool,
}

const MODEL_LIST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(25);

fn gemini_model_choices() -> Vec<ChatModelChoice> {
    vec![
        ChatModelChoice {
            value: String::new(),
            label: "Auto (default)".to_string(),
            description: None,
            is_default: true,
        },
        ChatModelChoice {
            value: "pro".to_string(),
            label: "Pro".to_string(),
            description: None,
            is_default: false,
        },
        ChatModelChoice {
            value: "flash".to_string(),
            label: "Flash".to_string(),
            description: None,
            is_default: false,
        },
        ChatModelChoice {
            value: "flash-lite".to_string(),
            label: "Flash Lite".to_string(),
            description: None,
            is_default: false,
        },
    ]
}

/// Asks the CLI which models it offers, without starting a conversation.
///
/// Claude lists them in its `initialize` handshake reply; Codex answers
/// `model/list` on its app-server protocol. Either process is killed as soon
/// as the answer is in. Gemini exposes documented routing aliases instead of
/// a non-interactive list API, so those stable aliases are returned directly.
pub async fn list_models(
    registry: Arc<AgentChatRegistry>,
    definition_id: &str,
) -> Result<Vec<ChatModelChoice>, String> {
    let dialect = Dialect::from_definition(definition_id)
        .ok_or_else(|| "This CLI has no chat mode.".to_string())?;
    let executable = crate::agent::catalog_executable(definition_id)
        .ok_or_else(|| "This CLI is not installed.".to_string())?;
    if dialect == Dialect::Gemini {
        // Gemini's documented aliases are deliberately stable while their
        // concrete targets can change with account access and CLI updates.
        return Ok(gemini_model_choices());
    }
    // Keep the guard until the probe has answered and its process has exited.
    // A turn requested meanwhile waits instead of racing Claude's token refresh.
    let _startup_guard = registry.startup_guard(dialect).await;
    let mut command = headless_command(&executable);
    let (requests, done_id): (Vec<String>, &str) = match dialect {
        Dialect::Claude => {
            command.args([
                "-p",
                "--output-format",
                "stream-json",
                "--input-format",
                "stream-json",
                "--verbose",
                "--permission-mode",
                "plan",
            ]);
            (
                vec![serde_json::json!({
                    "type": "control_request",
                    "request_id": "latticeterm-models",
                    "request": { "subtype": "initialize", "hooks": {} },
                })
                .to_string()],
                "latticeterm-models",
            )
        }
        Dialect::Codex => {
            command.args(["app-server"]);
            (
                vec![
                    serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "initialize",
                        "params": { "clientInfo": {
                            "name": "latticeterm",
                            "title": "LatticeTerm",
                            "version": env!("CARGO_PKG_VERSION"),
                        } },
                    })
                    .to_string(),
                    serde_json::json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} })
                        .to_string(),
                    serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": 2,
                        "method": "model/list",
                        "params": {},
                    })
                    .to_string(),
                ],
                "2",
            )
        }
        Dialect::Gemini => unreachable!("Gemini model aliases return without a subprocess"),
    };
    let mut child = command
        .spawn()
        .map_err(|error| format!("Cannot start {definition_id}: {error}"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "The agent's input could not be opened.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "The agent's output could not be captured.".to_string())?;
    for line in &requests {
        stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|error| format!("Cannot ask {definition_id} for its models: {error}"))?;
        stdin
            .write_all(b"\n")
            .await
            .map_err(|error| format!("Cannot ask {definition_id} for its models: {error}"))?;
    }
    let _ = stdin.flush().await;

    let answer = tokio::time::timeout(MODEL_LIST_TIMEOUT, async {
        let mut reader = BufReader::new(stdout);
        let mut line = Vec::new();
        loop {
            line.clear();
            match read_bounded_line(&mut reader, &mut line).await {
                Ok(0) | Err(LineError::Io) => return None,
                Ok(_) => {}
                Err(LineError::TooLong) => continue,
            }
            let text = String::from_utf8_lossy(&line);
            let Ok(value) = serde_json::from_str::<Value>(text.trim_end()) else {
                continue;
            };
            if let Some(models) = models_from_reply(dialect, &value, done_id) {
                return Some(models);
            }
        }
    })
    .await;
    let _ = child.start_kill();
    let _ = child.wait().await;
    match answer {
        Ok(Some(models)) => Ok(models),
        Ok(None) => Err("The agent ended before listing its models.".to_string()),
        Err(_) => Err("The agent did not list its models in time.".to_string()),
    }
}

/// The model list inside one protocol reply, if this is the reply.
fn models_from_reply(
    dialect: Dialect,
    value: &Value,
    done_id: &str,
) -> Option<Vec<ChatModelChoice>> {
    match dialect {
        Dialect::Claude => {
            if str_field(value, "type") != Some("control_response") {
                return None;
            }
            let response = value.get("response")?;
            if str_field(response, "request_id") != Some(done_id) {
                return None;
            }
            let models = response.get("response")?.get("models")?.as_array()?;
            Some(
                models
                    .iter()
                    .filter_map(|model| {
                        let raw = str_field(model, "value")?;
                        // "default" is the CLI's own choice; passing it as
                        // `--model` says nothing an absent flag would not.
                        let is_default = raw == "default";
                        Some(ChatModelChoice {
                            value: if is_default {
                                String::new()
                            } else {
                                raw.to_string()
                            },
                            label: str_field(model, "displayName").unwrap_or(raw).to_string(),
                            description: str_field(model, "description").map(str::to_string),
                            is_default,
                        })
                    })
                    .collect(),
            )
        }
        Dialect::Codex => {
            // JSON-RPC ids come back as numbers; the request used a number too.
            let id = value.get("id")?.as_u64()?.to_string();
            if id != done_id {
                return None;
            }
            let data = value.get("result")?.get("data")?.as_array()?;
            Some(
                data.iter()
                    .filter(|model| {
                        !model
                            .get("hidden")
                            .and_then(Value::as_bool)
                            .unwrap_or(false)
                    })
                    .filter_map(|model| {
                        let id = str_field(model, "id").or_else(|| str_field(model, "model"))?;
                        Some(ChatModelChoice {
                            value: id.to_string(),
                            label: str_field(model, "displayName").unwrap_or(id).to_string(),
                            description: str_field(model, "description").map(str::to_string),
                            is_default: model
                                .get("isDefault")
                                .and_then(Value::as_bool)
                                .unwrap_or(false),
                        })
                    })
                    .collect(),
            )
        }
        Dialect::Gemini => None,
    }
}

/// Starts one turn. Returns as soon as the process is running; everything
/// it says arrives through the sink.
///
/// Async because tokio's process spawning needs a runtime context, which a
/// synchronous Tauri command does not have.
pub async fn send<S: ChatSink>(
    sink: Arc<S>,
    registry: Arc<AgentChatRegistry>,
    request: ChatTurnRequest,
) -> Result<(), String> {
    send_with_retry(sink, registry, request, 0).await
}

fn send_with_retry<S: ChatSink>(
    sink: Arc<S>,
    registry: Arc<AgentChatRegistry>,
    request: ChatTurnRequest,
    retry_index: usize,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + 'static>> {
    Box::pin(async move {
        validate_id(&request.thread_id, "thread id")?;
        validate_id(&request.turn_id, "turn id")?;
        let dialect = Dialect::from_definition(&request.definition_id)
            .ok_or_else(|| "This CLI has no chat mode.".to_string())?;
        let interactive = request.permission == ChatPermission::Ask;
        if interactive && dialect != Dialect::Claude {
            return Err("This CLI cannot ask for approval in chat mode.".to_string());
        }
        if request.prompt.trim().is_empty() {
            return Err("Type a message first.".to_string());
        }
        if request.prompt.len() > MAX_PROMPT_BYTES {
            return Err("The message is too long for one turn.".to_string());
        }
        let model = request
            .model
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if let Some(model) = model {
            validate_model(model)?;
        }
        if let Some(id) = request.native_session_id.as_deref() {
            validate_native_session_id(id)?;
        }
        let working_directory = validate_working_directory(&request.working_directory)?;
        let executable = crate::agent::catalog_executable(&request.definition_id)
            .ok_or_else(|| "This CLI is not installed.".to_string())?;

        // Claude model discovery and other chat threads may start at nearly the
        // same time. Wait for their authentication startup before spawning this
        // process, then keep the guard until this process reports initialization.
        let mut startup_guard = registry.startup_guard(dialect).await;

        {
            let running = registry.lock();
            if running.contains_key(&request.thread_id) {
                return Err("This conversation is still answering.".to_string());
            }
        }

        let mut command = headless_command(&executable);
        command.args(turn_arguments(
            dialect,
            &working_directory,
            request.permission,
            model,
            request.native_session_id.as_deref(),
        ));
        command.current_dir(&working_directory);

        let mut child = command
            .spawn()
            .map_err(|error| format!("Cannot start {}: {error}", request.definition_id))?;
        let stdin = child.stdin.take();
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "The agent's output could not be captured.".to_string())?;
        let stderr = child.stderr.take();
        let (one_shot_stdin, mut shared_stdin) = if interactive {
            (
                None,
                stdin.map(|stdin| Arc::new(tokio::sync::Mutex::new(stdin))),
            )
        } else {
            (stdin, None)
        };

        {
            let mut running = registry.lock();
            running.insert(
                request.thread_id.clone(),
                RunningTurn {
                    turn_id: request.turn_id.clone(),
                    child,
                    stdin: shared_stdin.clone(),
                    pending_inputs: HashMap::new(),
                },
            );
        }

        let retry_request = request.clone();
        let thread_id = request.thread_id;
        let turn_id = request.turn_id;
        let prompt = request.prompt;
        tauri::async_runtime::spawn(async move {
            // A CLI that has already exited closes the pipe; the exit status
            // explains that better than a write error would.
            if let Some(mut stdin) = one_shot_stdin {
                let _ = stdin.write_all(prompt.as_bytes()).await;
                let _ = stdin.write_all(b"\n").await;
                let _ = stdin.shutdown().await;
            } else if let Some(stdin) = &shared_stdin {
                let mut stdin = stdin.lock().await;
                for line in interactive_opening_lines(&prompt) {
                    let _ = stdin.write_all(line.as_bytes()).await;
                    let _ = stdin.write_all(b"\n").await;
                }
                let _ = stdin.flush().await;
            }

            let stderr_task = tauri::async_runtime::spawn(async move {
                let mut tail = String::new();
                if let Some(mut stderr) = stderr {
                    let mut buffer = Vec::new();
                    let _ = stderr.read_to_end(&mut buffer).await;
                    tail = String::from_utf8_lossy(&buffer).into_owned();
                }
                if tail.len() > MAX_STDERR_BYTES {
                    let cut = floor_char_boundary(&tail, tail.len() - MAX_STDERR_BYTES);
                    tail = tail[cut..].to_string();
                }
                tail
            });

            let mut state = TurnState::default();
            let mut had_progress = false;
            let mut reader = BufReader::new(stdout);
            let mut line = Vec::new();
            loop {
                line.clear();
                match read_bounded_line(&mut reader, &mut line).await {
                    Ok(0) => break,
                    Ok(_) => {}
                    Err(LineError::TooLong) => {
                        sink.event(
                            &thread_id,
                            &turn_id,
                            ChatEvent::Notice {
                                message: "One message from the agent was too large to show."
                                    .to_string(),
                            },
                        );
                        continue;
                    }
                    Err(LineError::Io) => break,
                }
                let text = String::from_utf8_lossy(&line);
                for event in parse_line(dialect, &mut state, text.trim_end()) {
                    if matches!(&event, ChatEvent::Started { .. }) {
                        startup_guard.take();
                    }
                    if matches!(
                        &event,
                        ChatEvent::TextDelta { .. }
                            | ChatEvent::Text { .. }
                            | ChatEvent::Reasoning { .. }
                            | ChatEvent::ToolStarted { .. }
                            | ChatEvent::ToolFinished { .. }
                            | ChatEvent::ApprovalRequested { .. }
                    ) {
                        had_progress = true;
                    }
                    sink.event(&thread_id, &turn_id, event);
                }
                if !state.pending_inputs.is_empty() {
                    let mut running = registry.lock();
                    if let Some(turn) = running.get_mut(&thread_id) {
                        if turn.turn_id == turn_id {
                            turn.pending_inputs.extend(state.pending_inputs.drain(..));
                        }
                    }
                    state.pending_inputs.clear();
                }
                if state.turn_complete {
                    if let Some(stdin) = shared_stdin.take() {
                        // The reply is in. Closing stdin is what ends a
                        // bidirectional CLI; it keeps waiting for input otherwise.
                        {
                            let mut running = registry.lock();
                            if let Some(turn) = running.get_mut(&thread_id) {
                                turn.stdin = None;
                                turn.pending_inputs.clear();
                            }
                        }
                        let mut stdin = stdin.lock().await;
                        let _ = stdin.shutdown().await;
                    }
                }
            }

            let child = {
                let mut running = registry.lock();
                match running.get(&thread_id) {
                    Some(turn) if turn.turn_id == turn_id => running.remove(&thread_id),
                    _ => None,
                }
            };
            let status = match child {
                Some(mut turn) => turn.child.wait().await.ok(),
                None => None,
            };
            let stderr_tail = stderr_task.await.unwrap_or_default();

            let mut error = state.error.take();
            if error.is_none() {
                match status {
                    Some(status) if status.success() => {}
                    Some(status) => {
                        let detail = stderr_tail.trim();
                        error = Some(if detail.is_empty() {
                            format!("The agent exited with {status}.")
                        } else {
                            detail.to_string()
                        });
                    }
                    None => error = Some("The agent was stopped.".to_string()),
                }
            }

            if should_retry_claude_oauth(dialect, had_progress, retry_index, error.as_deref()) {
                // Claude says this exact failure is transient. No answer or tool
                // call was emitted, so resending cannot duplicate a side effect.
                // A new conversation stays new; an existing one keeps the id
                // supplied by the original request.
                startup_guard.take();
                tokio::time::sleep(std::time::Duration::from_millis(
                    CLAUDE_OAUTH_RETRY_DELAYS_MS[retry_index],
                ))
                .await;
                match send_with_retry(
                    Arc::clone(&sink),
                    Arc::clone(&registry),
                    retry_request,
                    retry_index + 1,
                )
                .await
                {
                    Ok(()) => return,
                    Err(retry_error) => error = Some(retry_error),
                }
            }
            sink.event(
                &thread_id,
                &turn_id,
                ChatEvent::Finished {
                    native_session_id: state.native_session_id.take(),
                    usage: state.usage.take(),
                    cost_usd: state.cost_usd,
                    duration_ms: state.duration_ms,
                    error,
                },
            );
        });
        Ok(())
    })
}

fn is_claude_oauth_refresh_busy(error: &str) -> bool {
    error
        .to_ascii_lowercase()
        .contains("another claude code process is refreshing it or exited mid-refresh")
}

fn should_retry_claude_oauth(
    dialect: Dialect,
    had_progress: bool,
    retry_index: usize,
    error: Option<&str>,
) -> bool {
    dialect == Dialect::Claude
        && !had_progress
        && retry_index < CLAUDE_OAUTH_RETRY_DELAYS_MS.len()
        && error.is_some_and(is_claude_oauth_refresh_busy)
}

enum LineError {
    TooLong,
    Io,
}

/// Reads one line, giving up on a line past `MAX_LINE_BYTES` and skipping to
/// its end so the next line still parses.
async fn read_bounded_line<R: AsyncBufReadExt + Unpin>(
    reader: &mut R,
    line: &mut Vec<u8>,
) -> Result<usize, LineError> {
    let mut total = 0usize;
    loop {
        let available = reader.fill_buf().await.map_err(|_| LineError::Io)?;
        if available.is_empty() {
            return Ok(total);
        }
        let (chunk, finished) = match available.iter().position(|byte| *byte == b'\n') {
            Some(index) => (&available[..=index], true),
            None => (available, false),
        };
        let taken = chunk.len();
        if total + taken <= MAX_LINE_BYTES {
            line.extend_from_slice(chunk);
        }
        total += taken;
        reader.consume(taken);
        if finished {
            if total > MAX_LINE_BYTES {
                line.clear();
                return Err(LineError::TooLong);
            }
            return Ok(total);
        }
    }
}

/// What a bidirectional Claude turn writes before anything else: the
/// handshake the SDK sends, then the prompt as a user message.
fn interactive_opening_lines(prompt: &str) -> Vec<String> {
    vec![
        serde_json::json!({
            "type": "control_request",
            "request_id": "latticeterm-init",
            "request": { "subtype": "initialize", "hooks": {} },
        })
        .to_string(),
        serde_json::json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": [{ "type": "text", "text": prompt }],
            },
        })
        .to_string(),
    ]
}

/// The answer to one `can_use_tool` request, as the CLI expects it. An
/// allow echoes the original input back; a deny carries a reason the model
/// sees as the tool's result.
fn control_response_line(
    request_id: &str,
    allow: bool,
    input: Option<Value>,
    message: Option<&str>,
) -> String {
    let response = if allow {
        serde_json::json!({
            "behavior": "allow",
            "updatedInput": input.unwrap_or(Value::Object(Default::default())),
        })
    } else {
        serde_json::json!({
            "behavior": "deny",
            "message": message.unwrap_or("The user declined this tool call."),
        })
    };
    serde_json::json!({
        "type": "control_response",
        "response": {
            "subtype": "success",
            "request_id": request_id,
            "response": response,
        },
    })
    .to_string()
}

/// Answers a pending approval on `thread_id`.
pub async fn respond(
    registry: Arc<AgentChatRegistry>,
    thread_id: &str,
    request_id: &str,
    allow: bool,
    message: Option<&str>,
) -> Result<(), String> {
    validate_id(thread_id, "thread id")?;
    validate_id(request_id, "request id")?;
    let message = message.map(|text| truncate(text.trim(), 1024));
    let (stdin, input) = {
        let mut running = registry.lock();
        let turn = running
            .get_mut(thread_id)
            .ok_or_else(|| "This conversation is not waiting for an answer.".to_string())?;
        let input = turn
            .pending_inputs
            .remove(request_id)
            .ok_or_else(|| "This approval has already been answered.".to_string())?;
        let stdin = turn
            .stdin
            .clone()
            .ok_or_else(|| "This conversation is not waiting for an answer.".to_string())?;
        (stdin, input)
    };
    let line = control_response_line(request_id, allow, Some(input), message.as_deref());
    let mut stdin = stdin.lock().await;
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|error| format!("Cannot answer the agent: {error}"))?;
    stdin
        .write_all(b"\n")
        .await
        .map_err(|error| format!("Cannot answer the agent: {error}"))?;
    stdin
        .flush()
        .await
        .map_err(|error| format!("Cannot answer the agent: {error}"))?;
    Ok(())
}

#[derive(Default)]
struct TurnState {
    native_session_id: Option<String>,
    usage: Option<ChatUsage>,
    cost_usd: Option<f64>,
    duration_ms: Option<u64>,
    error: Option<String>,
    /// Claude: the API message whose content blocks the deltas belong to.
    current_message_id: Option<String>,
    /// The CLI has produced its final result; a bidirectional turn can now
    /// have its stdin closed.
    turn_complete: bool,
    /// Tool inputs behind the `ApprovalRequested` events just emitted,
    /// handed to the registry so an answer can echo them back.
    pending_inputs: Vec<(String, Value)>,
}

fn parse_line(dialect: Dialect, state: &mut TurnState, line: &str) -> Vec<ChatEvent> {
    if line.trim().is_empty() {
        return Vec::new();
    }
    let value: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        // Headless CLIs occasionally print a plain warning between events.
        Err(_) => {
            return vec![ChatEvent::Notice {
                message: truncate(line, 512),
            }]
        }
    };
    match dialect {
        Dialect::Claude => parse_claude(state, &value),
        Dialect::Codex => parse_codex(state, &value),
        Dialect::Gemini => parse_gemini(state, &value),
    }
}

fn str_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn u64_field(value: &Value, key: &str) -> u64 {
    value.get(key).and_then(Value::as_u64).unwrap_or(0)
}

fn parse_claude(state: &mut TurnState, value: &Value) -> Vec<ChatEvent> {
    let mut events = Vec::new();
    match str_field(value, "type") {
        Some("system") if str_field(value, "subtype") == Some("init") => {
            state.native_session_id = str_field(value, "session_id").map(str::to_string);
            events.push(ChatEvent::Started {
                native_session_id: state.native_session_id.clone(),
                model: str_field(value, "model").map(str::to_string),
            });
        }
        Some("stream_event") => {
            let Some(event) = value.get("event") else {
                return events;
            };
            match str_field(event, "type") {
                Some("message_start") => {
                    state.current_message_id = event
                        .get("message")
                        .and_then(|message| str_field(message, "id"))
                        .map(str::to_string);
                }
                Some("content_block_delta") => {
                    let index = u64_field(event, "index");
                    if let Some(delta) = event.get("delta") {
                        if str_field(delta, "type") == Some("text_delta") {
                            if let Some(text) = str_field(delta, "text") {
                                let message_id = state.current_message_id.as_deref().unwrap_or("m");
                                events.push(ChatEvent::TextDelta {
                                    item_id: format!("{message_id}#{index}"),
                                    delta: text.to_string(),
                                });
                            }
                        }
                    }
                }
                _ => {}
            }
        }
        Some("assistant") => {
            let Some(message) = value.get("message") else {
                return events;
            };
            let message_id = str_field(message, "id").unwrap_or("m");
            let blocks = message
                .get("content")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            for (index, block) in blocks.iter().enumerate() {
                match str_field(block, "type") {
                    Some("text") => events.push(ChatEvent::Text {
                        item_id: format!("{message_id}#{index}"),
                        text: str_field(block, "text").unwrap_or_default().to_string(),
                    }),
                    Some("thinking") => {
                        let text = str_field(block, "thinking").unwrap_or_default();
                        if !text.is_empty() {
                            events.push(ChatEvent::Reasoning {
                                item_id: format!("{message_id}#{index}"),
                                text: text.to_string(),
                            });
                        }
                    }
                    Some("tool_use") => {
                        let name = str_field(block, "name").unwrap_or("tool").to_string();
                        let input = block.get("input").cloned().unwrap_or(Value::Null);
                        events.push(ChatEvent::ToolStarted {
                            item_id: str_field(block, "id")
                                .map(str::to_string)
                                .unwrap_or_else(|| format!("{message_id}#{index}")),
                            summary: claude_tool_summary(&name, &input),
                            name,
                        });
                    }
                    _ => {}
                }
            }
        }
        Some("user") => {
            let blocks = value
                .get("message")
                .and_then(|message| message.get("content"))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            for block in blocks {
                if str_field(&block, "type") != Some("tool_result") {
                    continue;
                }
                let Some(item_id) = str_field(&block, "tool_use_id") else {
                    continue;
                };
                events.push(ChatEvent::ToolFinished {
                    item_id: item_id.to_string(),
                    name: None,
                    summary: None,
                    output: bounded_output(&content_text(block.get("content"))),
                    is_error: block
                        .get("is_error")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                });
            }
        }
        Some("control_request") => {
            let Some(request) = value.get("request") else {
                return events;
            };
            if str_field(request, "subtype") != Some("can_use_tool") {
                return events;
            }
            let Some(request_id) = str_field(value, "request_id") else {
                return events;
            };
            let name = str_field(request, "tool_name")
                .unwrap_or("tool")
                .to_string();
            let input = request.get("input").cloned().unwrap_or(Value::Null);
            let summary = str_field(request, "description")
                .map(|text| truncate(text, 200))
                .filter(|text| !text.is_empty())
                .unwrap_or_else(|| claude_tool_summary(&name, &input));
            events.push(ChatEvent::ApprovalRequested {
                request_id: request_id.to_string(),
                tool_use_id: str_field(request, "tool_use_id").map(str::to_string),
                name,
                summary,
                input: bounded_output(&serde_json::to_string_pretty(&input).unwrap_or_default()),
            });
            state.pending_inputs.push((request_id.to_string(), input));
        }
        Some("result") => {
            state.turn_complete = true;
            if let Some(id) = str_field(value, "session_id") {
                state.native_session_id = Some(id.to_string());
            }
            state.cost_usd = value.get("total_cost_usd").and_then(Value::as_f64);
            state.duration_ms = value.get("duration_ms").and_then(Value::as_u64);
            if let Some(usage) = value.get("usage") {
                state.usage = Some(ChatUsage {
                    input_tokens: u64_field(usage, "input_tokens"),
                    output_tokens: u64_field(usage, "output_tokens"),
                    cache_read_tokens: u64_field(usage, "cache_read_input_tokens"),
                    cache_write_tokens: u64_field(usage, "cache_creation_input_tokens"),
                    reasoning_tokens: usage
                        .get("output_tokens_details")
                        .map(|details| u64_field(details, "thinking_tokens"))
                        .unwrap_or(0),
                });
            }
            let is_error = value
                .get("is_error")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if is_error {
                let detail = value
                    .get("errors")
                    .and_then(Value::as_array)
                    .and_then(|errors| errors.first())
                    .and_then(Value::as_str)
                    .or_else(|| str_field(value, "result"))
                    .unwrap_or("The agent reported an error.");
                state.error = Some(truncate(detail, 2048));
            }
        }
        _ => {}
    }
    events
}

/// The one line that tells a reader what a tool call is about.
fn claude_tool_summary(name: &str, input: &Value) -> String {
    let pick = |keys: &[&str]| {
        keys.iter()
            .find_map(|key| str_field(input, key))
            .map(str::to_string)
    };
    let summary = match name {
        "Bash" => pick(&["command"]),
        "Read" | "Edit" | "Write" | "MultiEdit" | "NotebookEdit" => {
            pick(&["file_path", "notebook_path"])
        }
        "Grep" | "Glob" => pick(&["pattern"]),
        "WebFetch" => pick(&["url"]),
        "WebSearch" => pick(&["query"]),
        "Task" | "Agent" => pick(&["description", "prompt"]),
        _ => None,
    };
    let summary = summary.unwrap_or_else(|| match input {
        Value::Object(map) if !map.is_empty() => serde_json::to_string(input).unwrap_or_default(),
        _ => String::new(),
    });
    truncate(summary.lines().next().unwrap_or_default(), 200)
}

fn content_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(blocks)) => blocks
            .iter()
            .filter_map(|block| str_field(block, "text"))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn parse_codex(state: &mut TurnState, value: &Value) -> Vec<ChatEvent> {
    let mut events = Vec::new();
    match str_field(value, "type") {
        Some("thread.started") => {
            state.native_session_id = str_field(value, "thread_id").map(str::to_string);
            events.push(ChatEvent::Started {
                native_session_id: state.native_session_id.clone(),
                model: None,
            });
        }
        Some(kind @ ("item.started" | "item.updated" | "item.completed")) => {
            let Some(item) = value.get("item") else {
                return events;
            };
            let completed = kind == "item.completed";
            let item_id = str_field(item, "id").unwrap_or("item").to_string();
            match str_field(item, "type") {
                Some("agent_message") => events.push(ChatEvent::Text {
                    item_id,
                    text: str_field(item, "text").unwrap_or_default().to_string(),
                }),
                Some("reasoning") => {
                    let text = str_field(item, "text").unwrap_or_default();
                    if !text.is_empty() {
                        events.push(ChatEvent::Reasoning {
                            item_id,
                            text: text.to_string(),
                        });
                    }
                }
                Some("command_execution") => {
                    let summary = truncate(str_field(item, "command").unwrap_or_default(), 200);
                    if completed {
                        let failed =
                            matches!(str_field(item, "status"), Some("failed" | "declined"))
                                || item
                                    .get("exit_code")
                                    .and_then(Value::as_i64)
                                    .is_some_and(|code| code != 0);
                        events.push(ChatEvent::ToolFinished {
                            item_id,
                            name: Some("command".to_string()),
                            summary: Some(summary),
                            output: bounded_output(
                                str_field(item, "aggregated_output").unwrap_or_default(),
                            ),
                            is_error: failed,
                        });
                    } else if kind == "item.started" {
                        events.push(ChatEvent::ToolStarted {
                            item_id,
                            name: "command".to_string(),
                            summary,
                        });
                    }
                }
                Some("file_change") => {
                    let changes = item
                        .get("changes")
                        .and_then(Value::as_array)
                        .map(|changes| {
                            changes
                                .iter()
                                .map(|change| {
                                    format!(
                                        "{} {}",
                                        str_field(change, "kind").unwrap_or("update"),
                                        str_field(change, "path").unwrap_or_default()
                                    )
                                })
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default();
                    let summary = truncate(&changes.join(", "), 200);
                    if completed {
                        events.push(ChatEvent::ToolFinished {
                            item_id,
                            name: Some("file_change".to_string()),
                            summary: Some(summary),
                            output: bounded_output(&changes.join("\n")),
                            is_error: str_field(item, "status") == Some("failed"),
                        });
                    } else if kind == "item.started" {
                        events.push(ChatEvent::ToolStarted {
                            item_id,
                            name: "file_change".to_string(),
                            summary,
                        });
                    }
                }
                Some("mcp_tool_call") => {
                    let summary = format!(
                        "{}/{}",
                        str_field(item, "server").unwrap_or_default(),
                        str_field(item, "tool").unwrap_or_default()
                    );
                    if completed {
                        let failed = str_field(item, "status") == Some("failed")
                            || item.get("error").is_some_and(|error| !error.is_null());
                        let output = item
                            .get("error")
                            .filter(|error| !error.is_null())
                            .or_else(|| item.get("result"))
                            .map(|output| match output {
                                Value::String(text) => text.clone(),
                                other => serde_json::to_string(other).unwrap_or_default(),
                            })
                            .unwrap_or_default();
                        events.push(ChatEvent::ToolFinished {
                            item_id,
                            name: Some("mcp".to_string()),
                            summary: Some(summary),
                            output: bounded_output(&output),
                            is_error: failed,
                        });
                    } else if kind == "item.started" {
                        events.push(ChatEvent::ToolStarted {
                            item_id,
                            name: "mcp".to_string(),
                            summary,
                        });
                    }
                }
                Some("web_search") => {
                    let summary = truncate(str_field(item, "query").unwrap_or_default(), 200);
                    if completed {
                        events.push(ChatEvent::ToolFinished {
                            item_id,
                            name: Some("web_search".to_string()),
                            summary: Some(summary),
                            output: String::new(),
                            is_error: false,
                        });
                    } else if kind == "item.started" {
                        events.push(ChatEvent::ToolStarted {
                            item_id,
                            name: "web_search".to_string(),
                            summary,
                        });
                    }
                }
                Some("todo_list") => {
                    let text = item
                        .get("items")
                        .and_then(Value::as_array)
                        .map(|items| {
                            items
                                .iter()
                                .map(|entry| {
                                    let done = entry
                                        .get("completed")
                                        .and_then(Value::as_bool)
                                        .unwrap_or(false);
                                    format!(
                                        "- [{}] {}",
                                        if done { "x" } else { " " },
                                        str_field(entry, "text").unwrap_or_default()
                                    )
                                })
                                .collect::<Vec<_>>()
                                .join("\n")
                        })
                        .unwrap_or_default();
                    if !text.is_empty() {
                        events.push(ChatEvent::Reasoning { item_id, text });
                    }
                }
                Some("error") => {
                    let message = truncate(str_field(item, "message").unwrap_or("error"), 2048);
                    state.error = Some(message.clone());
                    events.push(ChatEvent::Notice { message });
                }
                _ => {}
            }
        }
        Some("turn.completed") => {
            if let Some(usage) = value.get("usage") {
                state.usage = Some(ChatUsage {
                    input_tokens: u64_field(usage, "input_tokens"),
                    output_tokens: u64_field(usage, "output_tokens"),
                    cache_read_tokens: u64_field(usage, "cached_input_tokens"),
                    cache_write_tokens: u64_field(usage, "cache_write_input_tokens"),
                    reasoning_tokens: u64_field(usage, "reasoning_output_tokens"),
                });
            }
        }
        Some("turn.failed") => {
            let message = value
                .get("error")
                .and_then(|error| str_field(error, "message"))
                .unwrap_or("The turn failed.");
            state.error = Some(truncate(message, 2048));
        }
        Some("error") => {
            let message = truncate(str_field(value, "message").unwrap_or("error"), 2048);
            state.error = Some(message.clone());
            events.push(ChatEvent::Notice { message });
        }
        _ => {}
    }
    events
}

fn parse_gemini(state: &mut TurnState, value: &Value) -> Vec<ChatEvent> {
    let mut events = Vec::new();
    match str_field(value, "type") {
        Some("init") => {
            state.native_session_id = str_field(value, "session_id").map(str::to_string);
            events.push(ChatEvent::Started {
                native_session_id: state.native_session_id.clone(),
                model: str_field(value, "model").map(str::to_string),
            });
        }
        Some("message") if str_field(value, "role") == Some("assistant") => {
            let Some(content) = str_field(value, "content") else {
                return events;
            };
            if value.get("delta").and_then(Value::as_bool).unwrap_or(false) {
                events.push(ChatEvent::TextDelta {
                    item_id: "gemini-message".to_string(),
                    delta: content.to_string(),
                });
            } else {
                events.push(ChatEvent::Text {
                    item_id: "gemini-message".to_string(),
                    text: content.to_string(),
                });
            }
        }
        Some("tool_use") => {
            let name = str_field(value, "tool_name").unwrap_or("tool").to_string();
            let parameters = value.get("parameters").cloned().unwrap_or(Value::Null);
            events.push(ChatEvent::ToolStarted {
                item_id: str_field(value, "tool_id")
                    .map(str::to_string)
                    .unwrap_or_else(|| "gemini-tool".to_string()),
                summary: gemini_tool_summary(&name, &parameters),
                name,
            });
        }
        Some("tool_result") => {
            let output = value
                .get("output")
                .map(json_value_text)
                .filter(|text| !text.is_empty())
                .or_else(|| {
                    value
                        .get("error")
                        .and_then(|error| str_field(error, "message"))
                        .map(str::to_string)
                })
                .unwrap_or_default();
            events.push(ChatEvent::ToolFinished {
                item_id: str_field(value, "tool_id")
                    .map(str::to_string)
                    .unwrap_or_else(|| "gemini-tool".to_string()),
                name: None,
                summary: None,
                output: bounded_output(&output),
                is_error: str_field(value, "status") == Some("error")
                    || value.get("error").is_some_and(|error| !error.is_null()),
            });
        }
        Some("error") => {
            let message = truncate(
                str_field(value, "message").unwrap_or("Gemini CLI reported an error."),
                2048,
            );
            if str_field(value, "severity") == Some("error") {
                state.error = Some(message.clone());
            }
            events.push(ChatEvent::Notice { message });
        }
        Some("result") => {
            state.turn_complete = true;
            state.duration_ms = value
                .get("stats")
                .and_then(|stats| stats.get("duration_ms"))
                .and_then(Value::as_u64);
            if let Some(stats) = value.get("stats") {
                state.usage = Some(ChatUsage {
                    input_tokens: u64_field(stats, "input_tokens"),
                    output_tokens: u64_field(stats, "output_tokens"),
                    cache_read_tokens: u64_field(stats, "cached"),
                    cache_write_tokens: 0,
                    reasoning_tokens: 0,
                });
            }
            if str_field(value, "status") == Some("success") {
                state.error = None;
            } else if state.error.is_none() {
                state.error = Some("Gemini CLI reported an error.".to_string());
            }
        }
        _ => {}
    }
    events
}

fn gemini_tool_summary(name: &str, parameters: &Value) -> String {
    let keys: &[&str] = match name {
        "run_shell_command" => &["command"],
        "read_file" | "write_file" | "replace" => &["file_path", "path"],
        "glob" | "glob_search" => &["pattern"],
        "grep_search" => &["query", "pattern"],
        "web_fetch" => &["url"],
        "google_web_search" => &["query"],
        _ => &[],
    };
    let summary = keys
        .iter()
        .find_map(|key| str_field(parameters, key))
        .map(str::to_string)
        .unwrap_or_else(|| json_value_text(parameters));
    truncate(summary.lines().next().unwrap_or_default(), 200)
}

fn json_value_text(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        other => serde_json::to_string(other).unwrap_or_default(),
    }
}

fn bounded_output(output: &str) -> String {
    if output.len() <= MAX_TOOL_OUTPUT_BYTES {
        return output.to_string();
    }
    let cut = floor_char_boundary(output, MAX_TOOL_OUTPUT_BYTES);
    format!("{}\n…", &output[..cut])
}

fn truncate(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    let cut = floor_char_boundary(text, max);
    format!("{}…", &text[..cut])
}

fn floor_char_boundary(text: &str, index: usize) -> usize {
    let mut index = index.min(text.len());
    while index > 0 && !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(dialect: Dialect, raw: &str) -> (TurnState, Vec<ChatEvent>) {
        let mut state = TurnState::default();
        let mut events = Vec::new();
        for line in raw.lines() {
            events.extend(parse_line(dialect, &mut state, line));
        }
        (state, events)
    }

    #[test]
    fn claude_turn_streams_text_and_reports_the_session() {
        // Captured from `claude -p --output-format stream-json`.
        let raw = r#"{"type":"system","subtype":"init","cwd":"/tmp/x","session_id":"45c1fa68-4159-40f0-bd78-261718b2849f","model":"claude-fable-5-1","permissionMode":"plan"}
{"type":"stream_event","event":{"type":"message_start","message":{"model":"claude-fable-5-1","id":"msg_1","type":"message","role":"assistant","content":[]}},"session_id":"45c1fa68-4159-40f0-bd78-261718b2849f"}
{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"O"}}}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"K"}}}
{"type":"assistant","message":{"model":"claude-fable-5-1","id":"msg_1","type":"message","role":"assistant","content":[{"type":"text","text":"OK"}]},"session_id":"45c1fa68-4159-40f0-bd78-261718b2849f"}
{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}
{"type":"result","subtype":"success","is_error":false,"duration_ms":4000,"result":"OK","session_id":"45c1fa68-4159-40f0-bd78-261718b2849f","total_cost_usd":0.18,"usage":{"input_tokens":2,"cache_creation_input_tokens":9260,"cache_read_input_tokens":10007,"output_tokens":4,"output_tokens_details":{"thinking_tokens":0}}}"#;
        let (state, events) = lines(Dialect::Claude, raw);

        assert_eq!(
            events,
            vec![
                ChatEvent::Started {
                    native_session_id: Some("45c1fa68-4159-40f0-bd78-261718b2849f".into()),
                    model: Some("claude-fable-5-1".into()),
                },
                ChatEvent::TextDelta {
                    item_id: "msg_1#0".into(),
                    delta: "O".into(),
                },
                ChatEvent::TextDelta {
                    item_id: "msg_1#0".into(),
                    delta: "K".into(),
                },
                ChatEvent::Text {
                    item_id: "msg_1#0".into(),
                    text: "OK".into(),
                },
            ]
        );
        assert_eq!(state.cost_usd, Some(0.18));
        assert_eq!(state.duration_ms, Some(4000));
        assert_eq!(
            state.usage,
            Some(ChatUsage {
                input_tokens: 2,
                output_tokens: 4,
                cache_read_tokens: 10007,
                cache_write_tokens: 9260,
                reasoning_tokens: 0,
            })
        );
        assert!(state.error.is_none());
    }

    #[test]
    fn claude_tool_calls_pair_up_by_tool_use_id() {
        let raw = r#"{"type":"assistant","message":{"id":"msg_2","content":[{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"ls -la\n","description":"List"}}]}}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":[{"type":"text","text":"total 0"}],"is_error":false}]}}"#;
        let (_, events) = lines(Dialect::Claude, raw);

        assert_eq!(
            events,
            vec![
                ChatEvent::ToolStarted {
                    item_id: "toolu_1".into(),
                    name: "Bash".into(),
                    summary: "ls -la".into(),
                },
                ChatEvent::ToolFinished {
                    item_id: "toolu_1".into(),
                    name: None,
                    summary: None,
                    output: "total 0".into(),
                    is_error: false,
                },
            ]
        );
    }

    #[test]
    fn claude_approval_request_becomes_a_card_and_keeps_the_input() {
        // Captured from `claude -p --input-format stream-json
        // --permission-prompt-tool stdio`.
        let raw = r#"{"type":"control_request","request_id":"576cb46b-e252-44d9-b1ae-593998a16fdd","request":{"subtype":"can_use_tool","tool_name":"WebFetch","display_name":"WebFetch","input":{"url":"https://example.com","prompt":"What is the page title?"},"description":"https://example.com","permission_suggestions":[],"tool_use_id":"toolu_013DU387kSreb3xCEejeof6e"}}
{"type":"control_response","response":{"subtype":"success","request_id":"latticeterm-init","response":{"commands":[]}}}"#;
        let (state, events) = lines(Dialect::Claude, raw);

        assert_eq!(
            events,
            vec![ChatEvent::ApprovalRequested {
                request_id: "576cb46b-e252-44d9-b1ae-593998a16fdd".into(),
                tool_use_id: Some("toolu_013DU387kSreb3xCEejeof6e".into()),
                name: "WebFetch".into(),
                summary: "https://example.com".into(),
                // serde_json writes object keys in sorted order.
                input: "{\n  \"prompt\": \"What is the page title?\",\n  \"url\": \"https://example.com\"\n}".into(),
            }]
        );
        assert_eq!(state.pending_inputs.len(), 1);
        assert_eq!(
            state.pending_inputs[0].0,
            "576cb46b-e252-44d9-b1ae-593998a16fdd"
        );
        assert!(!state.turn_complete);
    }

    #[test]
    fn a_result_marks_the_turn_complete_so_stdin_can_close() {
        let (state, _) = lines(
            Dialect::Claude,
            r#"{"type":"result","subtype":"success","is_error":false,"session_id":"s"}"#,
        );
        assert!(state.turn_complete);
    }

    #[test]
    fn control_responses_match_what_the_cli_expects() {
        let allow: Value = serde_json::from_str(&control_response_line(
            "req-1",
            true,
            Some(serde_json::json!({"command": "ls"})),
            None,
        ))
        .unwrap();
        assert_eq!(allow["type"], "control_response");
        assert_eq!(allow["response"]["subtype"], "success");
        assert_eq!(allow["response"]["request_id"], "req-1");
        assert_eq!(allow["response"]["response"]["behavior"], "allow");
        assert_eq!(
            allow["response"]["response"]["updatedInput"]["command"],
            "ls"
        );

        let deny: Value =
            serde_json::from_str(&control_response_line("req-2", false, None, Some("no"))).unwrap();
        assert_eq!(deny["response"]["response"]["behavior"], "deny");
        assert_eq!(deny["response"]["response"]["message"], "no");
    }

    #[test]
    fn the_interactive_opening_is_a_handshake_then_the_prompt() {
        let lines = interactive_opening_lines("hi");
        let init: Value = serde_json::from_str(&lines[0]).unwrap();
        let user: Value = serde_json::from_str(&lines[1]).unwrap();
        assert_eq!(init["request"]["subtype"], "initialize");
        assert_eq!(user["type"], "user");
        assert_eq!(user["message"]["content"][0]["text"], "hi");
    }

    #[test]
    fn ask_mode_makes_claude_bidirectional() {
        let args = turn_arguments(
            Dialect::Claude,
            Path::new("/work"),
            ChatPermission::Ask,
            None,
            None,
        );
        assert!(args.contains(&OsString::from("manual")));
        assert!(args.contains(&OsString::from("--input-format")));
        assert!(args.contains(&OsString::from("--permission-prompt-tool")));
    }

    #[test]
    fn ask_mode_is_refused_for_a_cli_that_cannot_ask() {
        let (tx, _rx) = std::sync::mpsc::channel();
        let error = tauri::async_runtime::block_on(send(
            Arc::new(RecordingSink(tx)),
            Arc::new(AgentChatRegistry::new()),
            ChatTurnRequest {
                thread_id: "t".into(),
                turn_id: "u".into(),
                definition_id: "codex".into(),
                working_directory: "/".into(),
                prompt: "hi".into(),
                permission: ChatPermission::Ask,
                model: None,
                native_session_id: None,
            },
        ))
        .unwrap_err();
        assert!(error.contains("approval"), "{error}");
    }

    #[test]
    fn answering_without_a_pending_approval_is_refused() {
        let registry = Arc::new(AgentChatRegistry::new());
        let error =
            tauri::async_runtime::block_on(respond(registry, "t", "r", true, None)).unwrap_err();
        assert!(error.contains("not waiting"), "{error}");
    }

    #[test]
    fn claude_models_come_from_the_initialize_reply() {
        let reply: Value = serde_json::json!({
            "type": "control_response",
            "response": {"subtype": "success", "request_id": "latticeterm-models", "response": {
                "models": [
                    {"value": "default", "displayName": "Default (recommended)", "description": "Opus 5"},
                    {"value": "opus[1m]", "displayName": "Opus (1M context)"},
                    {"value": "haiku", "displayName": "Haiku", "description": "Fastest"}
                ]
            }}
        });
        let models = models_from_reply(Dialect::Claude, &reply, "latticeterm-models").unwrap();
        assert_eq!(models.len(), 3);
        assert_eq!(models[0].value, "");
        assert!(models[0].is_default);
        assert_eq!(models[1].value, "opus[1m]");
        assert!(validate_model(&models[1].value).is_ok());
        assert_eq!(models[2].description.as_deref(), Some("Fastest"));
        // A reply to something else is not the list.
        let other: Value = serde_json::json!({"type": "control_response", "response": {"request_id": "x", "response": {"models": []}}});
        assert!(models_from_reply(Dialect::Claude, &other, "latticeterm-models").is_none());
    }

    #[test]
    fn codex_models_come_from_the_model_list_reply_and_skip_hidden_ones() {
        let reply: Value = serde_json::json!({"id": 2, "result": {"data": [
            {"id": "gpt-5.6-sol", "displayName": "GPT-5.6-Sol", "description": "Workhorse", "hidden": false, "isDefault": true},
            {"id": "secret", "displayName": "Hidden", "hidden": true},
            {"id": "gpt-5.6-terra", "displayName": "GPT-5.6-Terra"}
        ]}});
        let models = models_from_reply(Dialect::Codex, &reply, "2").unwrap();
        assert_eq!(models.len(), 2);
        assert!(models[0].is_default);
        assert_eq!(models[1].value, "gpt-5.6-terra");
        assert!(models_from_reply(
            Dialect::Codex,
            &serde_json::json!({"id": 1, "result": {}}),
            "2"
        )
        .is_none());
    }

    #[test]
    fn gemini_uses_its_documented_routing_aliases() {
        assert_eq!(supported_definitions(), ["claude", "codex", "gemini"]);
        let models = gemini_model_choices();
        assert_eq!(models[0].value, "");
        assert!(models[0].is_default);
        assert_eq!(
            models
                .iter()
                .map(|model| model.value.as_str())
                .collect::<Vec<_>>(),
            ["", "pro", "flash", "flash-lite"]
        );
    }

    #[test]
    fn claude_startups_share_one_oauth_gate() {
        let registry = Arc::new(AgentChatRegistry::new());
        tauri::async_runtime::block_on(async {
            assert!(registry.startup_guard(Dialect::Codex).await.is_none());
            let first = registry
                .startup_guard(Dialect::Claude)
                .await
                .expect("Claude uses the startup gate");
            assert!(Arc::clone(&registry.claude_startup)
                .try_lock_owned()
                .is_err());
            drop(first);
            assert!(Arc::clone(&registry.claude_startup)
                .try_lock_owned()
                .is_ok());
        });
    }

    #[test]
    fn only_the_transient_claude_oauth_lock_error_is_retried() {
        let transient = "Failed to refresh OAuth token: another Claude Code process is refreshing it or exited mid-refresh.";
        assert!(is_claude_oauth_refresh_busy(transient));
        assert!(is_claude_oauth_refresh_busy(
            "FAILED TO REFRESH OAUTH TOKEN: ANOTHER CLAUDE CODE PROCESS IS REFRESHING IT OR EXITED MID-REFRESH"
        ));
        assert!(!is_claude_oauth_refresh_busy(
            "OAuth token has expired - Please run /login"
        ));
        assert!(should_retry_claude_oauth(
            Dialect::Claude,
            false,
            0,
            Some(transient)
        ));
        assert!(!should_retry_claude_oauth(
            Dialect::Claude,
            true,
            0,
            Some(transient)
        ));
        assert!(!should_retry_claude_oauth(
            Dialect::Codex,
            false,
            0,
            Some(transient)
        ));
        assert!(!should_retry_claude_oauth(
            Dialect::Claude,
            false,
            CLAUDE_OAUTH_RETRY_DELAYS_MS.len(),
            Some(transient)
        ));
    }

    /// Asks a real CLI for its models. Ignored: needs the CLI installed and
    /// logged in. `LATTICETERM_CHAT_E2E=claude|codex|gemini cargo test list_models -- --ignored`.
    #[test]
    #[ignore]
    fn a_real_cli_lists_its_models() {
        let definition_id =
            std::env::var("LATTICETERM_CHAT_E2E").unwrap_or_else(|_| "claude".to_string());
        let models = tauri::async_runtime::block_on(list_models(
            Arc::new(AgentChatRegistry::new()),
            &definition_id,
        ))
        .expect("models");
        assert!(!models.is_empty());
        assert!(models.iter().any(|model| model.is_default), "{models:?}");
    }

    #[test]
    fn claude_error_result_ends_the_turn_with_its_message() {
        let raw = r#"{"type":"result","subtype":"error_during_execution","is_error":true,"errors":["Not logged in"],"session_id":"s"}"#;
        let (state, _) = lines(Dialect::Claude, raw);
        assert_eq!(state.error.as_deref(), Some("Not logged in"));
    }

    #[test]
    fn codex_turn_reports_thread_and_usage() {
        // Captured from `codex exec --json`.
        let raw = r#"{"type":"thread.started","thread_id":"01a0654c-48dc-77a1-9eef-af49ff5ec3c3"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"I’ll run the requested command."}}
{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"echo hi","status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"echo hi","aggregated_output":"hi\n","exit_code":0,"status":"completed"}}
{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"OK"}}
{"type":"turn.completed","usage":{"input_tokens":39633,"cached_input_tokens":30208,"cache_write_input_tokens":0,"output_tokens":185,"reasoning_output_tokens":66}}"#;
        let (state, events) = lines(Dialect::Codex, raw);

        assert_eq!(
            events[0],
            ChatEvent::Started {
                native_session_id: Some("01a0654c-48dc-77a1-9eef-af49ff5ec3c3".into()),
                model: None,
            }
        );
        assert_eq!(
            events[2],
            ChatEvent::ToolStarted {
                item_id: "item_1".into(),
                name: "command".into(),
                summary: "echo hi".into(),
            }
        );
        assert_eq!(
            events[3],
            ChatEvent::ToolFinished {
                item_id: "item_1".into(),
                name: Some("command".into()),
                summary: Some("echo hi".into()),
                output: "hi\n".into(),
                is_error: false,
            }
        );
        assert_eq!(
            events[4],
            ChatEvent::Text {
                item_id: "item_2".into(),
                text: "OK".into(),
            }
        );
        assert_eq!(
            state.usage,
            Some(ChatUsage {
                input_tokens: 39633,
                output_tokens: 185,
                cache_read_tokens: 30208,
                cache_write_tokens: 0,
                reasoning_tokens: 66,
            })
        );
    }

    #[test]
    fn codex_failed_turn_carries_its_error() {
        let raw = r#"{"type":"turn.failed","error":{"message":"Model overloaded"}}"#;
        let (state, _) = lines(Dialect::Codex, raw);
        assert_eq!(state.error.as_deref(), Some("Model overloaded"));
    }

    #[test]
    fn gemini_stream_reports_text_tools_usage_and_session() {
        // Captured shape from Gemini CLI's documented stream-json protocol.
        let raw = r#"{"type":"init","timestamp":"2026-09-03T00:00:00Z","session_id":"87cc4aa7-b190-4a9d-a709-b7f9f9c90001","model":"gemini-2.5-flash"}
{"type":"message","timestamp":"2026-09-03T00:00:01Z","role":"assistant","content":"I will inspect it.","delta":true}
{"type":"tool_use","timestamp":"2026-09-03T00:00:02Z","tool_name":"read_file","tool_id":"tool-1","parameters":{"file_path":"/work/README.md"}}
{"type":"tool_result","timestamp":"2026-09-03T00:00:03Z","tool_id":"tool-1","status":"success","output":"hello"}
{"type":"message","timestamp":"2026-09-03T00:00:04Z","role":"assistant","content":" Done.","delta":true}
{"type":"result","timestamp":"2026-09-03T00:00:05Z","status":"success","stats":{"input_tokens":21,"output_tokens":7,"cached":3,"duration_ms":1200}}"#;
        let (state, events) = lines(Dialect::Gemini, raw);

        assert_eq!(
            events[0],
            ChatEvent::Started {
                native_session_id: Some("87cc4aa7-b190-4a9d-a709-b7f9f9c90001".to_string()),
                model: Some("gemini-2.5-flash".to_string()),
            }
        );
        assert_eq!(
            events[2],
            ChatEvent::ToolStarted {
                item_id: "tool-1".to_string(),
                name: "read_file".to_string(),
                summary: "/work/README.md".to_string(),
            }
        );
        assert_eq!(
            events[3],
            ChatEvent::ToolFinished {
                item_id: "tool-1".to_string(),
                name: None,
                summary: None,
                output: "hello".to_string(),
                is_error: false,
            }
        );
        assert_eq!(
            state.usage,
            Some(ChatUsage {
                input_tokens: 21,
                output_tokens: 7,
                cache_read_tokens: 3,
                cache_write_tokens: 0,
                reasoning_tokens: 0,
            })
        );
        assert_eq!(state.duration_ms, Some(1200));
        assert!(state.turn_complete);
        assert!(state.error.is_none());
    }

    #[test]
    fn a_plain_text_line_becomes_a_notice_not_a_crash() {
        let (_, events) = lines(Dialect::Codex, "warning: something\n");
        assert_eq!(
            events,
            vec![ChatEvent::Notice {
                message: "warning: something".into()
            }]
        );
    }

    #[test]
    fn claude_arguments_put_the_prompt_on_stdin_and_resume_by_id() {
        let args = turn_arguments(
            Dialect::Claude,
            Path::new("/work"),
            ChatPermission::WorkspaceWrite,
            Some("opus"),
            Some("abc-123"),
        );
        let args: Vec<String> = args
            .into_iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            args,
            vec![
                "-p",
                "--output-format",
                "stream-json",
                "--verbose",
                "--include-partial-messages",
                "--permission-mode",
                "acceptEdits",
                "--model",
                "opus",
                "--resume",
                "abc-123",
            ]
        );
    }

    #[test]
    fn codex_arguments_resume_without_changing_the_model() {
        let args = turn_arguments(
            Dialect::Codex,
            Path::new("/work"),
            ChatPermission::ReadOnly,
            Some("gpt-5"),
            Some("thread-1"),
        );
        let args: Vec<String> = args
            .into_iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            args,
            vec![
                "exec",
                "--json",
                "--skip-git-repo-check",
                "-C",
                "/work",
                "-s",
                "read-only",
                "resume",
                "thread-1",
                "-",
            ]
        );
        assert!(!args.contains(&"-m".to_string()));
    }

    #[test]
    fn codex_full_permission_uses_the_explicit_bypass_flag() {
        let args = turn_arguments(
            Dialect::Codex,
            Path::new("/work"),
            ChatPermission::Full,
            None,
            None,
        );
        assert!(args.contains(&OsString::from(
            "--dangerously-bypass-approvals-and-sandbox"
        )));
        assert_eq!(args.last(), Some(&OsString::from("-")));
    }

    #[test]
    fn gemini_arguments_keep_the_prompt_on_stdin_and_map_permissions() {
        let args = turn_arguments(
            Dialect::Gemini,
            Path::new("/work"),
            ChatPermission::WorkspaceWrite,
            Some("flash"),
            Some("87cc4aa7-b190-4a9d-a709-b7f9f9c90001"),
        );
        let args: Vec<String> = args
            .into_iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            args,
            [
                "--output-format",
                "stream-json",
                "--approval-mode",
                "auto_edit",
                "--model",
                "flash",
                "--resume",
                "87cc4aa7-b190-4a9d-a709-b7f9f9c90001",
            ]
        );
        assert!(!args.iter().any(|argument| argument.contains("prompt")));
    }

    #[test]
    fn identifiers_and_models_are_checked_before_they_reach_a_command_line() {
        assert!(validate_id("thread-1_a", "thread id").is_ok());
        assert!(validate_id("", "thread id").is_err());
        assert!(validate_id("a/b", "thread id").is_err());
        assert!(validate_model("claude-opus-5").is_ok());
        assert!(validate_model("-p").is_err());
        assert!(validate_model("a b").is_err());
        assert!(validate_native_session_id("01a0654c-48dc-77a1-9eef-af49ff5ec3c3").is_ok());
        assert!(validate_native_session_id("--last").is_err());
    }

    #[test]
    fn tool_output_is_bounded_on_a_character_boundary() {
        let long = "字".repeat(MAX_TOOL_OUTPUT_BYTES);
        let bounded = bounded_output(&long);
        assert!(bounded.len() <= MAX_TOOL_OUTPUT_BYTES + 4);
        assert!(bounded.ends_with('…'));
    }

    #[tokio::test]
    async fn an_oversized_line_is_skipped_and_the_next_one_still_reads() {
        let long = "x".repeat(MAX_LINE_BYTES + 1);
        let input = format!("{long}\nshort\n");
        let mut reader = BufReader::new(input.as_bytes());
        let mut line = Vec::new();
        assert!(matches!(
            read_bounded_line(&mut reader, &mut line).await,
            Err(LineError::TooLong)
        ));
        line.clear();
        assert!(read_bounded_line(&mut reader, &mut line).await.is_ok());
        assert_eq!(line, b"short\n");
    }

    struct RecordingSink(std::sync::mpsc::Sender<ChatEvent>);

    impl ChatSink for RecordingSink {
        fn event(&self, _thread_id: &str, _turn_id: &str, event: ChatEvent) {
            let _ = self.0.send(event);
        }
    }

    /// Runs one real turn through an installed CLI. Ignored by default: it
    /// needs the CLI logged in and spends a small amount of the user's
    /// quota. Run with `LATTICETERM_CHAT_E2E=claude cargo test -- --ignored`.
    /// Runs one real Claude turn in ask mode: the CLI must raise an approval
    /// for WebFetch (a tool no default rule allows), the test allows it
    /// through `respond`, and the turn must then finish on its own. Run with
    /// `LATTICETERM_CHAT_E2E=claude cargo test a_real_ask -- --ignored`.
    #[test]
    #[ignore]
    fn a_real_ask_turn_waits_for_the_answer_and_then_finishes() {
        let workdir = tempfile::tempdir().expect("tempdir");
        let (tx, rx) = std::sync::mpsc::channel();
        let registry = Arc::new(AgentChatRegistry::new());
        tauri::async_runtime::block_on(send(
            Arc::new(RecordingSink(tx)),
            Arc::clone(&registry),
            ChatTurnRequest {
                thread_id: "e2e-ask".into(),
                turn_id: "e2e-ask-turn".into(),
                definition_id: "claude".into(),
                working_directory: workdir.path().display().to_string(),
                prompt: "Use the WebFetch tool on https://example.com to get the page title, then reply with the single word DONE.".into(),
                permission: ChatPermission::Ask,
                model: None,
                native_session_id: None,
            },
        ))
        .expect("turn starts");

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(240);
        let mut answered = false;
        let mut finished = None;
        while finished.is_none() {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            match rx.recv_timeout(remaining) {
                Ok(ChatEvent::ApprovalRequested {
                    request_id, name, ..
                }) => {
                    assert_eq!(name, "WebFetch");
                    tauri::async_runtime::block_on(respond(
                        Arc::clone(&registry),
                        "e2e-ask",
                        &request_id,
                        true,
                        None,
                    ))
                    .expect("answer is delivered");
                    answered = true;
                }
                Ok(ChatEvent::Finished { error, .. }) => finished = Some(error),
                Ok(_) => {}
                Err(_) => panic!("no Finished event within the deadline"),
            }
        }
        assert!(answered, "the CLI never asked for approval");
        assert_eq!(finished, Some(None), "turn failed");
        assert!(
            registry.lock().is_empty(),
            "the finished turn was not released"
        );
    }

    #[test]
    #[ignore]
    fn a_real_turn_streams_a_reply_and_reports_the_session() {
        let definition_id =
            std::env::var("LATTICETERM_CHAT_E2E").unwrap_or_else(|_| "claude".to_string());
        let workdir = tempfile::tempdir().expect("tempdir");
        let (tx, rx) = std::sync::mpsc::channel();
        let registry = Arc::new(AgentChatRegistry::new());
        tauri::async_runtime::block_on(send(
            Arc::new(RecordingSink(tx)),
            Arc::clone(&registry),
            ChatTurnRequest {
                thread_id: "e2e-thread".into(),
                turn_id: "e2e-turn".into(),
                definition_id,
                working_directory: workdir.path().display().to_string(),
                prompt: "Reply with exactly the word OK and nothing else.".into(),
                permission: ChatPermission::ReadOnly,
                model: None,
                native_session_id: None,
            },
        ))
        .expect("turn starts");

        let mut events = Vec::new();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(180);
        loop {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            match rx.recv_timeout(remaining) {
                Ok(event) => {
                    let finished = matches!(event, ChatEvent::Finished { .. });
                    events.push(event);
                    if finished {
                        break;
                    }
                }
                Err(_) => panic!("no Finished event within the deadline; got {events:?}"),
            }
        }

        let text: String = events
            .iter()
            .filter_map(|event| match event {
                ChatEvent::Text { text, .. } => Some(text.as_str()),
                _ => None,
            })
            .collect();
        assert!(
            text.contains("OK"),
            "reply text was {text:?}; events {events:?}"
        );
        match events.last() {
            Some(ChatEvent::Finished {
                native_session_id,
                error,
                ..
            }) => {
                assert!(error.is_none(), "turn failed: {error:?}");
                assert!(native_session_id.is_some(), "no session id to resume with");
            }
            other => panic!("unexpected final event {other:?}"),
        }
        assert!(
            registry.lock().is_empty(),
            "the finished turn was not released"
        );
    }
}
