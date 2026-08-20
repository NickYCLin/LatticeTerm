//! Non-secret launch metadata for restoring an Agent Fleet workspace.
//!
//! This intentionally does not persist PTY output, prompts, reporter tokens,
//! process identifiers, or model credentials. Restoring always starts new CLI
//! processes after an explicit user confirmation.

use crate::agent::{
    normalize_launch_plan, AgentLaunchPlan, AgentLaunchPlanDraft, MAX_SAVED_AGENT_PLANS,
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

const STORE_VERSION: u32 = 2;
const STORE_FILE: &str = "agent-workspaces.json";
const TEMP_FILE: &str = "agent-workspaces.json.tmp";

#[derive(Debug, Serialize, Deserialize)]
struct StoreFile {
    version: u32,
    #[serde(default, rename = "workspaceName")]
    workspace_name: String,
    plans: Vec<AgentLaunchPlan>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPlanRecovery {
    pub reason: String,
    pub backup_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPlanSnapshot {
    pub workspace_name: String,
    pub plans: Vec<AgentLaunchPlan>,
    pub recovery: Option<AgentPlanRecovery>,
}

#[derive(Debug)]
pub struct FileAgentPlanStore {
    path: PathBuf,
    workspace_name: String,
    plans: Vec<AgentLaunchPlan>,
    recovery: Option<AgentPlanRecovery>,
}

impl FileAgentPlanStore {
    pub fn open(dir: &Path) -> Result<Self, String> {
        fs::create_dir_all(dir).map_err(|error| error.to_string())?;
        let path = dir.join(STORE_FILE);
        let mut store = Self {
            path,
            workspace_name: String::new(),
            plans: Vec::new(),
            recovery: None,
        };

        let raw = match fs::read_to_string(&store.path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(store),
            Err(error) => return Err(error.to_string()),
        };
        match serde_json::from_str::<StoreFile>(&raw) {
            Ok(file)
                if file.version <= STORE_VERSION && file.plans.len() <= MAX_SAVED_AGENT_PLANS =>
            {
                match normalize_stored_workspace_name(&file.workspace_name) {
                    Ok(name) => {
                        store.workspace_name = name;
                        store.plans = file.plans;
                    }
                    Err(error) => {
                        store.recovery = Some(store.set_aside(format!(
                            "file contains an invalid workspace name: {error}"
                        ))?);
                    }
                }
            }
            Ok(file) if file.version > STORE_VERSION => {
                store.recovery = Some(store.set_aside(format!(
                    "file was written by a newer version (found {}, supported {})",
                    file.version, STORE_VERSION
                ))?);
            }
            Ok(file) => {
                store.recovery = Some(store.set_aside(format!(
                    "file contains too many launch plans (found {}, supported {})",
                    file.plans.len(),
                    MAX_SAVED_AGENT_PLANS
                ))?);
            }
            Err(error) => {
                store.recovery = Some(store.set_aside(format!("file could not be read: {error}"))?);
            }
        }
        Ok(store)
    }

    fn set_aside(&self, reason: String) -> Result<AgentPlanRecovery, String> {
        let mut backup = self.path.clone();
        backup.set_extension("json.unreadable");
        let mut attempt = 1;
        while backup.exists() {
            backup = self.path.clone();
            backup.set_extension(format!("json.unreadable.{attempt}"));
            attempt += 1;
        }
        fs::rename(&self.path, &backup).map_err(|error| error.to_string())?;
        Ok(AgentPlanRecovery {
            reason,
            backup_path: backup.display().to_string(),
        })
    }

    fn next_id() -> Result<String, String> {
        let mut bytes = [0_u8; 16];
        getrandom::fill(&mut bytes)
            .map_err(|error| format!("Cannot create a launch plan ID: {error}"))?;
        Ok(format!(
            "agent-plan-{}",
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
        ))
    }

    fn persist(&self) -> Result<(), String> {
        let json = serde_json::to_string_pretty(&StoreFile {
            version: STORE_VERSION,
            workspace_name: self.workspace_name.clone(),
            plans: self.plans.clone(),
        })
        .map_err(|error| error.to_string())?;
        let directory = self
            .path
            .parent()
            .ok_or_else(|| "Agent plan store path has no directory.".to_string())?;
        let temporary = directory.join(TEMP_FILE);
        {
            let mut handle = fs::File::create(&temporary).map_err(|error| error.to_string())?;
            handle
                .write_all(json.as_bytes())
                .and_then(|_| handle.sync_all())
                .map_err(|error| error.to_string())?;
        }
        fs::rename(&temporary, &self.path).map_err(|error| error.to_string())
    }

    pub fn snapshot(&self) -> AgentPlanSnapshot {
        AgentPlanSnapshot {
            workspace_name: self.workspace_name.clone(),
            plans: self.plans.clone(),
            recovery: self.recovery.clone(),
        }
    }

    pub fn rename(&mut self, name: &str) -> Result<String, String> {
        let name = normalize_workspace_name(name)?;
        if name == self.workspace_name {
            return Ok(name);
        }
        let previous = std::mem::replace(&mut self.workspace_name, name.clone());
        if let Err(error) = self.persist() {
            self.workspace_name = previous;
            return Err(error);
        }
        Ok(name)
    }

    pub fn reorder(&mut self, ordered_ids: &[String]) -> Result<Vec<AgentLaunchPlan>, String> {
        if ordered_ids.len() != self.plans.len() {
            return Err("The ordered launch plan list must contain every saved item.".to_string());
        }
        let mut reordered = Vec::with_capacity(self.plans.len());
        for id in ordered_ids {
            if id.trim() != id || id.is_empty() || id.len() > 128 {
                return Err("A saved launch plan ID is invalid.".to_string());
            }
            let plan = self
                .plans
                .iter()
                .find(|plan| &plan.id == id)
                .ok_or_else(|| format!("Saved launch plan '{id}' no longer exists."))?;
            if reordered
                .iter()
                .any(|entry: &AgentLaunchPlan| entry.id == plan.id)
            {
                return Err("A saved launch plan appears more than once in the order.".to_string());
            }
            reordered.push(plan.clone());
        }

        if reordered == self.plans {
            return Ok(reordered);
        }
        let previous = std::mem::replace(&mut self.plans, reordered);
        if let Err(error) = self.persist() {
            self.plans = previous;
            return Err(error);
        }
        Ok(self.plans.clone())
    }

    pub fn save(&mut self, draft: AgentLaunchPlanDraft) -> Result<AgentLaunchPlan, String> {
        if self.plans.len() >= MAX_SAVED_AGENT_PLANS {
            return Err(format!(
                "At most {MAX_SAVED_AGENT_PLANS} launch plans may be saved."
            ));
        }
        let plan = normalize_launch_plan(Self::next_id()?, draft)?;
        self.plans.push(plan.clone());
        if let Err(error) = self.persist() {
            self.plans.pop();
            return Err(error);
        }
        Ok(plan)
    }

    pub fn delete(&mut self, id: &str) -> Result<bool, String> {
        let Some(index) = self.plans.iter().position(|plan| plan.id == id) else {
            return Ok(false);
        };
        let removed = self.plans.remove(index);
        if let Err(error) = self.persist() {
            self.plans.insert(index, removed);
            return Err(error);
        }
        Ok(true)
    }

    pub fn find(&self, id: &str) -> Option<AgentLaunchPlan> {
        self.plans.iter().find(|plan| plan.id == id).cloned()
    }
}

fn normalize_workspace_name(value: &str) -> Result<String, String> {
    let name = value.trim();
    if name.is_empty() {
        return Err("Workspace name is required.".to_string());
    }
    if name.len() > 80 {
        return Err("Workspace name is too long (maximum 80 bytes).".to_string());
    }
    if name.chars().any(char::is_control) {
        return Err("Workspace name contains unsupported control characters.".to_string());
    }
    Ok(name.to_string())
}

fn normalize_stored_workspace_name(value: &str) -> Result<String, String> {
    if value.is_empty() {
        Ok(String::new())
    } else {
        normalize_workspace_name(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory =
            std::env::temp_dir().join(format!("latticeterm-agent-plan-{label}-{unique}"));
        fs::create_dir_all(&directory).unwrap();
        directory
    }

    fn draft(directory: &Path, label: &str) -> AgentLaunchPlanDraft {
        AgentLaunchPlanDraft {
            definition_id: "custom".to_string(),
            label: label.to_string(),
            executable: if cfg!(windows) {
                "cmd.exe".to_string()
            } else {
                "/bin/echo".to_string()
            },
            arguments: vec!["--version".to_string()],
            working_directory: directory.display().to_string(),
        }
    }

    #[test]
    fn saved_plans_survive_reopening_without_secret_fields() {
        let directory = temp_dir("round-trip");
        let mut store = FileAgentPlanStore::open(&directory).unwrap();
        let saved = store.save(draft(&directory, "Review agent")).unwrap();

        let reopened = FileAgentPlanStore::open(&directory).unwrap();
        let snapshot = reopened.snapshot();
        assert_eq!(snapshot.plans, vec![saved]);
        let raw = fs::read_to_string(directory.join(STORE_FILE)).unwrap();
        for secret in ["reportToken", "processId", "prompt", "terminalOutput"] {
            assert!(!raw.contains(secret), "unexpected {secret} in plan store");
        }
    }

    #[test]
    fn deletion_survives_reopening() {
        let directory = temp_dir("delete");
        let mut store = FileAgentPlanStore::open(&directory).unwrap();
        let saved = store.save(draft(&directory, "Review agent")).unwrap();
        assert!(store.delete(&saved.id).unwrap());
        assert!(!store.delete(&saved.id).unwrap());
        assert!(FileAgentPlanStore::open(&directory)
            .unwrap()
            .snapshot()
            .plans
            .is_empty());
    }

    #[test]
    fn version_one_files_migrate_when_named_and_reordered() {
        let directory = temp_dir("v1-migration");
        let first =
            normalize_launch_plan("agent-plan-first".to_string(), draft(&directory, "First"))
                .unwrap();
        let second =
            normalize_launch_plan("agent-plan-second".to_string(), draft(&directory, "Second"))
                .unwrap();
        fs::write(
            directory.join(STORE_FILE),
            serde_json::json!({ "version": 1, "plans": [first, second] }).to_string(),
        )
        .unwrap();

        let mut store = FileAgentPlanStore::open(&directory).unwrap();
        assert_eq!(store.snapshot().workspace_name, "");
        assert_eq!(store.rename("  Release crew  ").unwrap(), "Release crew");
        store
            .reorder(&[
                "agent-plan-second".to_string(),
                "agent-plan-first".to_string(),
            ])
            .unwrap();

        let reopened = FileAgentPlanStore::open(&directory).unwrap();
        let snapshot = reopened.snapshot();
        assert_eq!(snapshot.workspace_name, "Release crew");
        assert_eq!(
            snapshot
                .plans
                .iter()
                .map(|plan| plan.id.as_str())
                .collect::<Vec<_>>(),
            vec!["agent-plan-second", "agent-plan-first"]
        );
        let raw = fs::read_to_string(directory.join(STORE_FILE)).unwrap();
        assert!(raw.contains("\"version\": 2"));
        assert!(raw.contains("\"workspaceName\": \"Release crew\""));
    }

    #[test]
    fn invalid_reorders_do_not_change_the_saved_order() {
        let directory = temp_dir("invalid-reorder");
        let mut store = FileAgentPlanStore::open(&directory).unwrap();
        let first = store.save(draft(&directory, "First")).unwrap();
        let second = store.save(draft(&directory, "Second")).unwrap();

        assert!(store
            .reorder(&[first.id.clone(), first.id.clone()])
            .is_err());
        assert_eq!(store.snapshot().plans, vec![first, second]);
    }

    #[test]
    fn workspace_names_are_trimmed_and_validated() {
        let directory = temp_dir("workspace-name");
        let mut store = FileAgentPlanStore::open(&directory).unwrap();
        assert_eq!(store.rename("  Planning team  ").unwrap(), "Planning team");
        assert!(store.rename("  ").is_err());
        assert!(store.rename("bad\nname").is_err());
        assert_eq!(store.snapshot().workspace_name, "Planning team");
    }

    #[test]
    fn unreadable_files_are_preserved_for_recovery() {
        let directory = temp_dir("recovery");
        let path = directory.join(STORE_FILE);
        fs::write(&path, "{ broken json").unwrap();

        let store = FileAgentPlanStore::open(&directory).unwrap();
        let recovery = store.snapshot().recovery.expect("recovery details");
        assert!(recovery.reason.contains("could not be read"));
        assert_eq!(
            fs::read_to_string(recovery.backup_path).unwrap(),
            "{ broken json"
        );
    }

    #[test]
    fn invalid_stored_workspace_names_are_preserved_for_recovery() {
        let directory = temp_dir("invalid-stored-name");
        let path = directory.join(STORE_FILE);
        let raw = serde_json::json!({
            "version": STORE_VERSION,
            "workspaceName": "bad\nname",
            "plans": []
        })
        .to_string();
        fs::write(&path, &raw).unwrap();

        let store = FileAgentPlanStore::open(&directory).unwrap();
        let recovery = store.snapshot().recovery.expect("recovery details");
        assert!(recovery.reason.contains("invalid workspace name"));
        assert_eq!(fs::read_to_string(recovery.backup_path).unwrap(), raw);
    }

    #[test]
    fn failed_writes_roll_back_the_in_memory_change() {
        let directory = temp_dir("rollback");
        let mut store = FileAgentPlanStore::open(&directory).unwrap();
        fs::create_dir_all(directory.join(TEMP_FILE)).unwrap();

        assert!(store.save(draft(&directory, "Review agent")).is_err());
        assert!(store.snapshot().plans.is_empty());
    }
}
