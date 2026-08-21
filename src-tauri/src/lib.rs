pub mod agent;
pub mod agent_plans;
pub mod credentials;
pub mod domain;
pub mod hostkeys;
pub mod rdp;
pub mod remote;
pub mod remote_host;
pub mod sftp;
pub mod ssh;
pub mod storage;
pub mod tunnel;

use crate::agent::{
    AgentBroadcastOutcome, AgentDefinition, AgentLaunchPlan, AgentLaunchPlanDraft,
    AgentLaunchRequest, AgentRegistry, AgentRestoreOutcome, AgentSessionSummary,
    MAX_SAVED_AGENT_PLANS,
};
use crate::agent_plans::{AgentPlanSnapshot, FileAgentPlanStore};
use crate::credentials::{CredentialKind, CredentialStoreStatus};
use crate::domain::{ConnectionProfile, Protocol};
use crate::hostkeys::{HostKeyRecord, HostTrustStore};
use crate::rdp::{
    RdpConnectOutcome, RdpConnectRequest, RdpInputRequest, RdpRegistry, RdpSessionSummary,
};
use crate::remote::{
    RemoteConnectOutcome, RemoteConnectRequest, RemoteRegistry, RemoteSessionSummary,
};
use crate::remote_host::{RemoteHostRegistry, RemoteHostStartRequest, RemoteHostStatus};
use crate::sftp::{
    SftpConnectOutcome, SftpConnectRequest, SftpDirectory, SftpRegistry, SftpSessionSummary,
};
use crate::ssh::{ConnectOutcome, ConnectRequest, EventSink, SessionSummary, SshRegistry};
use crate::storage::{FileStorage, Storage};
use crate::tunnel::{StartTunnelRequest, TunnelRegistry, TunnelStatusSummary};
use serde::Serialize;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use zeroize::Zeroizing;

type AppStorage = Mutex<FileStorage>;
type AppAgentPlans = Mutex<FileAgentPlanStore>;

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

async fn credential_call<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("Credential operation did not complete: {error}"))?
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
        supported_protocols: ["ssh", "sftp", "rdp", "lattice"],
        credential_storage_ready: crate::credentials::status().ready,
    }
}

#[tauri::command]
fn agent_catalog() -> Vec<AgentDefinition> {
    crate::agent::catalog()
}

#[tauri::command]
fn agent_default_working_directory() -> Result<String, String> {
    crate::agent::default_working_directory()
}

#[tauri::command]
fn agent_launch(
    app: AppHandle,
    request: AgentLaunchRequest,
    registry: State<'_, Arc<AgentRegistry>>,
) -> Result<AgentSessionSummary, String> {
    crate::agent::launch(
        Arc::new(crate::agent::EventSink(app)),
        Arc::clone(registry.inner()),
        request,
    )
}

#[tauri::command]
fn agent_send(
    app: AppHandle,
    session_id: String,
    data: String,
    registry: State<'_, Arc<AgentRegistry>>,
) -> Result<(), String> {
    crate::agent::send(
        &crate::agent::EventSink(app),
        registry.inner(),
        &session_id,
        &data,
    )
}

#[tauri::command]
fn agent_broadcast(
    app: AppHandle,
    session_ids: Vec<String>,
    data: String,
    registry: State<'_, Arc<AgentRegistry>>,
) -> Result<Vec<AgentBroadcastOutcome>, String> {
    crate::agent::broadcast(
        &crate::agent::EventSink(app),
        registry.inner(),
        &session_ids,
        &data,
    )
}

#[tauri::command]
fn agent_resize(
    session_id: String,
    cols: u32,
    rows: u32,
    registry: State<'_, Arc<AgentRegistry>>,
) -> Result<(), String> {
    crate::agent::resize(registry.inner(), &session_id, cols, rows)
}

#[tauri::command]
fn agent_disconnect(
    app: AppHandle,
    session_id: String,
    registry: State<'_, Arc<AgentRegistry>>,
) -> Result<(), String> {
    crate::agent::disconnect(&crate::agent::EventSink(app), registry.inner(), &session_id)
}

#[tauri::command]
fn agent_sessions(registry: State<'_, Arc<AgentRegistry>>) -> Vec<AgentSessionSummary> {
    registry.list()
}

#[tauri::command]
fn agent_plan_snapshot(plans: State<'_, AppAgentPlans>) -> Result<AgentPlanSnapshot, String> {
    Ok(plans.lock().map_err(|error| error.to_string())?.snapshot())
}

#[tauri::command]
fn agent_plan_save(
    draft: AgentLaunchPlanDraft,
    plans: State<'_, AppAgentPlans>,
) -> Result<AgentLaunchPlan, String> {
    plans.lock().map_err(|error| error.to_string())?.save(draft)
}

#[tauri::command]
fn agent_plan_delete(id: String, plans: State<'_, AppAgentPlans>) -> Result<bool, String> {
    plans.lock().map_err(|error| error.to_string())?.delete(&id)
}

#[tauri::command]
fn agent_workspace_rename(name: String, plans: State<'_, AppAgentPlans>) -> Result<String, String> {
    plans
        .lock()
        .map_err(|error| error.to_string())?
        .rename(&name)
}

#[tauri::command]
fn agent_plan_reorder(
    ordered_ids: Vec<String>,
    plans: State<'_, AppAgentPlans>,
) -> Result<Vec<AgentLaunchPlan>, String> {
    plans
        .lock()
        .map_err(|error| error.to_string())?
        .reorder(&ordered_ids)
}

#[tauri::command]
fn agent_plan_restore(
    app: AppHandle,
    plan_ids: Vec<String>,
    plans: State<'_, AppAgentPlans>,
    registry: State<'_, Arc<AgentRegistry>>,
) -> Result<Vec<AgentRestoreOutcome>, String> {
    if plan_ids.is_empty() {
        return Err("Select at least one saved launch plan.".to_string());
    }
    if plan_ids.len() > MAX_SAVED_AGENT_PLANS {
        return Err(format!(
            "At most {MAX_SAVED_AGENT_PLANS} launch plans may be restored at once."
        ));
    }
    let mut unique = HashSet::with_capacity(plan_ids.len());
    for plan_id in &plan_ids {
        if plan_id.trim() != plan_id || plan_id.is_empty() || plan_id.len() > 128 {
            return Err("A saved launch plan ID is invalid.".to_string());
        }
        if !unique.insert(plan_id.as_str()) {
            return Err(
                "Saved launch plans cannot be restored more than once per request.".to_string(),
            );
        }
    }

    let selected = {
        let guard = plans.lock().map_err(|error| error.to_string())?;
        plan_ids
            .iter()
            .map(|plan_id| {
                guard
                    .find(plan_id)
                    .ok_or_else(|| format!("Saved launch plan '{plan_id}' no longer exists."))
            })
            .collect::<Result<Vec<_>, _>>()?
    };
    let sink: Arc<dyn crate::agent::AgentSink> = Arc::new(crate::agent::EventSink(app));
    Ok(selected
        .into_iter()
        .map(|plan| {
            let plan_id = plan.id.clone();
            let label = plan.label.clone();
            let launched =
                crate::agent::launch_request_from_plan(&plan, 120, 32).and_then(|request| {
                    crate::agent::launch(Arc::clone(&sink), Arc::clone(registry.inner()), request)
                });
            match launched {
                Ok(session) => AgentRestoreOutcome {
                    plan_id,
                    label,
                    session: Some(session),
                    error: None,
                },
                Err(error) => AgentRestoreOutcome {
                    plan_id,
                    label,
                    session: None,
                    error: Some(error),
                },
            }
        })
        .collect())
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
async fn delete_connection_profile(
    id: String,
    storage: State<'_, AppStorage>,
) -> Result<bool, String> {
    let credential_kind = {
        let guard = storage.lock().map_err(|e| e.to_string())?;
        guard
            .get_profile(&id)
            .map_err(|e| e.to_string())?
            .and_then(|profile| match profile.protocol {
                Protocol::Ssh => Some(CredentialKind::SshPassword),
                Protocol::Sftp => Some(CredentialKind::SftpPassword),
                Protocol::Rdp => Some(CredentialKind::RdpPassword),
                _ => None,
            })
    };

    if let Some(kind) = credential_kind {
        let credential_profile_id = id.clone();
        if credential_call(move || crate::credentials::exists(&credential_profile_id, kind)).await?
        {
            return Err(
                "Delete the saved password from the Key Vault before deleting this connection."
                    .to_string(),
            );
        }
    }

    let mut guard = storage.lock().map_err(|e| e.to_string())?;
    guard.delete_profile(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn credential_status() -> CredentialStoreStatus {
    crate::credentials::status()
}

#[tauri::command]
async fn credential_exists(profile_id: String, kind: CredentialKind) -> Result<bool, String> {
    credential_call(move || crate::credentials::exists(&profile_id, kind)).await
}

#[tauri::command]
async fn credential_delete(profile_id: String, kind: CredentialKind) -> Result<bool, String> {
    credential_call(move || crate::credentials::delete(&profile_id, kind)).await
}

#[tauri::command]
async fn ssh_connect(
    app: AppHandle,
    mut request: ConnectRequest,
    trust: State<'_, TrustState>,
    registry: State<'_, Arc<SshRegistry>>,
) -> Result<ConnectOutcome, String> {
    if request.use_saved_password && request.remember_password {
        return Ok(ConnectOutcome::Failed {
            stage: "credential",
            detail: "Choose either the saved password or a new password to remember.".to_string(),
        });
    }

    if request.use_saved_password {
        let profile_id = request.profile_id.clone();
        let password = match credential_call(move || {
            crate::credentials::load(&profile_id, CredentialKind::SshPassword)
        })
        .await
        {
            Ok(password) => password,
            Err(detail) => {
                return Ok(ConnectOutcome::Failed {
                    stage: "credential",
                    detail,
                })
            }
        };
        request.auth = crate::ssh::AuthMethod::Password { password };
    }

    let profile_id = request.profile_id.clone();
    let password_to_store = if request.remember_password {
        match &request.auth {
            crate::ssh::AuthMethod::Password { password } => Some(Zeroizing::new(password.clone())),
        }
    } else {
        None
    };

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

    let outcome = crate::ssh::connect(
        Arc::new(EventSink(app)),
        Arc::clone(registry.inner()),
        known,
        request,
    )
    .await;

    if let (ConnectOutcome::Connected { session_id }, Some(password)) =
        (&outcome, password_to_store)
    {
        let save_result = credential_call(move || {
            crate::credentials::store(&profile_id, CredentialKind::SshPassword, password.as_str())
        })
        .await;
        if let Err(detail) = save_result {
            let _ = crate::ssh::disconnect(registry.inner(), session_id).await;
            return Ok(ConnectOutcome::Failed {
                stage: "credential",
                detail,
            });
        }
    }

    Ok(outcome)
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

#[tauri::command]
async fn sftp_connect(
    mut request: SftpConnectRequest,
    trust: State<'_, TrustState>,
    registry: State<'_, Arc<SftpRegistry>>,
) -> Result<SftpConnectOutcome, String> {
    if request.use_saved_password && request.remember_password {
        return Ok(SftpConnectOutcome::Failed {
            stage: "credential",
            detail: "Choose either the saved password or a new password to remember.".to_string(),
        });
    }

    if request.use_saved_password {
        let profile_id = request.profile_id.clone();
        request.auth = match credential_call(move || {
            crate::credentials::load(&profile_id, CredentialKind::SftpPassword)
        })
        .await
        {
            Ok(password) => crate::ssh::AuthMethod::Password { password },
            Err(detail) => {
                return Ok(SftpConnectOutcome::Failed {
                    stage: "credential",
                    detail,
                })
            }
        };
    }

    let profile_id = request.profile_id.clone();
    let password_to_store = if request.remember_password {
        match &request.auth {
            crate::ssh::AuthMethod::Password { password } => Some(Zeroizing::new(password.clone())),
        }
    } else {
        None
    };
    let known = match trust.inner() {
        TrustState::Unavailable(reason) => {
            return Ok(SftpConnectOutcome::Failed {
                stage: "trust",
                detail: reason.clone(),
            })
        }
        TrustState::Ready(store) => {
            let guard = store.lock().map_err(|error| error.to_string())?;
            crate::ssh::known_record(&guard, &request.hostname, request.port)
        }
    };

    let outcome = crate::sftp::connect(Arc::clone(registry.inner()), known, request).await;
    if let (SftpConnectOutcome::Connected { session }, Some(password)) =
        (&outcome, password_to_store)
    {
        let session_id = session.session_id.clone();
        if let Err(detail) = credential_call(move || {
            crate::credentials::store(&profile_id, CredentialKind::SftpPassword, password.as_str())
        })
        .await
        {
            let _ = crate::sftp::disconnect(registry.inner(), &session_id).await;
            return Ok(SftpConnectOutcome::Failed {
                stage: "credential",
                detail,
            });
        }
    }
    Ok(outcome)
}

#[tauri::command]
fn sftp_sessions(registry: State<'_, Arc<SftpRegistry>>) -> Vec<SftpSessionSummary> {
    registry.list()
}

#[tauri::command]
async fn sftp_list(
    session_id: String,
    path: String,
    registry: State<'_, Arc<SftpRegistry>>,
) -> Result<SftpDirectory, String> {
    crate::sftp::list_directory(registry.inner(), &session_id, &path).await
}

#[tauri::command]
async fn sftp_create_directory(
    session_id: String,
    parent: String,
    name: String,
    registry: State<'_, Arc<SftpRegistry>>,
) -> Result<(), String> {
    crate::sftp::create_directory(registry.inner(), &session_id, &parent, &name).await
}

#[tauri::command]
async fn sftp_rename(
    session_id: String,
    path: String,
    new_name: String,
    registry: State<'_, Arc<SftpRegistry>>,
) -> Result<(), String> {
    crate::sftp::rename(registry.inner(), &session_id, &path, &new_name).await
}

#[tauri::command]
async fn sftp_remove(
    session_id: String,
    path: String,
    directory: bool,
    registry: State<'_, Arc<SftpRegistry>>,
) -> Result<(), String> {
    crate::sftp::remove(registry.inner(), &session_id, &path, directory).await
}

#[tauri::command]
async fn sftp_read_file(
    session_id: String,
    path: String,
    registry: State<'_, Arc<SftpRegistry>>,
) -> Result<String, String> {
    crate::sftp::read_file(registry.inner(), &session_id, &path).await
}

#[tauri::command]
async fn sftp_write_file(
    session_id: String,
    parent: String,
    name: String,
    data: String,
    overwrite: bool,
    registry: State<'_, Arc<SftpRegistry>>,
) -> Result<(), String> {
    crate::sftp::write_file(
        registry.inner(),
        &session_id,
        &parent,
        &name,
        &data,
        overwrite,
    )
    .await
}

#[tauri::command]
async fn sftp_disconnect(
    session_id: String,
    registry: State<'_, Arc<SftpRegistry>>,
) -> Result<(), String> {
    crate::sftp::disconnect(registry.inner(), &session_id).await
}

#[tauri::command]
async fn remote_connect(
    app: AppHandle,
    request: RemoteConnectRequest,
    registry: State<'_, Arc<RemoteRegistry>>,
) -> Result<RemoteConnectOutcome, String> {
    Ok(crate::remote::connect(app, Arc::clone(registry.inner()), request).await)
}

#[tauri::command]
fn remote_disconnect(
    app: AppHandle,
    session_id: String,
    registry: State<'_, Arc<RemoteRegistry>>,
) -> Result<(), String> {
    crate::remote::disconnect(&app, registry.inner(), &session_id)
}

#[tauri::command]
fn remote_sessions(registry: State<'_, Arc<RemoteRegistry>>) -> Vec<RemoteSessionSummary> {
    registry.list()
}

#[tauri::command]
async fn remote_host_start(
    app: AppHandle,
    request: RemoteHostStartRequest,
    registry: State<'_, Arc<RemoteHostRegistry>>,
) -> Result<RemoteHostStatus, String> {
    crate::remote_host::start(app, Arc::clone(registry.inner()), request).await
}

#[tauri::command]
async fn remote_host_stop(
    app: AppHandle,
    registry: State<'_, Arc<RemoteHostRegistry>>,
) -> Result<(), String> {
    crate::remote_host::stop(&app, registry.inner()).await
}

#[tauri::command]
fn remote_host_status(
    registry: State<'_, Arc<RemoteHostRegistry>>,
) -> Result<Option<RemoteHostStatus>, String> {
    registry.status()
}

#[tauri::command]
async fn rdp_connect(
    app: AppHandle,
    mut request: RdpConnectRequest,
    registry: State<'_, Arc<RdpRegistry>>,
) -> Result<RdpConnectOutcome, String> {
    if request.use_saved_password && request.remember_password {
        return Ok(RdpConnectOutcome::Failed {
            stage: "credential",
            detail: "Choose either the saved password or a new password to remember.".to_string(),
        });
    }

    if request.use_saved_password {
        let profile_id = request.profile_id.clone();
        request.password = match credential_call(move || {
            crate::credentials::load(&profile_id, CredentialKind::RdpPassword)
        })
        .await
        {
            Ok(password) => password,
            Err(detail) => {
                return Ok(RdpConnectOutcome::Failed {
                    stage: "credential",
                    detail,
                })
            }
        };
    }

    let profile_id = request.profile_id.clone();
    let password_to_store = request
        .remember_password
        .then(|| Zeroizing::new(request.password.clone()));
    let outcome = crate::rdp::connect(app.clone(), Arc::clone(registry.inner()), request).await;

    if let (RdpConnectOutcome::Connected { session }, Some(password)) =
        (&outcome, password_to_store)
    {
        let save_result = credential_call(move || {
            crate::credentials::store(&profile_id, CredentialKind::RdpPassword, password.as_str())
        })
        .await;
        if let Err(detail) = save_result {
            let _ = crate::rdp::disconnect(&app, registry.inner(), &session.session_id).await;
            return Ok(RdpConnectOutcome::Failed {
                stage: "credential",
                detail,
            });
        }
    }

    Ok(outcome)
}

#[tauri::command]
async fn rdp_input(
    session_id: String,
    request: RdpInputRequest,
    registry: State<'_, Arc<RdpRegistry>>,
) -> Result<(), String> {
    crate::rdp::input(registry.inner(), &session_id, request).await
}

#[tauri::command]
async fn rdp_disconnect(
    app: AppHandle,
    session_id: String,
    registry: State<'_, Arc<RdpRegistry>>,
) -> Result<(), String> {
    crate::rdp::disconnect(&app, registry.inner(), &session_id).await
}

#[tauri::command]
fn rdp_sessions(registry: State<'_, Arc<RdpRegistry>>) -> Vec<RdpSessionSummary> {
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

#[tauri::command]
async fn tunnel_start(
    request: StartTunnelRequest,
    registry: State<'_, Arc<TunnelRegistry>>,
) -> Result<TunnelStatusSummary, String> {
    crate::tunnel::start_tunnel(Arc::clone(registry.inner()), request).await
}

#[tauri::command]
fn tunnel_stop(tunnel_id: String, registry: State<'_, Arc<TunnelRegistry>>) -> Result<(), String> {
    registry.stop(&tunnel_id)
}

#[tauri::command]
fn tunnel_status(
    tunnel_id: String,
    registry: State<'_, Arc<TunnelRegistry>>,
) -> Result<Option<TunnelStatusSummary>, String> {
    Ok(registry.status(&tunnel_id))
}

#[tauri::command]
fn tunnel_list(
    registry: State<'_, Arc<TunnelRegistry>>,
) -> Result<Vec<TunnelStatusSummary>, String> {
    Ok(registry.list())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Connection data belongs beside the app's other data, not next to
            // the executable, so it survives an update and follows the user
            // profile on a shared machine.
            let dir = app.path().app_data_dir()?;
            let storage = FileStorage::open(&dir)?;
            app.manage(Mutex::new(storage));
            let agent_plans = FileAgentPlanStore::open(&dir).map_err(std::io::Error::other)?;
            app.manage(Mutex::new(agent_plans));

            // A trust store that cannot be read is carried as a reason rather
            // than a panic: the app still runs, and connecting explains why it
            // will not proceed.
            let trust = match HostTrustStore::open(&dir) {
                Ok(store) => TrustState::Ready(Mutex::new(store)),
                Err(error) => TrustState::Unavailable(error.to_string()),
            };
            app.manage(trust);
            app.manage(Arc::new(SshRegistry::new()));
            app.manage(Arc::new(SftpRegistry::new()));
            app.manage(Arc::new(RemoteRegistry::new()));
            app.manage(Arc::new(RemoteHostRegistry::new()));
            app.manage(Arc::new(RdpRegistry::new()));
            app.manage(Arc::new(TunnelRegistry::new()));
            let agent_registry = AgentRegistry::with_local_reporter(Arc::new(
                crate::agent::EventSink(app.handle().clone()),
            ))
            .map_err(std::io::Error::other)?;
            app.manage(agent_registry);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            runtime_summary,
            agent_catalog,
            agent_default_working_directory,
            agent_launch,
            agent_send,
            agent_broadcast,
            agent_resize,
            agent_disconnect,
            agent_sessions,
            agent_plan_snapshot,
            agent_plan_save,
            agent_plan_delete,
            agent_workspace_rename,
            agent_plan_reorder,
            agent_plan_restore,
            credential_status,
            credential_exists,
            credential_delete,
            storage_status,
            list_connection_profiles,
            save_connection_profile,
            delete_connection_profile,
            ssh_connect,
            ssh_send,
            ssh_resize,
            ssh_disconnect,
            ssh_sessions,
            sftp_connect,
            sftp_sessions,
            sftp_list,
            sftp_create_directory,
            sftp_rename,
            sftp_remove,
            sftp_read_file,
            sftp_write_file,
            sftp_disconnect,
            remote_connect,
            remote_disconnect,
            remote_sessions,
            remote_host_start,
            remote_host_stop,
            remote_host_status,
            rdp_connect,
            rdp_input,
            rdp_disconnect,
            rdp_sessions,
            ssh_trust_host,
            ssh_known_hosts,
            ssh_forget_host,
            tunnel_start,
            tunnel_stop,
            tunnel_status,
            tunnel_list
        ])
        .build(tauri::generate_context!())
        .expect("error while building LatticeTerm");
    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
            handle.state::<Arc<AgentRegistry>>().stop_all();
            handle.state::<Arc<TunnelRegistry>>().stop_all();
        }
    });
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
    fn runtime_summary_reports_the_real_secure_storage_status() {
        let summary = runtime_summary();

        assert_eq!(summary.app_name, "LatticeTerm");
        assert_eq!(
            summary.supported_protocols,
            ["ssh", "sftp", "rdp", "lattice"]
        );
        assert_eq!(
            summary.credential_storage_ready,
            crate::credentials::status().ready
        );
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
