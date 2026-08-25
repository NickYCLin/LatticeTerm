//! Reading a CLI's own conversation history off disk.
//!
//! Different agent CLIs can't share memory, but each writes its conversation to
//! a structured file. Reading the source CLI's transcript and handing it to a
//! new CLI as an opening brief is the closest thing to "carrying the memory
//! over": the target sees the actual exchange and can continue from it.
//!
//! Only CLIs whose on-disk format is verified are supported; everything else
//! returns `None` so the caller can fall back to a plain, memory-less launch.

use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

/// CLIs whose transcript layout we know how to read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TranscriptKind {
    /// `~/.claude/projects/<cwd-slug>/<session>.jsonl`
    Claude,
    /// `~/.codex/sessions/YYYY/MM/DD/rollout-*-<session>.jsonl`
    Codex,
}

impl TranscriptKind {
    pub fn from_definition(definition_id: &str) -> Option<Self> {
        match definition_id {
            "claude" => Some(Self::Claude),
            "codex" => Some(Self::Codex),
            _ => None,
        }
    }
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// Claude names each project folder after its working directory with the path
/// separators and drive colon flattened to dashes (`C:\Users\me` → `C--Users-me`).
fn claude_slug(working_directory: &str) -> String {
    working_directory
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' => '-',
            other => other,
        })
        .collect()
}

/// The most recently modified file in `dir` for which `keep` holds.
fn newest_matching(dir: &Path, keep: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let Ok(entries) = fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                stack.push(path);
                continue;
            }
            if !keep(&path) {
                continue;
            }
            let modified = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
            if best.as_ref().is_none_or(|(best_time, _)| modified > *best_time) {
                best = Some((modified, path));
            }
        }
    }
    best.map(|(_, path)| path)
}

/// Keeps only the last `max_chars` characters, marking the cut so the reader
/// knows earlier turns were dropped.
fn tail(mut text: String, max_chars: usize) -> String {
    let count = text.chars().count();
    if count <= max_chars {
        return text;
    }
    let skip = count - max_chars;
    text = text.chars().skip(skip).collect();
    format!("…（更早的對話已略過）…\n\n{text}")
}

/// Flattens a Claude/Codex content value (string, or an array of typed blocks)
/// into the plain text a human wrote or read, dropping tool calls and images.
fn content_text(content: &Value) -> String {
    if let Some(text) = content.as_str() {
        return text.trim().to_string();
    }
    let Some(items) = content.as_array() else {
        return String::new();
    };
    let mut parts = Vec::new();
    for item in items {
        let kind = item.get("type").and_then(Value::as_str).unwrap_or("");
        if matches!(kind, "text" | "input_text" | "output_text") {
            if let Some(text) = item.get("text").and_then(Value::as_str) {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    parts.push(trimmed.to_string());
                }
            }
        }
    }
    parts.join("\n")
}

fn push_turn(out: &mut String, role: &str, text: &str) {
    if text.is_empty() {
        return;
    }
    let label = match role {
        "user" => "【使用者】",
        "assistant" => "【助理】",
        _ => return,
    };
    out.push_str(label);
    out.push('\n');
    out.push_str(text);
    out.push_str("\n\n");
}

fn parse_claude(path: &Path, max_chars: usize) -> Option<String> {
    let raw = fs::read_to_string(path).ok()?;
    let mut out = String::new();
    for line in raw.lines() {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let kind = value.get("type").and_then(Value::as_str).unwrap_or("");
        if kind != "user" && kind != "assistant" {
            continue;
        }
        let message = value.get("message");
        let role = message
            .and_then(|m| m.get("role"))
            .and_then(Value::as_str)
            .unwrap_or(kind);
        let text = message
            .and_then(|m| m.get("content"))
            .map(content_text)
            .unwrap_or_default();
        push_turn(&mut out, role, &text);
    }
    let trimmed = out.trim().to_string();
    (!trimmed.is_empty()).then(|| tail(trimmed, max_chars))
}

fn parse_codex(path: &Path, max_chars: usize) -> Option<String> {
    let raw = fs::read_to_string(path).ok()?;
    let mut out = String::new();
    for line in raw.lines() {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        // Conversation turns live in the payload; skip meta, tool and world rows.
        let Some(payload) = value.get("payload") else {
            continue;
        };
        if payload.get("type").and_then(Value::as_str) != Some("message") {
            continue;
        }
        let role = payload.get("role").and_then(Value::as_str).unwrap_or("");
        if role != "user" && role != "assistant" {
            continue;
        }
        let text = payload
            .get("content")
            .map(content_text)
            .unwrap_or_default();
        push_turn(&mut out, role, &text);
    }
    let trimmed = out.trim().to_string();
    (!trimmed.is_empty()).then(|| tail(trimmed, max_chars))
}

fn locate_claude(working_directory: &str, captured: Option<&str>) -> Option<PathBuf> {
    let dir = home()?
        .join(".claude")
        .join("projects")
        .join(claude_slug(working_directory));
    if let Some(id) = captured {
        let direct = dir.join(format!("{id}.jsonl"));
        if direct.is_file() {
            return Some(direct);
        }
    }
    // Fall back to the newest top-level session file (a subagents/ child is not
    // the main conversation, so keep only files that sit directly in the dir).
    newest_matching(&dir, |path| {
        path.extension().is_some_and(|ext| ext == "jsonl")
            && path.parent() == Some(dir.as_path())
    })
}

fn locate_codex(captured: Option<&str>) -> Option<PathBuf> {
    let root = home()?.join(".codex").join("sessions");
    if let Some(id) = captured {
        if let Some(found) = newest_matching(&root, |path| {
            path.to_string_lossy().contains(id)
                && path.extension().is_some_and(|ext| ext == "jsonl")
        }) {
            return Some(found);
        }
    }
    newest_matching(&root, |path| {
        path.file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("rollout-"))
            && path.extension().is_some_and(|ext| ext == "jsonl")
    })
}

/// Reads the source CLI's most relevant conversation and returns it as plain,
/// role-labelled text capped at `max_chars`, or `None` when nothing is found.
pub fn export(
    kind: TranscriptKind,
    working_directory: &str,
    captured_session_id: Option<&str>,
    max_chars: usize,
) -> Option<String> {
    match kind {
        TranscriptKind::Claude => {
            let path = locate_claude(working_directory, captured_session_id)?;
            parse_claude(&path, max_chars)
        }
        TranscriptKind::Codex => {
            let path = locate_codex(captured_session_id)?;
            parse_codex(&path, max_chars)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_slug_flattens_windows_paths() {
        assert_eq!(claude_slug(r"C:\Users\nicklin"), "C--Users-nicklin");
        assert_eq!(claude_slug("/home/me/app"), "-home-me-app");
    }

    #[test]
    fn content_text_reads_strings_and_text_blocks() {
        assert_eq!(content_text(&Value::String("hi".into())), "hi");
        let blocks = serde_json::json!([
            {"type": "text", "text": "keep me"},
            {"type": "tool_use", "name": "bash"},
            {"type": "output_text", "text": "and me"},
        ]);
        assert_eq!(content_text(&blocks), "keep me\nand me");
    }

    #[test]
    fn tail_marks_a_truncation() {
        assert_eq!(tail("abcdef".into(), 10), "abcdef");
        assert!(tail("abcdef".into(), 3).contains("def"));
        assert!(tail("abcdef".into(), 3).contains("略過"));
    }

    #[test]
    fn claude_transcript_extracts_user_and_assistant_turns() {
        let dir = tempfile::tempdir().unwrap();
        let slug = claude_slug(dir.path().to_str().unwrap());
        let projects = dir.path().join(".claude").join("projects").join(&slug);
        fs::create_dir_all(&projects).unwrap();
        let jsonl = [
            r#"{"type":"mode","sessionId":"s"}"#,
            r#"{"type":"user","message":{"role":"user","content":"重構 payments"}}"#,
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"好的"},{"type":"tool_use","name":"bash"}]}}"#,
        ]
        .join("\n");
        fs::write(projects.join("abc.jsonl"), jsonl).unwrap();

        let text = parse_claude(&projects.join("abc.jsonl"), 5000).unwrap();
        assert!(text.contains("【使用者】"));
        assert!(text.contains("重構 payments"));
        assert!(text.contains("【助理】"));
        assert!(text.contains("好的"));
        assert!(!text.contains("bash"));
    }

    #[test]
    fn codex_transcript_reads_payload_messages_only() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("rollout-x.jsonl");
        let jsonl = [
            r#"{"type":"session_meta","payload":{"cwd":"/x"}}"#,
            r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"問題一"}]}}"#,
            r#"{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"答案一"}]}}"#,
            r#"{"type":"event_msg","payload":{"type":"reasoning"}}"#,
        ]
        .join("\n");
        fs::write(&file, jsonl).unwrap();

        let text = parse_codex(&file, 5000).unwrap();
        assert!(text.contains("問題一"));
        assert!(text.contains("答案一"));
        assert!(!text.contains("reasoning"));
    }
}
