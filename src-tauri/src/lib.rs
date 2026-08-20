pub mod domain;
pub mod storage;

use crate::domain::ConnectionProfile;
use crate::storage::{InMemoryStorage, Storage};
use serde::Serialize;
use std::sync::Mutex;
use tauri::State;

type AppStorage = Mutex<InMemoryStorage>;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSummary {
    app_name: &'static str,
    version: &'static str,
    supported_protocols: [&'static str; 4],
    credential_storage_ready: bool,
}

#[tauri::command]
fn runtime_summary() -> RuntimeSummary {
    RuntimeSummary {
        app_name: "LatticeTerm",
        version: env!("CARGO_PKG_VERSION"),
        supported_protocols: ["ssh", "sftp", "rdp", "vnc"],
        credential_storage_ready: false,
    }
}

#[tauri::command]
fn list_connection_profiles(
    storage: State<'_, AppStorage>,
) -> Result<Vec<ConnectionProfile>, String> {
    let guard = storage.lock().map_err(|e| e.to_string())?;
    guard.list_profiles().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_connection_profile(
    profile: ConnectionProfile,
    storage: State<'_, AppStorage>,
) -> Result<(), String> {
    let mut guard = storage.lock().map_err(|e| e.to_string())?;
    guard.insert_profile(profile).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_connection_profile(id: String, storage: State<'_, AppStorage>) -> Result<bool, String> {
    let mut guard = storage.lock().map_err(|e| e.to_string())?;
    guard.delete_profile(&id).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(InMemoryStorage::new()))
        .invoke_handler(tauri::generate_handler![
            runtime_summary,
            list_connection_profiles,
            save_connection_profile,
            delete_connection_profile
        ])
        .run(tauri::generate_context!())
        .expect("error while running LatticeTerm");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{
        parse_tags, validate_connection_draft, ConnectionDraft, ConnectionProfile, Environment,
        Protocol,
    };
    use crate::storage::{InMemoryStorage, Storage};

    #[test]
    fn runtime_summary_does_not_claim_secure_storage_is_ready() {
        let summary = runtime_summary();

        assert_eq!(summary.app_name, "LatticeTerm");
        assert_eq!(summary.supported_protocols, ["ssh", "sftp", "rdp", "vnc"]);
        assert!(!summary.credential_storage_ready);
    }

    #[test]
    fn validates_and_constructs_profile_from_draft() {
        let draft = ConnectionDraft {
            name: "Edge Gateway".to_string(),
            protocol: Protocol::Ssh,
            hostname: "gateway.example.com".to_string(),
            username: "operator".to_string(),
            port: 22,
            environment: Environment::Production,
            group: Some("Core platform".to_string()),
            tags: vec!["edge".to_string(), "eu-west".to_string()],
            favorite: true,
        };

        let errors = validate_connection_draft(&draft);
        assert!(errors.is_empty(), "Expected valid draft, got {:?}", errors);

        let profile = ConnectionProfile::from_draft(draft, "test-id-1".to_string());
        assert_eq!(profile.id, "test-id-1");
        assert_eq!(profile.name, "Edge Gateway");
        assert_eq!(profile.protocol, Protocol::Ssh);
        assert_eq!(profile.group, "Core platform");
        assert_eq!(profile.tags, vec!["edge", "eu-west"]);
        assert_eq!(profile.target_string(), "operator@gateway.example.com:22");
    }

    #[test]
    fn rejects_invalid_draft_fields() {
        let invalid_draft = ConnectionDraft {
            name: "".to_string(),
            protocol: Protocol::Ssh,
            hostname: "ssh://invalid host with spaces".to_string(),
            username: "user name".to_string(),
            port: 0,
            environment: Environment::Unassigned,
            group: None,
            tags: vec![],
            favorite: false,
        };

        let errors = validate_connection_draft(&invalid_draft);
        assert!(errors.name.is_some());
        assert!(errors.hostname.is_some());
        assert!(errors.username.is_some());
        assert!(errors.port.is_some());
    }

    #[test]
    fn tag_parsing_deduplicates_and_normalizes() {
        let parsed = parse_tags([" Edge, edge ", "EU West\nprod", ""]);
        assert_eq!(parsed, vec!["edge", "eu-west", "prod"]);
    }

    #[test]
    fn storage_trait_crud_operations() {
        let mut storage = InMemoryStorage::new();

        let profile = ConnectionProfile {
            id: "p1".to_string(),
            name: "Server A".to_string(),
            protocol: Protocol::Ssh,
            hostname: "a.example.com".to_string(),
            username: "root".to_string(),
            port: 22,
            environment: Environment::Production,
            group: "Servers".to_string(),
            tags: vec!["db".to_string()],
            favorite: true,
        };

        assert!(storage.insert_profile(profile.clone()).is_ok());

        let retrieved = storage.get_profile("p1").unwrap();
        assert_eq!(retrieved, Some(profile.clone()));

        let list = storage.list_profiles().unwrap();
        assert_eq!(list.len(), 1);

        assert!(storage.delete_profile("p1").unwrap());
        assert_eq!(storage.get_profile("p1").unwrap(), None);
    }
}
