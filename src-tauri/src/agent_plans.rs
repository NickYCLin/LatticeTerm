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

const STORE_VERSION: u32 = 1;
const STORE_FILE: &str = "agent-workspaces.json";
const TEMP_FILE: &str = "agent-workspaces.json.tmp";

#[derive(Debug, Serialize, Deserialize)]
struct StoreFile {
    version: u32,
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
    pub plans: Vec<AgentLaunchPlan>,
    pub recovery: Option<AgentPlanRecovery>,
}

#[derive(Debug)]
pub struct FileAgentPlanStore {
    path: PathBuf,
    plans: Vec<AgentLaunchPlan>,
    recovery: Option<AgentPlanRecovery>,
}

impl FileAgentPlanStore {
    pub fn open(dir: &Path) -> Result<Self, String> {
        fs::create_dir_all(dir).map_err(|error| error.to_string())?;
        let path = dir.join(STORE_FILE);
        let mut store = Self {
            path,
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
                store.plans = file.plans;
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
            plans: self.plans.clone(),
            recovery: self.recovery.clone(),
        }
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
    fn failed_writes_roll_back_the_in_memory_change() {
        let directory = temp_dir("rollback");
        let mut store = FileAgentPlanStore::open(&directory).unwrap();
        fs::create_dir_all(directory.join(TEMP_FILE)).unwrap();

        assert!(store.save(draft(&directory, "Review agent")).is_err());
        assert!(store.snapshot().plans.is_empty());
    }
}
