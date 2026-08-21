//! OS-backed credential storage.
//!
//! Secrets are addressed by an opaque profile id and credential kind. The
//! plaintext value is only returned to the Rust connection command that needs
//! it; there is deliberately no Tauri command that exposes saved secrets to
//! the WebView.

use keyring::{Entry, Error};
use serde::{Deserialize, Serialize};

const SERVICE: &str = "io.github.NickYCLin.LatticeTerm";
const MAX_PROFILE_ID_LENGTH: usize = 128;

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
    pub provider: &'static str,
    pub detail: Option<String>,
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

pub fn status() -> CredentialStoreStatus {
    match Entry::store_status() {
        Ok(()) => CredentialStoreStatus {
            ready: true,
            provider: provider(),
            detail: None,
        },
        Err(error) => CredentialStoreStatus {
            ready: false,
            provider: provider(),
            detail: Some(error.to_string()),
        },
    }
}

pub fn exists(profile_id: &str, kind: CredentialKind) -> Result<bool, String> {
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

pub fn store(profile_id: &str, kind: CredentialKind, secret: &str) -> Result<(), String> {
    if secret.is_empty() {
        return Err("An empty password cannot be saved.".to_string());
    }
    entry(profile_id, kind)?
        .set_password(secret)
        .map_err(|error| error.to_string())
}

pub fn load(profile_id: &str, kind: CredentialKind) -> Result<String, String> {
    entry(profile_id, kind)?
        .get_password()
        .map_err(|error| match error {
            Error::NoEntry => "No saved credential exists for this connection.".to_string(),
            other => other.to_string(),
        })
}

pub fn delete(profile_id: &str, kind: CredentialKind) -> Result<bool, String> {
    match entry(profile_id, kind)?.delete_credential() {
        Ok(()) => Ok(true),
        Err(Error::NoEntry) => Ok(false),
        Err(error) => Err(error.to_string()),
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
