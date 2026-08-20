pub mod domain;
pub mod hostkeys;
pub mod ssh;
pub mod storage;

use crate::domain::ConnectionProfile;
use crate::hostkeys::{HostKeyRecord, HostTrustStore};
use crate::ssh::{ConnectOutcome, ConnectRequest, EventSink, SessionSummary, SshRegistry};
use crate::storage::{FileStorage, Storage};
use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

type AppStorage = Mutex<FileStorage>;

/// The trust store, or the reason it could not be opened.
///
/// An unreadable trust file must never degrade into an empty one: that would
/// turn every already-trusted host back into a fresh prompt and hide a changed
/// key among them. Connecting is refused instead, with the reason attached.
pub enum TrustState {
    Ready(Mutex<HostTrustStore>),
    Unavailable(String),
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

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

/// Where connection data lives, and whether anything had to be rescued on the
/// way in. Surfaced in Settings so the file is never a mystery to the user.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageStatus {
    path: String,
    profile_count: usize,
    /// Present only when an unreadable file was set aside at startup.
    recovered_reason: Option<String>,
    recovered_backup_path: Option<String>,
}

#[tauri::command]
fn storage_status(storage: State<'_, AppStorage>) -> Result<StorageStatus, String> {
    let guard = storage.lock().map_err(|e| e.to_string())?;
    let recovery = guard.recovery();

    Ok(StorageStatus {
        path: guard.path().display().to_string(),
        profile_count: guard.list_profiles().map_err(|e| e.to_string())?.len(),
        recovered_reason: recovery.map(|r| r.reason.clone()),
        recovered_backup_path: recovery.map(|r| r.backup_path.display().to_string()),
    })
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

#[tauri::command]
async fn ssh_connect(
    app: AppHandle,
    request: ConnectRequest,
    trust: State<'_, TrustState>,
    registry: State<'_, Arc<SshRegistry>>,
) -> Result<ConnectOutcome, String> {
    // The trust lookup happens up front, so the store's lock is never held
    // across the connection attempt.
    let known: Option<HostKeyRecord> = match trust.inner() {
        TrustState::Unavailable(reason) => {
            return Ok(ConnectOutcome::Failed {
                stage: "trust",
                detail: reason.clone(),
            })
        }
        TrustState::Ready(store) => {
            let guard = store.lock().map_err(|e| e.to_string())?;
            crate::ssh::known_record(&guard, &request.hostname, request.port)
        }
    };

    Ok(crate::ssh::connect(
        Arc::new(EventSink(app)),
        Arc::clone(registry.inner()),
        known,
        request,
    )
    .await)
}

#[tauri::command]
async fn ssh_send(
    session_id: String,
    data: String,
    registry: State<'_, Arc<SshRegistry>>,
) -> Result<(), String> {
    crate::ssh::send(registry.inner(), &session_id, &data).await
}

#[tauri::command]
async fn ssh_resize(
    session_id: String,
    cols: u32,
    rows: u32,
    registry: State<'_, Arc<SshRegistry>>,
) -> Result<(), String> {
    crate::ssh::resize(registry.inner(), &session_id, cols, rows).await
}

#[tauri::command]
async fn ssh_disconnect(
    session_id: String,
    registry: State<'_, Arc<SshRegistry>>,
) -> Result<(), String> {
    crate::ssh::disconnect(registry.inner(), &session_id).await
}

#[tauri::command]
fn ssh_sessions(registry: State<'_, Arc<SshRegistry>>) -> Vec<SessionSummary> {
    registry.list()
}

/// Records a key the user has just compared and accepted.
#[tauri::command]
fn ssh_trust_host(
    host: String,
    port: u16,
    algorithm: String,
    fingerprint: String,
    trust: State<'_, TrustState>,
) -> Result<HostKeyRecord, String> {
    match trust.inner() {
        TrustState::Unavailable(reason) => Err(reason.clone()),
        TrustState::Ready(store) => {
            let mut guard = store.lock().map_err(|e| e.to_string())?;
            guard
                .trust(&host, port, &algorithm, &fingerprint, now_seconds())
                .map_err(|e| e.to_string())
        }
    }
}

#[tauri::command]
fn ssh_known_hosts(trust: State<'_, TrustState>) -> Result<Vec<HostKeyRecord>, String> {
    match trust.inner() {
        TrustState::Unavailable(reason) => Err(reason.clone()),
        TrustState::Ready(store) => {
            let guard = store.lock().map_err(|e| e.to_string())?;
            Ok(guard.records())
        }
    }
}

#[tauri::command]
fn ssh_forget_host(host: String, port: u16, trust: State<'_, TrustState>) -> Result<bool, String> {
    match trust.inner() {
        TrustState::Unavailable(reason) => Err(reason.clone()),
        TrustState::Ready(store) => {
            let mut guard = store.lock().map_err(|e| e.to_string())?;
            guard.forget(&host, port).map_err(|e| e.to_string())
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // The updater stays unregistered until a release signing key exists:
        // the plugin refuses to initialise without `plugins.updater.pubkey`,
        // and a placeholder key would let the app start while silently failing
        // every signature check. Re-enable this line together with the pubkey
        // once `npm run tauri signer generate` has produced a key pair.
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Connection data belongs beside the app's other data, not next to
            // the executable, so it survives an update and follows the user
            // profile on a shared machine.
            let dir = app.path().app_data_dir()?;
            let storage = FileStorage::open(&dir)?;
            app.manage(Mutex::new(storage));

            // A trust store that cannot be read is carried as a reason rather
            // than a panic: the app still runs, and connecting explains why it
            // will not proceed.
            let trust = match HostTrustStore::open(&dir) {
                Ok(store) => TrustState::Ready(Mutex::new(store)),
                Err(error) => TrustState::Unavailable(error.to_string()),
            };
            app.manage(trust);
            app.manage(Arc::new(SshRegistry::new()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            runtime_summary,
            storage_status,
            list_connection_profiles,
            save_connection_profile,
            delete_connection_profile,
            ssh_connect,
            ssh_send,
            ssh_resize,
            ssh_disconnect,
            ssh_sessions,
            ssh_trust_host,
            ssh_known_hosts,
            ssh_forget_host
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
