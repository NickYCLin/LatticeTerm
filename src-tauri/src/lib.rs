pub mod agent;
pub mod agent_plans;
pub mod backup;
pub mod clipboard;
pub mod credentials;
pub mod domain;
pub mod hostkeys;
#[cfg(target_os = "linux")]
pub mod linux_webkit;
pub mod metrics;
pub mod rdp;
pub mod remote;
pub mod remote_host;
pub mod sftp;
pub mod sftp_transfers;
pub mod ssh;
pub mod storage;
pub mod transcript;
pub mod tunnel;
pub mod vault;
pub mod vnc;

use crate::agent::{
    AgentBroadcastOutcome, AgentDefinition, AgentLaunchPlan, AgentLaunchPlanDraft,
    AgentLaunchRequest, AgentOutputSnapshot, AgentRegistry, AgentRestoreOutcome,
    AgentSessionSummary, MAX_SAVED_AGENT_PLANS,
};
use crate::agent_plans::{AgentPlanSnapshot, FileAgentPlanStore};
use crate::backup::{DecryptedBackup, ValidatedAppData};
use crate::clipboard::{SensitiveClipboard, SensitiveClipboardClearOutcome};
use crate::credentials::{CredentialKind, CredentialStoreStatus};
use crate::domain::{ConnectionProfile, Protocol};
use crate::hostkeys::{HostKeyRecord, HostTrustStore};
use crate::rdp::{
    RdpConnectOutcome, RdpConnectRequest, RdpInputRequest, RdpRegistry, RdpSessionSummary,
};
use crate::remote::{
    RemoteConnectOutcome, RemoteConnectRequest, RemoteInputRequest, RemoteRegistry,
    RemoteSessionSummary,
};
use crate::remote_host::{RemoteHostRegistry, RemoteHostStartRequest, RemoteHostStatus};
use crate::sftp::{
    SftpConnectOutcome, SftpConnectRequest, SftpDirectory, SftpRegistry, SftpSessionSummary,
};
use crate::sftp_transfers::{TransferRegistry, TransferState};
use crate::ssh::{ConnectOutcome, ConnectRequest, EventSink, SessionSummary, SshRegistry};
use crate::storage::{FileStorage, Storage};
use crate::tunnel::{StartTunnelRequest, TunnelRegistry, TunnelStatus, TunnelStatusSummary};
use crate::vnc::{
    VncConnectOutcome, VncConnectRequest, VncInputRequest, VncRegistry, VncSessionSummary,
};
use serde::Serialize;
use std::collections::{BTreeMap, HashSet};
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

async fn backup_call<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("Backup operation did not complete: {error}"))?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSummary {
    app_name: &'static str,
    version: &'static str,
    supported_protocols: [&'static str; 4],
    credential_storage_ready: bool,
    /// "windows" | "macos" | "linux" | "android" | "ios" — the interface
    /// hides desktop-only areas (agents, sidecar engines) on mobile.
    platform: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EncryptedBackupExport {
    contents: String,
    created_at: u64,
    app_file_count: usize,
    vault_included: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EncryptedBackupRestore {
    source_created_at: u64,
    source_app_version: String,
    profile_count: usize,
    trusted_host_count: usize,
    agent_plan_count: usize,
    vault_included: bool,
    local_storage: BTreeMap<String, String>,
}

#[tauri::command]
fn runtime_summary() -> RuntimeSummary {
    RuntimeSummary {
        app_name: "LatticeTerm",
        version: env!("CARGO_PKG_VERSION"),
        supported_protocols: ["ssh", "sftp", "rdp", "lattice"],
        credential_storage_ready: crate::credentials::status().ready,
        platform: std::env::consts::OS,
    }
}

fn backup_trust_guard(
    trust: &TrustState,
) -> Result<std::sync::MutexGuard<'_, HostTrustStore>, String> {
    match trust {
        TrustState::Ready(store) => store.lock().map_err(|error| error.to_string()),
        TrustState::Unavailable(reason) => Err(format!(
            "Host trust data is unavailable and cannot be backed up: {reason}"
        )),
    }
}

#[tauri::command]
async fn encrypted_backup_export(
    app: AppHandle,
    password: String,
    local_storage: BTreeMap<String, String>,
    storage: State<'_, AppStorage>,
    plans: State<'_, AppAgentPlans>,
    trust: State<'_, TrustState>,
) -> Result<EncryptedBackupExport, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let (files, validated) = crate::vault::manager()?.run_while_locked(|| {
        // Hold every mutable file-backed store while taking the snapshot, so
        // one logical backup cannot contain half of a concurrent mutation.
        let _storage = storage.lock().map_err(|error| error.to_string())?;
        let _plans = plans.lock().map_err(|error| error.to_string())?;
        let _trust = backup_trust_guard(trust.inner())?;
        let files = crate::backup::read_app_files(&directory)?;
        let validated = crate::backup::validate_app_files(&files)?;
        Ok((files, validated))
    })?;
    let created_at = now_seconds();
    let app_file_count = files.len();
    let contents = backup_call(move || {
        let password = Zeroizing::new(password);
        crate::backup::create_encrypted_backup(
            env!("CARGO_PKG_VERSION"),
            created_at,
            files,
            local_storage,
            password.as_str(),
        )
    })
    .await?;
    Ok(EncryptedBackupExport {
        contents,
        created_at,
        app_file_count,
        vault_included: validated.vault_included,
    })
}

fn restore_loaded_stores(
    directory: &std::path::Path,
) -> Result<(FileStorage, FileAgentPlanStore, HostTrustStore), String> {
    let storage = FileStorage::open(directory).map_err(|error| error.to_string())?;
    if let Some(recovery) = storage.recovery() {
        return Err(format!(
            "Restored connection data is invalid: {}",
            recovery.reason
        ));
    }
    let plans = FileAgentPlanStore::open(directory)?;
    if let Some(recovery) = plans.snapshot().recovery {
        return Err(format!(
            "Restored Agent workspace data is invalid: {}",
            recovery.reason
        ));
    }
    let trust = HostTrustStore::open(directory).map_err(|error| error.to_string())?;
    Ok((storage, plans, trust))
}

fn restore_failure_with_rollback(
    directory: &std::path::Path,
    previous: &BTreeMap<String, String>,
    error: String,
) -> String {
    match crate::backup::rollback_app_files(directory, previous) {
        Ok(()) => format!("The backup restore was rolled back: {error}"),
        Err(rollback_error) => format!(
            "The backup restore failed ({error}), and rollback also failed ({rollback_error})."
        ),
    }
}

#[tauri::command]
async fn encrypted_backup_restore(
    app: AppHandle,
    contents: String,
    password: String,
    storage: State<'_, AppStorage>,
    plans: State<'_, AppAgentPlans>,
    trust: State<'_, TrustState>,
    tunnels: State<'_, Arc<TunnelRegistry>>,
) -> Result<EncryptedBackupRestore, String> {
    if tunnels
        .list()
        .iter()
        .any(|entry| matches!(entry.status, TunnelStatus::Starting | TunnelStatus::Active))
    {
        return Err("Stop every running SSH tunnel before restoring a backup.".to_string());
    }

    let (decrypted, validated) = backup_call(move || {
        let password = Zeroizing::new(password);
        let decrypted = crate::backup::open_encrypted_backup(&contents, password.as_str())?;
        let validated = crate::backup::validate_app_files(&decrypted.files)?;
        Ok((decrypted, validated))
    })
    .await?;
    let DecryptedBackup {
        created_at,
        app_version,
        files,
        local_storage,
    } = decrypted;
    let ValidatedAppData {
        profile_count,
        trusted_host_count,
        agent_plan_count,
        vault_included,
    } = validated;

    if tunnels
        .list()
        .iter()
        .any(|entry| matches!(entry.status, TunnelStatus::Starting | TunnelStatus::Active))
    {
        return Err("Stop every running SSH tunnel before restoring a backup.".to_string());
    }

    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    crate::vault::manager()?.run_while_locked(|| {
        let mut storage_guard = storage.lock().map_err(|error| error.to_string())?;
        let mut plans_guard = plans.lock().map_err(|error| error.to_string())?;
        let mut trust_guard = backup_trust_guard(trust.inner())?;
        let previous = crate::backup::replace_app_files(&directory, &files)?;
        let (next_storage, next_plans, next_trust) = match restore_loaded_stores(&directory) {
            Ok(stores) => stores,
            Err(error) => {
                return Err(restore_failure_with_rollback(&directory, &previous, error));
            }
        };

        *storage_guard = next_storage;
        *plans_guard = next_plans;
        *trust_guard = next_trust;
        Ok(())
    })?;

    Ok(EncryptedBackupRestore {
        source_created_at: created_at,
        source_app_version: app_version,
        profile_count,
        trusted_host_count,
        agent_plan_count,
        vault_included,
        local_storage,
    })
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
    mut request: AgentLaunchRequest,
    registry: State<'_, Arc<AgentRegistry>>,
    plans: State<'_, AppAgentPlans>,
) -> Result<AgentSessionSummary, String> {
    let startup_instructions = plans
        .lock()
        .map_err(|error| error.to_string())?
        .snapshot()
        .startup_instructions;
    crate::agent::apply_startup_instructions(&mut request, &startup_instructions)?;
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

/// Writes an image sitting on the clipboard to a temp PNG and returns its path.
///
/// Local agent CLIs (Claude Code, Gemini, …) accept an image by its file path,
/// so on Ctrl+V the frontend pastes this path in. Returns `None` when the
/// clipboard holds no image, which the caller treats as "nothing to paste".
#[tauri::command]
fn agent_paste_clipboard_image(
    app: AppHandle,
    session_id: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    // Reserved for future per-session scoping; kept so the wire contract is
    // stable if we ever route pastes to a session-specific staging area.
    let _ = session_id;

    let image = match app.clipboard().read_image() {
        Ok(image) => image,
        Err(_) => return Ok(None),
    };
    let width = image.width();
    let height = image.height();
    if width == 0 || height == 0 {
        return Ok(None);
    }
    let rgba = image.rgba().to_vec();

    let mut file = tempfile::Builder::new()
        .prefix("latticeterm-clip-")
        .suffix(".png")
        .tempfile()
        .map_err(|err| format!("Cannot stage the pasted image: {err}"))?;
    {
        let writer = std::io::BufWriter::new(file.as_file_mut());
        let mut encoder = png::Encoder::new(writer, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut png_writer = encoder
            .write_header()
            .map_err(|err| format!("Cannot encode the pasted image: {err}"))?;
        png_writer
            .write_image_data(&rgba)
            .map_err(|err| format!("Cannot encode the pasted image: {err}"))?;
    }
    let (_, path) = file
        .keep()
        .map_err(|err| format!("Cannot save the pasted image: {err}"))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Reads a running CLI's own conversation into plain, role-labelled text so it
/// can be handed to another CLI as an opening brief. `None` when the CLI's
/// history format is unsupported or nothing was found.
#[tauri::command]
fn agent_export_transcript(
    session_id: String,
    registry: State<'_, Arc<AgentRegistry>>,
) -> Result<Option<String>, String> {
    const MAX_HANDOFF_CHARS: usize = 12000;
    let Some(summary) = registry.session_summary(&session_id) else {
        return Ok(None);
    };
    let Some(kind) = crate::transcript::TranscriptKind::from_definition(&summary.definition_id)
    else {
        return Ok(None);
    };
    Ok(crate::transcript::export(
        kind,
        &summary.working_directory,
        summary.captured_session_id.as_deref(),
        MAX_HANDOFF_CHARS,
    ))
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
fn agent_rename(
    session_id: String,
    label: String,
    registry: State<'_, Arc<AgentRegistry>>,
) -> Result<AgentSessionSummary, String> {
    registry.rename(&session_id, &label)
}

#[tauri::command]
fn agent_output_snapshots(registry: State<'_, Arc<AgentRegistry>>) -> Vec<AgentOutputSnapshot> {
    registry.output_snapshots()
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
fn agent_workspace_instructions_update(
    instructions: String,
    plans: State<'_, AppAgentPlans>,
) -> Result<String, String> {
    plans
        .lock()
        .map_err(|error| error.to_string())?
        .update_startup_instructions(&instructions)
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

    let (selected, startup_instructions) = {
        let guard = plans.lock().map_err(|error| error.to_string())?;
        let selected = plan_ids
            .iter()
            .map(|plan_id| {
                guard
                    .find(plan_id)
                    .ok_or_else(|| format!("Saved launch plan '{plan_id}' no longer exists."))
            })
            .collect::<Result<Vec<_>, _>>()?;
        (selected, guard.snapshot().startup_instructions)
    };
    let sink: Arc<dyn crate::agent::AgentSink> = Arc::new(crate::agent::EventSink(app));
    Ok(selected
        .into_iter()
        .map(|plan| {
            let plan_id = plan.id.clone();
            let label = plan.label.clone();
            let launched =
                crate::agent::launch_request_from_plan(&plan, 120, 32).and_then(|mut request| {
                    crate::agent::apply_startup_instructions(&mut request, &startup_instructions)?;
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
fn replace_connection_profiles(
    profiles: Vec<ConnectionProfile>,
    storage: State<'_, AppStorage>,
) -> Result<(), String> {
    let mut guard = storage.lock().map_err(|e| e.to_string())?;
    guard.replace_profiles(profiles).map_err(|e| e.to_string())
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
                Protocol::Vnc => Some(CredentialKind::VncPassword),
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
fn credential_backend_get() -> crate::credentials::CredentialBackend {
    crate::credentials::preferred_backend()
}

#[tauri::command]
fn credential_backend_set(
    backend: crate::credentials::CredentialBackend,
) -> Result<crate::credentials::CredentialBackend, String> {
    crate::credentials::set_preferred_backend(backend)
}

#[tauri::command]
fn vault_status() -> Result<crate::vault::VaultStatus, String> {
    Ok(crate::vault::manager()?.status())
}

#[tauri::command]
async fn vault_create(master_password: String) -> Result<crate::vault::VaultStatus, String> {
    // Argon2id takes real time by design; keep it off the event loop.
    credential_call(move || crate::vault::manager()?.create(&master_password)).await
}

#[tauri::command]
async fn vault_unlock(master_password: String) -> Result<crate::vault::VaultStatus, String> {
    credential_call(move || crate::vault::manager()?.unlock(&master_password)).await
}

#[tauri::command]
fn vault_lock() -> Result<crate::vault::VaultStatus, String> {
    Ok(crate::vault::manager()?.lock())
}

#[tauri::command]
async fn vault_change_password(
    current_password: String,
    new_password: String,
) -> Result<crate::vault::VaultStatus, String> {
    credential_call(move || {
        crate::vault::manager()?.change_password(&current_password, &new_password)
    })
    .await
}

#[tauri::command]
fn sensitive_clipboard_copy(
    app: AppHandle,
    value: String,
    clear_after_seconds: Option<u64>,
    clipboard: State<'_, Arc<SensitiveClipboard>>,
) -> Result<(), String> {
    clipboard.copy(&app, value, clear_after_seconds)
}

#[tauri::command]
fn sensitive_clipboard_clear(
    app: AppHandle,
    clipboard: State<'_, Arc<SensitiveClipboard>>,
) -> SensitiveClipboardClearOutcome {
    clipboard.clear_current(&app)
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
            // A key never has a password to remember; the checkbox is hidden
            // for key authentication, so this arm is purely defensive.
            crate::ssh::AuthMethod::PrivateKey { .. } => None,
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
async fn host_metrics(
    session_id: String,
    registry: State<'_, Arc<SshRegistry>>,
) -> Result<crate::metrics::HostMetricsPayload, String> {
    crate::metrics::collect_for_session(registry.inner(), &session_id).await
}

#[tauri::command]
fn ssh_default_keys() -> Vec<String> {
    crate::ssh::default_key_paths()
}

#[tauri::command]
fn ssh_sessions(registry: State<'_, Arc<SshRegistry>>) -> Vec<SessionSummary> {
    registry.list()
}

/// Opens an SFTP file browser on an existing SSH terminal session — the
/// MobaXterm-style side panel — without a second connection or login.
#[tauri::command]
async fn sftp_attach_ssh(
    ssh_session_id: String,
    ssh: State<'_, Arc<SshRegistry>>,
    sftp: State<'_, Arc<SftpRegistry>>,
) -> Result<SftpConnectOutcome, String> {
    let Some((summary, transport)) = ssh.session_transport(&ssh_session_id) else {
        return Err(format!("SSH session '{ssh_session_id}' is not connected."));
    };
    Ok(crate::sftp::attach_to_ssh(Arc::clone(sftp.inner()), summary, transport).await)
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
            // A key never has a password to remember; the checkbox is hidden
            // for key authentication, so this arm is purely defensive.
            crate::ssh::AuthMethod::PrivateKey { .. } => None,
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
async fn sftp_download_start(
    app: AppHandle,
    session_id: String,
    remote_path: String,
    sessions: State<'_, Arc<SftpRegistry>>,
    transfers: State<'_, Arc<TransferRegistry>>,
) -> Result<TransferState, String> {
    // Downloads land in the OS download folder: always writable, always where
    // the user already looks for arriving files.
    let target = app
        .path()
        .download_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|error| format!("no download folder is available: {error}"))?;
    crate::sftp_transfers::start_download(
        Arc::clone(transfers.inner()),
        sessions.inner(),
        Arc::new(crate::sftp_transfers::EventSink(app.clone())),
        &session_id,
        &remote_path,
        target,
    )
    .await
}

#[tauri::command]
async fn sftp_upload_begin(
    app: AppHandle,
    plan: crate::sftp_transfers::UploadPlan,
    sessions: State<'_, Arc<SftpRegistry>>,
    transfers: State<'_, Arc<TransferRegistry>>,
) -> Result<TransferState, String> {
    crate::sftp_transfers::begin_upload(
        Arc::clone(transfers.inner()),
        sessions.inner(),
        &crate::sftp_transfers::EventSink(app.clone()),
        plan,
    )
    .await
}

#[tauri::command]
async fn sftp_upload_path(
    app: AppHandle,
    session_id: String,
    parent: String,
    local_path: String,
    overwrite: bool,
    sessions: State<'_, Arc<SftpRegistry>>,
    transfers: State<'_, Arc<TransferRegistry>>,
) -> Result<TransferState, String> {
    crate::sftp_transfers::start_upload_from_path(
        Arc::clone(transfers.inner()),
        sessions.inner(),
        Arc::new(crate::sftp_transfers::EventSink(app.clone())),
        &session_id,
        &parent,
        std::path::PathBuf::from(local_path),
        overwrite,
    )
    .await
}

#[tauri::command]
async fn sftp_upload_chunk(
    app: AppHandle,
    transfer_id: String,
    data: String,
    transfers: State<'_, Arc<TransferRegistry>>,
) -> Result<(), String> {
    crate::sftp_transfers::upload_chunk(
        transfers.inner(),
        &crate::sftp_transfers::EventSink(app.clone()),
        &transfer_id,
        &data,
    )
    .await
}

#[tauri::command]
async fn sftp_upload_finish(
    app: AppHandle,
    transfer_id: String,
    transfers: State<'_, Arc<TransferRegistry>>,
) -> Result<(), String> {
    crate::sftp_transfers::finish_upload(
        transfers.inner(),
        &crate::sftp_transfers::EventSink(app.clone()),
        &transfer_id,
    )
    .await
}

#[tauri::command]
async fn sftp_transfer_cancel(
    app: AppHandle,
    transfer_id: String,
    transfers: State<'_, Arc<TransferRegistry>>,
) -> Result<(), String> {
    crate::sftp_transfers::cancel(
        transfers.inner(),
        &crate::sftp_transfers::EventSink(app.clone()),
        &transfer_id,
    )
    .await
}

#[tauri::command]
fn sftp_transfer_dismiss(
    transfer_id: String,
    transfers: State<'_, Arc<TransferRegistry>>,
) -> Result<(), String> {
    transfers.dismiss(&transfer_id)
}

#[tauri::command]
fn sftp_transfers(transfers: State<'_, Arc<TransferRegistry>>) -> Vec<TransferState> {
    transfers.list()
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
    app: AppHandle,
    session_id: String,
    registry: State<'_, Arc<SftpRegistry>>,
    transfers: State<'_, Arc<TransferRegistry>>,
) -> Result<(), String> {
    let cancel_result = crate::sftp_transfers::cancel_session(
        transfers.inner(),
        &crate::sftp_transfers::EventSink(app),
        &session_id,
    )
    .await;
    let disconnect_result = crate::sftp::disconnect(registry.inner(), &session_id).await;
    match (cancel_result, disconnect_result) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(cancel_error), Ok(())) => Err(format!(
            "the session closed, but one or more transfers could not be cleaned up: {cancel_error}"
        )),
        (Ok(()), Err(disconnect_error)) => Err(disconnect_error),
        (Err(cancel_error), Err(disconnect_error)) => Err(format!(
            "transfer cleanup failed ({cancel_error}); closing the SFTP session also failed ({disconnect_error})"
        )),
    }
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
fn remote_input(
    session_id: String,
    request: RemoteInputRequest,
    registry: State<'_, Arc<RemoteRegistry>>,
) -> Result<(), String> {
    crate::remote::input(registry.inner(), &session_id, request)
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
async fn vnc_connect(
    app: AppHandle,
    mut request: VncConnectRequest,
    registry: State<'_, Arc<VncRegistry>>,
) -> Result<VncConnectOutcome, String> {
    if request.use_saved_password && request.remember_password {
        return Ok(VncConnectOutcome::Failed {
            stage: "credential",
            detail: "Choose either the saved password or a new password to remember.".to_string(),
        });
    }

    if request.use_saved_password {
        let profile_id = request.profile_id.clone();
        request.password = match credential_call(move || {
            crate::credentials::load(&profile_id, CredentialKind::VncPassword)
        })
        .await
        {
            Ok(password) => password,
            Err(detail) => {
                return Ok(VncConnectOutcome::Failed {
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
    let outcome = crate::vnc::connect(app.clone(), Arc::clone(registry.inner()), request).await;

    if let (VncConnectOutcome::Connected { session }, Some(password)) =
        (&outcome, password_to_store)
    {
        let save_result = credential_call(move || {
            crate::credentials::store(&profile_id, CredentialKind::VncPassword, password.as_str())
        })
        .await;
        if let Err(detail) = save_result {
            let _ = crate::vnc::disconnect(&app, registry.inner(), &session.session_id).await;
            return Ok(VncConnectOutcome::Failed {
                stage: "credential",
                detail,
            });
        }
    }

    Ok(outcome)
}

#[tauri::command]
async fn vnc_input(
    session_id: String,
    request: VncInputRequest,
    registry: State<'_, Arc<VncRegistry>>,
) -> Result<(), String> {
    crate::vnc::input(registry.inner(), &session_id, request).await
}

#[tauri::command]
async fn vnc_disconnect(
    app: AppHandle,
    session_id: String,
    registry: State<'_, Arc<VncRegistry>>,
) -> Result<(), String> {
    crate::vnc::disconnect(&app, registry.inner(), &session_id).await
}

#[tauri::command]
fn vnc_sessions(registry: State<'_, Arc<VncRegistry>>) -> Vec<VncSessionSummary> {
    registry.list()
}

#[tauri::command]
async fn tunnel_start(
    mut request: StartTunnelRequest,
    storage: State<'_, AppStorage>,
    trust: State<'_, TrustState>,
    registry: State<'_, Arc<TunnelRegistry>>,
) -> Result<TunnelStatusSummary, String> {
    // A tunnel rides its own SSH session, so it needs the same two things a
    // terminal session needs: a trusted host key and a credential. Both are
    // resolved here, before any listener exists, so failure leaves nothing
    // half-started behind.
    // Resolve the endpoint from the stored profile. The WebView only selects
    // an opaque id; altering IPC fields cannot pair that profile's credential
    // with a different SSH host.
    let profile = {
        let guard = storage.lock().map_err(|error| error.to_string())?;
        guard
            .get_profile(&request.profile_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "profile:the SSH gateway profile no longer exists".to_string())?
    };
    if profile.protocol != Protocol::Ssh {
        return Err("profile:SSH tunnels require an SSH connection profile".to_string());
    }
    request.ssh_hostname = profile.hostname;
    request.ssh_port = profile.port;
    request.ssh_username = profile.username;

    let known: Option<HostKeyRecord> = match trust.inner() {
        TrustState::Unavailable(reason) => return Err(format!("trust:{reason}")),
        TrustState::Ready(store) => {
            let guard = store.lock().map_err(|e| e.to_string())?;
            crate::ssh::known_record(&guard, &request.ssh_hostname, request.ssh_port)
        }
    };

    if known.is_none() {
        return Err(
            "trust:this host is not trusted yet — connect over SSH once to confirm its fingerprint"
                .to_string(),
        );
    }

    let profile_id = request.profile_id.clone();
    let password = Zeroizing::new(
        credential_call(move || crate::credentials::load(&profile_id, CredentialKind::SshPassword))
            .await
            .map_err(|detail| format!("credential:{detail}"))?,
    );

    crate::tunnel::start_tunnel(
        Arc::clone(registry.inner()),
        request,
        password.as_str(),
        known,
    )
    .await
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
    #[cfg(desktop)]
    let builder = tauri::Builder::default().plugin(tauri_plugin_single_instance::init(
        |app, _arguments, _working_directory| {
            if let Some(window) = app.get_webview_window("main") {
                let handle = window.clone();
                let _ = window.run_on_main_thread(move || {
                    let _ = handle.show();
                    let _ = handle.unminimize();
                    let _ = handle.set_focus();
                    #[cfg(target_os = "linux")]
                    if let Ok(gtk_window) = handle.gtk_window() {
                        use gtk::prelude::{GtkWindowExt, WidgetExt};

                        gtk_window.hide();
                        gtk_window.show_all();
                        gtk_window.deiconify();
                        gtk_window.present();
                    }
                });
            }
        },
    ));
    #[cfg(mobile)]
    let builder = tauri::Builder::default();
    let builder = builder.plugin(tauri_plugin_clipboard_manager::init());
    // Auto-update and relaunch are desktop concerns; mobile installs come
    // from a package manager and restart through the OS.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());
    let app = builder
        .setup(|app| {
            // Connection data belongs beside the app's other data, not next to
            // the executable, so it survives an update and follows the user
            // profile on a shared machine.
            let dir = app.path().app_data_dir()?;
            // The credential router and the encrypted vault live in the same
            // directory as the rest of the app's data.
            crate::credentials::initialize(dir.clone());
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
            app.manage(Arc::new(TransferRegistry::new()));
            app.manage(Arc::new(RemoteRegistry::new()));
            app.manage(Arc::new(RemoteHostRegistry::new()));
            app.manage(Arc::new(RdpRegistry::new()));
            app.manage(Arc::new(VncRegistry::new()));
            app.manage(Arc::new(TunnelRegistry::new()));
            app.manage(Arc::new(SensitiveClipboard::default()));
            let agent_registry = AgentRegistry::with_local_reporter(Arc::new(
                crate::agent::EventSink(app.handle().clone()),
            ))
            .map_err(std::io::Error::other)?;
            app.manage(agent_registry);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            runtime_summary,
            encrypted_backup_export,
            encrypted_backup_restore,
            agent_catalog,
            agent_default_working_directory,
            agent_launch,
            agent_send,
            agent_broadcast,
            agent_paste_clipboard_image,
            agent_export_transcript,
            agent_resize,
            agent_disconnect,
            agent_sessions,
            agent_rename,
            agent_output_snapshots,
            agent_plan_snapshot,
            agent_plan_save,
            agent_plan_delete,
            agent_workspace_rename,
            agent_workspace_instructions_update,
            agent_plan_reorder,
            agent_plan_restore,
            credential_status,
            credential_backend_get,
            credential_backend_set,
            vault_status,
            vault_create,
            vault_unlock,
            vault_lock,
            vault_change_password,
            sensitive_clipboard_copy,
            sensitive_clipboard_clear,
            credential_exists,
            credential_delete,
            storage_status,
            list_connection_profiles,
            save_connection_profile,
            replace_connection_profiles,
            delete_connection_profile,
            ssh_connect,
            ssh_send,
            ssh_resize,
            ssh_disconnect,
            ssh_sessions,
            ssh_default_keys,
            host_metrics,
            sftp_connect,
            sftp_attach_ssh,
            sftp_sessions,
            sftp_list,
            sftp_create_directory,
            sftp_rename,
            sftp_remove,
            sftp_read_file,
            sftp_write_file,
            sftp_disconnect,
            sftp_download_start,
            sftp_upload_begin,
            sftp_upload_path,
            sftp_upload_chunk,
            sftp_upload_finish,
            sftp_transfer_cancel,
            sftp_transfer_dismiss,
            sftp_transfers,
            remote_connect,
            remote_disconnect,
            remote_sessions,
            remote_input,
            remote_host_start,
            remote_host_stop,
            remote_host_status,
            rdp_connect,
            rdp_input,
            rdp_disconnect,
            rdp_sessions,
            vnc_connect,
            vnc_input,
            vnc_disconnect,
            vnc_sessions,
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
            handle
                .state::<Arc<SensitiveClipboard>>()
                .clear_auto_on_exit(handle);
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
