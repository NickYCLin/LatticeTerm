//! Credential storage, routed across two backends.
//!
//! Secrets are addressed by an opaque profile id and credential kind. The
//! plaintext value is only returned to the Rust connection command that needs
//! it; there is deliberately no Tauri command that exposes saved secrets to
//! the WebView.
//!
//! Two backends exist: the OS credential store (default) and the encrypted
//! vault (`vault.rs`). New secrets go to whichever the user prefers; reads
//! check the preferred backend first and quietly fall back to the other, so
//! switching preference never strands what was saved before.

use keyring::{Entry, Error};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::OnceLock;

const SERVICE: &str = "io.github.NickYCLin.LatticeTerm";
const MAX_PROFILE_ID_LENGTH: usize = 128;
const BACKEND_FILE: &str = "credential_backend.json";

/// Where new secrets are written. Reads always cover both.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CredentialBackend {
    OsKeyring,
    Vault,
}

#[derive(Serialize, Deserialize)]
struct BackendFile {
    version: u32,
    backend: CredentialBackend,
}

static DIRECTORY: OnceLock<PathBuf> = OnceLock::new();

/// Called once at startup with the app data directory. Also brings up the
/// vault manager, which lives in the same place.
pub fn initialize(directory: PathBuf) {
    crate::vault::initialize(directory.clone());
    let _ = DIRECTORY.set(directory);
}

fn backend_path() -> Option<PathBuf> {
    DIRECTORY.get().map(|dir| dir.join(BACKEND_FILE))
}

pub fn preferred_backend() -> CredentialBackend {
    let Some(path) = backend_path() else {
        return CredentialBackend::OsKeyring;
    };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<BackendFile>(&raw).ok())
        .map(|file| file.backend)
        .unwrap_or(CredentialBackend::OsKeyring)
}

pub fn set_preferred_backend(backend: CredentialBackend) -> Result<CredentialBackend, String> {
    if backend == CredentialBackend::Vault {
        let vault = crate::vault::manager()?;
        if !vault.exists() {
            return Err("create the vault before making it the primary store".to_string());
        }
    }
    let path = backend_path().ok_or_else(|| "credential storage is not initialised".to_string())?;
    let encoded = serde_json::to_string_pretty(&BackendFile {
        version: 1,
        backend,
    })
    .map_err(|error| error.to_string())?;
    std::fs::write(path, encoded).map_err(|error| error.to_string())?;
    Ok(backend)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CredentialKind {
    SshPassword,
    SftpPassword,
    RdpPassword,
    VncPassword,
}

impl CredentialKind {
    fn suffix(self) -> &'static str {
        match self {
            Self::SshPassword => "ssh-password",
            Self::SftpPassword => "sftp-password",
            Self::RdpPassword => "rdp-password",
            Self::VncPassword => "vnc-password",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialStoreStatus {
    pub ready: bool,
    pub provider: String,
    pub detail: Option<String>,
    pub backend: CredentialBackend,
}

fn provider() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "Windows Credential Manager"
    }
    #[cfg(target_os = "macos")]
    {
        "macOS Keychain"
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        "Secret Service"
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", unix)))]
    {
        "Unsupported platform"
    }
}

fn account(profile_id: &str, kind: CredentialKind) -> Result<String, String> {
    let profile_id = profile_id.trim();
    if profile_id.is_empty() || profile_id.len() > MAX_PROFILE_ID_LENGTH {
        return Err("The credential profile id is missing or too long.".to_string());
    }
    if !profile_id
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("The credential profile id contains unsupported characters.".to_string());
    }
    Ok(format!("profile:{profile_id}:{}", kind.suffix()))
}

fn entry(profile_id: &str, kind: CredentialKind) -> Result<Entry, String> {
    let account = account(profile_id, kind)?;
    Entry::new(SERVICE, &account).map_err(|error| error.to_string())
}

const NOT_FOUND: &str = "No saved credential exists for this connection.";

/// The status of whichever backend new secrets would go to right now.
pub fn status() -> CredentialStoreStatus {
    match preferred_backend() {
        CredentialBackend::OsKeyring => match Entry::store_status() {
            Ok(()) => CredentialStoreStatus {
                ready: true,
                provider: provider().to_string(),
                detail: None,
                backend: CredentialBackend::OsKeyring,
            },
            Err(error) => CredentialStoreStatus {
                ready: false,
                provider: provider().to_string(),
                detail: Some(error.to_string()),
                backend: CredentialBackend::OsKeyring,
            },
        },
        CredentialBackend::Vault => {
            let unlocked = crate::vault::manager()
                .map(|vault| vault.is_unlocked())
                .unwrap_or(false);
            CredentialStoreStatus {
                ready: unlocked,
                provider: "Encrypted vault".to_string(),
                detail: (!unlocked)
                    .then(|| "the vault is locked; unlock it in the Key Vault".to_string()),
                backend: CredentialBackend::Vault,
            }
        }
    }
}

fn keyring_exists(profile_id: &str, kind: CredentialKind) -> Result<bool, String> {
    match entry(profile_id, kind)?.get_password() {
        Ok(secret) => {
            let mut bytes = secret.into_bytes();
            zeroize::Zeroize::zeroize(&mut bytes);
            Ok(true)
        }
        Err(Error::NoEntry) => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

fn vault_exists(profile_id: &str, kind: CredentialKind) -> Result<bool, String> {
    crate::vault::manager()?.exists_entry(&account(profile_id, kind)?)
}

fn keyring_load(profile_id: &str, kind: CredentialKind) -> Result<String, String> {
    entry(profile_id, kind)?
        .get_password()
        .map_err(|error| match error {
            Error::NoEntry => NOT_FOUND.to_string(),
            other => other.to_string(),
        })
}

fn vault_load(profile_id: &str, kind: CredentialKind) -> Result<String, String> {
    crate::vault::manager()?.load(&account(profile_id, kind)?)
}

/// True in either backend counts; a backend that cannot answer right now (a
/// locked vault, a missing keyring) simply cannot vouch either way.
pub fn exists(profile_id: &str, kind: CredentialKind) -> Result<bool, String> {
    let in_keyring = keyring_exists(profile_id, kind).unwrap_or(false);
    let in_vault = vault_exists(profile_id, kind).unwrap_or(false);
    Ok(in_keyring || in_vault)
}

/// New secrets go to the preferred backend only.
pub fn store(profile_id: &str, kind: CredentialKind, secret: &str) -> Result<(), String> {
    if secret.is_empty() {
        return Err("An empty password cannot be saved.".to_string());
    }
    match preferred_backend() {
        CredentialBackend::OsKeyring => entry(profile_id, kind)?
            .set_password(secret)
            .map_err(|error| error.to_string()),
        CredentialBackend::Vault => {
            crate::vault::manager()?.store(&account(profile_id, kind)?, secret)
        }
    }
}

/// Reads the preferred backend first, then the other, so a secret saved
/// before a preference change is still found. When both miss, the preferred
/// backend's error wins: "the vault is locked" is actionable, a bare
/// "not found" after it would be misleading.
pub fn load(profile_id: &str, kind: CredentialKind) -> Result<String, String> {
    type Loader = fn(&str, CredentialKind) -> Result<String, String>;
    let (first, second): (Loader, Loader) = match preferred_backend() {
        CredentialBackend::OsKeyring => (keyring_load, vault_load),
        CredentialBackend::Vault => (vault_load, keyring_load),
    };
    match first(profile_id, kind) {
        Ok(secret) => Ok(secret),
        Err(first_error) => match second(profile_id, kind) {
            Ok(secret) => Ok(secret),
            Err(_) => Err(first_error),
        },
    }
}

/// Removes the secret from both backends. A backend that cannot be asked
/// right now surfaces as an error rather than a silent skip, so "deleted"
/// always means deleted everywhere reachable.
pub fn delete(profile_id: &str, kind: CredentialKind) -> Result<bool, String> {
    let keyring_result = match entry(profile_id, kind)?.delete_credential() {
        Ok(()) => Ok(true),
        Err(Error::NoEntry) => Ok(false),
        Err(error) => Err(error.to_string()),
    };
    let vault_result = match crate::vault::manager() {
        Ok(vault) if vault.exists() && vault.is_unlocked() => {
            vault.delete(&account(profile_id, kind)?)
        }
        Ok(vault) if vault.exists() => {
            Err("the vault is locked; unlock it to remove its copy too".to_string())
        }
        _ => Ok(false),
    };
    match (keyring_result, vault_result) {
        (Ok(a), Ok(b)) => Ok(a || b),
        (Err(error), _) | (_, Err(error)) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_is_namespaced_without_secret_material() {
        let result = account("profile-123", CredentialKind::SshPassword).unwrap();
        assert_eq!(result, "profile:profile-123:ssh-password");
        assert!(!result.contains("secret"));
    }

    #[test]
    fn account_rejects_path_like_profile_ids() {
        assert!(account("../profile", CredentialKind::RdpPassword).is_err());
        assert!(account("profile/child", CredentialKind::RdpPassword).is_err());
    }

    #[test]
    fn sftp_passwords_have_their_own_namespace() {
        assert_eq!(
            account("profile-123", CredentialKind::SftpPassword).unwrap(),
            "profile:profile-123:sftp-password"
        );
    }
}
