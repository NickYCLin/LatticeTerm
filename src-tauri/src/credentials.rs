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

use crate::domain::{ConnectionProfile, Protocol};
use keyring::{Entry, Error};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::OnceLock;

const SERVICE: &str = "io.github.NickYCLin.LatticeTerm";
const MAX_PROFILE_ID_LENGTH: usize = 128;
const BACKEND_FILE: &str = "credential_backend.json";
const BOUND_CREDENTIAL_VERSION: u32 = 1;
const LEGACY_CREDENTIAL_ERROR: &str = "This saved password predates endpoint binding. Re-enter it and choose Remember password again before using saved credentials.";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BoundCredentialEnvelope {
    version: u32,
    binding_sha256: String,
    secret: String,
}

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

/// Mobile platforms have no OS keyring this app can reach, so the vault is
/// the sensible default there; desktop keeps the OS store.
fn default_backend() -> CredentialBackend {
    if cfg!(any(target_os = "android", target_os = "ios")) {
        CredentialBackend::Vault
    } else {
        CredentialBackend::OsKeyring
    }
}

pub fn preferred_backend() -> CredentialBackend {
    let Some(path) = backend_path() else {
        return default_backend();
    };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<BackendFile>(&raw).ok())
        .map(|file| file.backend)
        .unwrap_or_else(default_backend)
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

    fn protocol(self) -> Protocol {
        match self {
            Self::SshPassword => Protocol::Ssh,
            Self::SftpPassword => Protocol::Sftp,
            Self::RdpPassword => Protocol::Rdp,
            Self::VncPassword => Protocol::Vnc,
        }
    }
}

/// Stable, non-secret identity of the endpoint a saved password belongs to.
/// Length-prefixing prevents ambiguous concatenations. Every endpoint field is
/// byte-exact so the digest always matches what the protocol engine actually
/// receives, even for case-sensitive IPv6 zone identifiers or when an IPC
/// caller bypasses draft validation.
pub fn profile_binding_sha256(profile: &ConnectionProfile) -> String {
    profile_binding_sha256_with_context(profile, "")
}

/// Extends the endpoint identity with a protocol-specific authentication
/// realm. RDP uses this for its optional CredSSP domain; other protocols use
/// the context-free wrapper above.
pub fn profile_binding_sha256_with_context(
    profile: &ConnectionProfile,
    authentication_context: &str,
) -> String {
    let fields = [
        profile.protocol.as_str().to_string(),
        profile.hostname.clone(),
        profile.port.to_string(),
        profile.username.clone(),
        authentication_context.to_string(),
    ];
    let mut digest = Sha256::new();
    digest.update(b"latticeterm-credential-binding-v1\0");
    for field in fields {
        digest.update((field.len() as u64).to_be_bytes());
        digest.update(field.as_bytes());
    }
    digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn validate_bound_kind(profile: &ConnectionProfile, kind: CredentialKind) -> Result<(), String> {
    if profile.protocol != kind.protocol() {
        return Err("The credential kind does not match the connection protocol.".to_string());
    }
    Ok(())
}

fn encode_bound_secret(
    profile: &ConnectionProfile,
    kind: CredentialKind,
    secret: &str,
) -> Result<String, String> {
    encode_bound_secret_with_context(profile, kind, "", secret)
}

fn encode_bound_secret_with_context(
    profile: &ConnectionProfile,
    kind: CredentialKind,
    authentication_context: &str,
    secret: &str,
) -> Result<String, String> {
    validate_bound_kind(profile, kind)?;
    if secret.is_empty() {
        return Err("An empty password cannot be saved.".to_string());
    }
    serde_json::to_string(&BoundCredentialEnvelope {
        version: BOUND_CREDENTIAL_VERSION,
        binding_sha256: profile_binding_sha256_with_context(profile, authentication_context),
        secret: secret.to_string(),
    })
    .map_err(|error| error.to_string())
}

fn decode_bound_secret(
    profile: &ConnectionProfile,
    kind: CredentialKind,
    encoded: &str,
) -> Result<String, String> {
    decode_bound_secret_with_context(profile, kind, "", encoded)
}

fn decode_bound_secret_with_context(
    profile: &ConnectionProfile,
    kind: CredentialKind,
    authentication_context: &str,
    encoded: &str,
) -> Result<String, String> {
    validate_bound_kind(profile, kind)?;
    let envelope: BoundCredentialEnvelope =
        serde_json::from_str(encoded).map_err(|_| LEGACY_CREDENTIAL_ERROR.to_string())?;
    if envelope.version != BOUND_CREDENTIAL_VERSION {
        return Err(LEGACY_CREDENTIAL_ERROR.to_string());
    }
    if envelope.binding_sha256
        != profile_binding_sha256_with_context(profile, authentication_context)
    {
        return Err(
            "The saved password belongs to a different endpoint. Delete it or restore the original host, port, and username before reconnecting."
                .to_string(),
        );
    }
    if envelope.secret.is_empty() {
        return Err("The saved password is empty.".to_string());
    }
    Ok(envelope.secret)
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
fn store(profile_id: &str, kind: CredentialKind, secret: &str) -> Result<(), String> {
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

/// Stores a password together with the exact saved endpoint it may be used
/// for. Editing or replacing a profile can never silently retarget this
/// credential because the binding is authenticated by the credential store's
/// own confidentiality boundary and checked before any connection attempt.
pub fn store_bound(
    profile: &ConnectionProfile,
    kind: CredentialKind,
    secret: &str,
) -> Result<(), String> {
    let encoded = encode_bound_secret(profile, kind, secret)?;
    store(&profile.id, kind, &encoded)
}

pub fn store_bound_with_context(
    profile: &ConnectionProfile,
    kind: CredentialKind,
    authentication_context: &str,
    secret: &str,
) -> Result<(), String> {
    let encoded = encode_bound_secret_with_context(profile, kind, authentication_context, secret)?;
    store(&profile.id, kind, &encoded)
}

/// Reads the preferred backend first, then the other, so a secret saved
/// before a preference change is still found. When both miss, the preferred
/// backend's error wins: "the vault is locked" is actionable, a bare
/// "not found" after it would be misleading.
fn load(profile_id: &str, kind: CredentialKind) -> Result<String, String> {
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

/// Loads only the versioned endpoint-bound envelope. Legacy raw passwords are
/// deliberately not guessed or auto-migrated: there is no trustworthy way to
/// know which endpoint an old profile-id-only secret originally belonged to.
pub fn load_bound(profile: &ConnectionProfile, kind: CredentialKind) -> Result<String, String> {
    let encoded = load(&profile.id, kind)?;
    decode_bound_secret(profile, kind, &encoded)
}

pub fn load_bound_with_context(
    profile: &ConnectionProfile,
    kind: CredentialKind,
    authentication_context: &str,
) -> Result<String, String> {
    let encoded = load(&profile.id, kind)?;
    decode_bound_secret_with_context(profile, kind, authentication_context, &encoded)
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

    fn profile(protocol: Protocol) -> ConnectionProfile {
        ConnectionProfile {
            id: "profile-123".to_string(),
            name: "Gateway".to_string(),
            protocol,
            hostname: "Gateway.Example.COM".to_string(),
            username: "Operator".to_string(),
            port: protocol.default_port(),
            environment: crate::domain::Environment::Production,
            group: "Servers".to_string(),
            tags: Vec::new(),
            favorite: false,
            device_id: None,
            relay_address: None,
        }
    }

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

    #[test]
    fn endpoint_bound_envelopes_round_trip_only_for_the_same_profile() {
        let original = profile(Protocol::Ssh);
        let encoded =
            encode_bound_secret(&original, CredentialKind::SshPassword, "secret").unwrap();

        assert_eq!(
            decode_bound_secret(&original, CredentialKind::SshPassword, &encoded).unwrap(),
            "secret"
        );

        let mut changed_host = original.clone();
        changed_host.hostname = "attacker.example".to_string();
        assert!(
            decode_bound_secret(&changed_host, CredentialKind::SshPassword, &encoded)
                .unwrap_err()
                .contains("different endpoint")
        );

        let mut changed_user = original.clone();
        changed_user.username = "root".to_string();
        assert!(decode_bound_secret(&changed_user, CredentialKind::SshPassword, &encoded).is_err());
    }

    #[test]
    fn protocol_authentication_context_cannot_be_retargeted() {
        let rdp = profile(Protocol::Rdp);
        let encoded = encode_bound_secret_with_context(
            &rdp,
            CredentialKind::RdpPassword,
            "rdp-domain:some:4:CORP",
            "secret",
        )
        .unwrap();

        assert_eq!(
            decode_bound_secret_with_context(
                &rdp,
                CredentialKind::RdpPassword,
                "rdp-domain:some:4:CORP",
                &encoded,
            )
            .unwrap(),
            "secret"
        );
        assert!(decode_bound_secret_with_context(
            &rdp,
            CredentialKind::RdpPassword,
            "rdp-domain:some:4:EVIL",
            &encoded,
        )
        .unwrap_err()
        .contains("different endpoint"));
    }

    #[test]
    fn endpoint_binding_is_byte_exact_for_every_protocol_field() {
        let original = profile(Protocol::Ssh);
        let mut same_host = original.clone();
        same_host.hostname = "gateway.example.com".to_string();
        assert_ne!(
            profile_binding_sha256(&original),
            profile_binding_sha256(&same_host)
        );

        let mut changed_protocol = original.clone();
        changed_protocol.protocol = Protocol::Sftp;
        assert_ne!(
            profile_binding_sha256(&original),
            profile_binding_sha256(&changed_protocol)
        );

        let mut changed_username = original.clone();
        changed_username.username = "operator".to_string();
        assert_ne!(
            profile_binding_sha256(&original),
            profile_binding_sha256(&changed_username)
        );

        let mut padded_username = original.clone();
        padded_username.username.push(' ');
        assert_ne!(
            profile_binding_sha256(&original),
            profile_binding_sha256(&padded_username)
        );

        let mut padded_host = original.clone();
        padded_host.hostname.push(' ');
        assert_ne!(
            profile_binding_sha256(&original),
            profile_binding_sha256(&padded_host)
        );

        let mut ipv6_upper = original.clone();
        ipv6_upper.hostname = "fe80::1%ETH0".to_string();
        let mut ipv6_lower = ipv6_upper.clone();
        ipv6_lower.hostname = "fe80::1%eth0".to_string();
        assert_ne!(
            profile_binding_sha256(&ipv6_upper),
            profile_binding_sha256(&ipv6_lower)
        );
    }

    #[test]
    fn legacy_raw_passwords_and_cross_protocol_envelopes_fail_closed() {
        let ssh = profile(Protocol::Ssh);
        assert_eq!(
            decode_bound_secret(&ssh, CredentialKind::SshPassword, "legacy password").unwrap_err(),
            LEGACY_CREDENTIAL_ERROR
        );
        assert!(encode_bound_secret(&ssh, CredentialKind::RdpPassword, "secret").is_err());
        assert!(encode_bound_secret(&ssh, CredentialKind::SshPassword, "").is_err());
    }
}
