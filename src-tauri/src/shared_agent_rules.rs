//! Project-scoped instructions shared by Codex, Claude Code, and Gemini CLI.
//!
//! `AGENTS.md` is the canonical file. The other files keep their native names
//! and import it through a small LatticeTerm-managed block. Existing content
//! outside that block is never rewritten.

use base64::Engine;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

pub const MAX_SHARED_RULES_BYTES: usize = 32 * 1024;
const MAX_ADAPTER_BYTES: usize = 256 * 1024;
const MANAGED_START: &str = "<!-- LatticeTerm shared AI rules: start -->";
const MANAGED_END: &str = "<!-- LatticeTerm shared AI rules: end -->";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedAgentRulesFile {
    pub cli: String,
    pub file_name: String,
    pub path: String,
    pub state: SharedAgentRulesFileState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SharedAgentRulesFileState {
    Missing,
    Synced,
    NeedsSync,
    ManualReview,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedAgentRulesSnapshot {
    pub project_directory: String,
    pub content: String,
    pub revision: String,
    pub files: Vec<SharedAgentRulesFile>,
}

#[derive(Debug)]
struct ProjectFiles {
    directory: PathBuf,
    agents: Option<String>,
    claude: Option<String>,
    gemini: Option<String>,
    revision: String,
}

#[derive(Debug, Clone, Copy)]
enum Adapter {
    Claude,
    Gemini,
}

impl Adapter {
    fn cli(self) -> &'static str {
        match self {
            Self::Claude => "Claude",
            Self::Gemini => "Gemini",
        }
    }

    fn file_name(self) -> &'static str {
        match self {
            Self::Claude => "CLAUDE.md",
            Self::Gemini => "GEMINI.md",
        }
    }

    fn import(self) -> &'static str {
        match self {
            Self::Claude => "@AGENTS.md",
            Self::Gemini => "@./AGENTS.md",
        }
    }
}

pub fn inspect(project_directory: &str) -> Result<SharedAgentRulesSnapshot, String> {
    snapshot(read_project(project_directory)?)
}

pub fn save(
    project_directory: &str,
    content: &str,
    expected_revision: &str,
) -> Result<SharedAgentRulesSnapshot, String> {
    if expected_revision.trim().is_empty() || expected_revision.trim() != expected_revision {
        return Err(
            "A valid shared-rules revision is required. Reload the project first.".to_string(),
        );
    }
    let content = normalize_rules(content)?;
    let current = read_project(project_directory)?;
    if current.revision != expected_revision {
        return Err(
            "Shared AI rule files changed outside LatticeTerm. Reload them before saving."
                .to_string(),
        );
    }

    let claude = update_adapter(current.claude.as_deref(), Adapter::Claude)?;
    let gemini = update_adapter(current.gemini.as_deref(), Adapter::Gemini)?;
    let targets = [
        (current.directory.join("AGENTS.md"), content),
        (current.directory.join("CLAUDE.md"), claude),
        (current.directory.join("GEMINI.md"), gemini),
    ];
    let changes: Vec<_> = targets
        .into_iter()
        .filter(|(path, next)| {
            fs::read_to_string(path)
                .map(|existing| existing != *next)
                .unwrap_or(true)
        })
        .collect();

    if !changes.is_empty() {
        write_transaction(&current.directory, changes, expected_revision)?;
    }
    snapshot(read_project(current.directory.to_string_lossy().as_ref())?)
}

fn canonical_project_directory(value: &str) -> Result<PathBuf, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("A project directory is required.".to_string());
    }
    let requested = Path::new(value);
    if !requested.is_absolute() {
        return Err("The project directory must be an absolute path.".to_string());
    }
    let directory = fs::canonicalize(requested).map_err(|error| {
        format!(
            "Cannot open project directory '{}': {error}",
            requested.display()
        )
    })?;
    if !directory.is_dir() {
        return Err(format!("'{}' is not a directory.", directory.display()));
    }
    Ok(directory)
}

fn read_project(project_directory: &str) -> Result<ProjectFiles, String> {
    let directory = canonical_project_directory(project_directory)?;
    let agents_path = directory.join("AGENTS.md");
    let claude_path = directory.join("CLAUDE.md");
    let gemini_path = directory.join("GEMINI.md");
    let agents_raw = read_optional(&agents_path, MAX_SHARED_RULES_BYTES)?;
    let claude_raw = read_optional(&claude_path, MAX_ADAPTER_BYTES)?;
    let gemini_raw = read_optional(&gemini_path, MAX_ADAPTER_BYTES)?;
    let revision = revision([
        ("AGENTS.md", agents_raw.as_deref()),
        ("CLAUDE.md", claude_raw.as_deref()),
        ("GEMINI.md", gemini_raw.as_deref()),
    ]);

    Ok(ProjectFiles {
        directory,
        agents: to_utf8(agents_raw, "AGENTS.md")?,
        claude: to_utf8(claude_raw, "CLAUDE.md")?,
        gemini: to_utf8(gemini_raw, "GEMINI.md")?,
        revision,
    })
}

fn read_optional(path: &Path, limit: usize) -> Result<Option<Vec<u8>>, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Cannot inspect '{}': {error}", path.display())),
    };
    if metadata.file_type().is_symlink() {
        return Err(format!(
            "'{}' is a symbolic link. LatticeTerm will not replace linked instruction files.",
            path.display()
        ));
    }
    if !metadata.is_file() {
        return Err(format!("'{}' is not a regular file.", path.display()));
    }
    if metadata.len() > limit as u64 {
        return Err(format!(
            "'{}' is too large (maximum {limit} bytes).",
            path.display()
        ));
    }
    fs::read(path)
        .map(Some)
        .map_err(|error| format!("Cannot read '{}': {error}", path.display()))
}

fn to_utf8(value: Option<Vec<u8>>, file_name: &str) -> Result<Option<String>, String> {
    value
        .map(|bytes| {
            String::from_utf8(bytes)
                .map_err(|_| format!("{file_name} is not valid UTF-8 and was not changed."))
        })
        .transpose()
}

fn revision<const N: usize>(files: [(&str, Option<&[u8]>); N]) -> String {
    let mut digest = Sha256::new();
    for (name, content) in files {
        digest.update(name.as_bytes());
        digest.update([0]);
        match content {
            Some(content) => {
                digest.update([1]);
                digest.update((content.len() as u64).to_le_bytes());
                digest.update(content);
            }
            None => digest.update([0]),
        }
    }
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest.finalize())
}

fn snapshot(files: ProjectFiles) -> Result<SharedAgentRulesSnapshot, String> {
    let agents_state = match files.agents.as_deref() {
        None => SharedAgentRulesFileState::Missing,
        Some(content) if content.trim().is_empty() => SharedAgentRulesFileState::NeedsSync,
        Some(_) => SharedAgentRulesFileState::Synced,
    };
    let mut statuses = vec![SharedAgentRulesFile {
        cli: "Codex".to_string(),
        file_name: "AGENTS.md".to_string(),
        path: files.directory.join("AGENTS.md").display().to_string(),
        state: agents_state,
    }];
    statuses.push(adapter_status(
        &files.directory,
        files.claude.as_deref(),
        Adapter::Claude,
    ));
    statuses.push(adapter_status(
        &files.directory,
        files.gemini.as_deref(),
        Adapter::Gemini,
    ));
    Ok(SharedAgentRulesSnapshot {
        project_directory: files.directory.display().to_string(),
        content: files.agents.unwrap_or_default(),
        revision: files.revision,
        files: statuses,
    })
}

fn adapter_status(
    directory: &Path,
    content: Option<&str>,
    adapter: Adapter,
) -> SharedAgentRulesFile {
    let state = match content {
        None => SharedAgentRulesFileState::Missing,
        Some(content) if managed_range(content).is_err() => SharedAgentRulesFileState::ManualReview,
        Some(content) if has_import(content, adapter.import()) => SharedAgentRulesFileState::Synced,
        Some(_) => SharedAgentRulesFileState::NeedsSync,
    };
    SharedAgentRulesFile {
        cli: adapter.cli().to_string(),
        file_name: adapter.file_name().to_string(),
        path: directory.join(adapter.file_name()).display().to_string(),
        state,
    }
}

fn normalize_rules(value: &str) -> Result<String, String> {
    let value = value.replace("\r\n", "\n").replace('\r', "\n");
    let value = value.trim();
    if value.is_empty() {
        return Err("AGENTS.md cannot be empty.".to_string());
    }
    if value.as_bytes().len().saturating_add(1) > MAX_SHARED_RULES_BYTES {
        return Err(format!(
            "AGENTS.md is too large (maximum {MAX_SHARED_RULES_BYTES} bytes)."
        ));
    }
    if value
        .chars()
        .any(|character| character.is_control() && !matches!(character, '\n' | '\t'))
    {
        return Err("AGENTS.md contains unsupported control characters.".to_string());
    }
    Ok(format!("{value}\n"))
}

fn has_import(content: &str, expected: &str) -> bool {
    content.lines().any(|line| line.trim() == expected)
}

fn managed_range(content: &str) -> Result<Option<(usize, usize)>, String> {
    let starts: Vec<_> = content.match_indices(MANAGED_START).collect();
    let ends: Vec<_> = content.match_indices(MANAGED_END).collect();
    match (starts.as_slice(), ends.as_slice()) {
        ([], []) => Ok(None),
        ([(start, _)], [(end, _)]) if start < end => Ok(Some((*start, end + MANAGED_END.len()))),
        _ => Err(
            "The LatticeTerm-managed adapter block is incomplete or duplicated. Repair it manually before syncing."
                .to_string(),
        ),
    }
}

fn managed_block(adapter: Adapter, newline: &str) -> String {
    format!(
        "{MANAGED_START}{newline}{}{newline}{MANAGED_END}",
        adapter.import()
    )
}

fn update_adapter(existing: Option<&str>, adapter: Adapter) -> Result<String, String> {
    let newline = existing
        .filter(|content| content.contains("\r\n"))
        .map(|_| "\r\n")
        .unwrap_or("\n");
    let block = managed_block(adapter, newline);
    let Some(existing) = existing else {
        return Ok(format!("{block}{newline}"));
    };
    if let Some((start, end)) = managed_range(existing)? {
        let mut updated = existing.to_string();
        updated.replace_range(start..end, &block);
        return Ok(updated);
    }
    if has_import(existing, adapter.import()) {
        return Ok(existing.to_string());
    }
    let separator = if existing.is_empty() {
        String::new()
    } else if existing.ends_with("\n\n") || existing.ends_with("\r\n\r\n") {
        String::new()
    } else if existing.ends_with('\n') {
        newline.to_string()
    } else {
        format!("{newline}{newline}")
    };
    Ok(format!("{existing}{separator}{block}{newline}"))
}

fn write_transaction(
    directory: &Path,
    changes: Vec<(PathBuf, String)>,
    expected_revision: &str,
) -> Result<(), String> {
    let mut nonce = [0_u8; 12];
    getrandom::fill(&mut nonce)
        .map_err(|error| format!("Cannot create safe temporary file names: {error}"))?;
    let nonce = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(nonce);
    let mut prepared = Vec::with_capacity(changes.len());

    for (index, (target, content)) in changes.into_iter().enumerate() {
        let temporary = directory.join(format!(".latticeterm-rules-{nonce}-{index}.tmp"));
        let mut handle = match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
        {
            Ok(handle) => handle,
            Err(error) => {
                cleanup_prepared(&prepared);
                return Err(format!("Cannot prepare '{}': {error}", target.display()));
            }
        };
        if let Err(error) = handle
            .write_all(content.as_bytes())
            .and_then(|_| handle.sync_all())
        {
            let _ = fs::remove_file(&temporary);
            cleanup_prepared(&prepared);
            return Err(format!("Cannot prepare '{}': {error}", target.display()));
        }
        prepared.push((target, temporary));
    }

    let unchanged = match read_project(directory.to_string_lossy().as_ref()) {
        Ok(project) => project,
        Err(error) => {
            cleanup_prepared(&prepared);
            return Err(error);
        }
    };
    if unchanged.revision != expected_revision {
        cleanup_prepared(&prepared);
        return Err(
            "Shared AI rule files changed outside LatticeTerm. Reload them before saving."
                .to_string(),
        );
    }

    let mut committed: Vec<(PathBuf, Option<PathBuf>)> = Vec::new();
    for (index, (target, temporary)) in prepared.iter().enumerate() {
        let backup = directory.join(format!(".latticeterm-rules-{nonce}-{index}.bak"));
        let prior = if target.exists() {
            if let Err(error) = fs::rename(target, &backup) {
                rollback(&committed);
                cleanup_prepared(&prepared);
                return Err(format!("Cannot safeguard '{}': {error}", target.display()));
            }
            Some(backup)
        } else {
            None
        };
        if let Err(error) = fs::rename(temporary, target) {
            if let Some(backup) = prior.as_ref() {
                let _ = fs::rename(backup, target);
            }
            rollback(&committed);
            cleanup_prepared(&prepared);
            return Err(format!("Cannot replace '{}': {error}", target.display()));
        }
        committed.push((target.clone(), prior));
    }

    for (_, backup) in &committed {
        if let Some(backup) = backup {
            let _ = fs::remove_file(backup);
        }
    }
    Ok(())
}

fn cleanup_prepared(prepared: &[(PathBuf, PathBuf)]) {
    for (_, temporary) in prepared {
        let _ = fs::remove_file(temporary);
    }
}

fn rollback(committed: &[(PathBuf, Option<PathBuf>)]) {
    for (target, backup) in committed.iter().rev() {
        let _ = fs::remove_file(target);
        if let Some(backup) = backup {
            let _ = fs::rename(backup, target);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_canonical_rules_and_both_native_adapters() {
        let directory = tempfile::tempdir().unwrap();
        let initial = inspect(directory.path().to_str().unwrap()).unwrap();
        let saved = save(
            directory.path().to_str().unwrap(),
            "# Project rules\n\n- Use tests.",
            &initial.revision,
        )
        .unwrap();

        assert_eq!(
            fs::read_to_string(directory.path().join("AGENTS.md")).unwrap(),
            "# Project rules\n\n- Use tests.\n"
        );
        assert!(fs::read_to_string(directory.path().join("CLAUDE.md"))
            .unwrap()
            .contains("@AGENTS.md"));
        assert!(fs::read_to_string(directory.path().join("GEMINI.md"))
            .unwrap()
            .contains("@./AGENTS.md"));
        assert!(saved
            .files
            .iter()
            .all(|file| file.state == SharedAgentRulesFileState::Synced));
    }

    #[test]
    fn preserves_adapter_specific_content_and_is_idempotent() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(
            directory.path().join("CLAUDE.md"),
            "# Claude only\n\nPrefer compact answers.\n",
        )
        .unwrap();
        let initial = inspect(directory.path().to_str().unwrap()).unwrap();
        let first = save(
            directory.path().to_str().unwrap(),
            "# Shared",
            &initial.revision,
        )
        .unwrap();
        let first_claude = fs::read_to_string(directory.path().join("CLAUDE.md")).unwrap();
        assert!(first_claude.starts_with("# Claude only\n\nPrefer compact answers.\n"));

        let second = save(
            directory.path().to_str().unwrap(),
            "# Shared",
            &first.revision,
        )
        .unwrap();
        assert_eq!(first.revision, second.revision);
        assert_eq!(
            first_claude,
            fs::read_to_string(directory.path().join("CLAUDE.md")).unwrap()
        );
    }

    #[test]
    fn stale_revision_never_overwrites_external_edits() {
        let directory = tempfile::tempdir().unwrap();
        let initial = inspect(directory.path().to_str().unwrap()).unwrap();
        fs::write(directory.path().join("CLAUDE.md"), "external edit\n").unwrap();

        let error = save(
            directory.path().to_str().unwrap(),
            "# Shared",
            &initial.revision,
        )
        .unwrap_err();
        assert!(error.contains("changed outside LatticeTerm"));
        assert_eq!(
            fs::read_to_string(directory.path().join("CLAUDE.md")).unwrap(),
            "external edit\n"
        );
        assert!(!directory.path().join("AGENTS.md").exists());
    }

    #[test]
    fn malformed_managed_block_requires_manual_review() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(
            directory.path().join("CLAUDE.md"),
            format!("{MANAGED_START}\n@AGENTS.md\n"),
        )
        .unwrap();
        let initial = inspect(directory.path().to_str().unwrap()).unwrap();
        assert_eq!(
            initial.files[1].state,
            SharedAgentRulesFileState::ManualReview
        );

        let error = save(
            directory.path().to_str().unwrap(),
            "# Shared",
            &initial.revision,
        )
        .unwrap_err();
        assert!(error.contains("incomplete or duplicated"));
    }

    #[test]
    fn refuses_empty_or_oversized_canonical_rules() {
        let directory = tempfile::tempdir().unwrap();
        let initial = inspect(directory.path().to_str().unwrap()).unwrap();
        assert!(
            save(directory.path().to_str().unwrap(), "  ", &initial.revision)
                .unwrap_err()
                .contains("cannot be empty")
        );
        assert!(save(
            directory.path().to_str().unwrap(),
            &"x".repeat(MAX_SHARED_RULES_BYTES + 1),
            &initial.revision,
        )
        .unwrap_err()
        .contains("too large"));
    }

    #[test]
    fn canonical_rules_limit_includes_the_normalized_final_newline() {
        assert_eq!(
            normalize_rules(&"x".repeat(MAX_SHARED_RULES_BYTES - 1))
                .unwrap()
                .len(),
            MAX_SHARED_RULES_BYTES
        );
        assert!(normalize_rules(&"x".repeat(MAX_SHARED_RULES_BYTES)).is_err());
    }
}
