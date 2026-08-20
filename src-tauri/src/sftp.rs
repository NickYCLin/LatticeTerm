//! SFTP sessions and remote file operations.
//!
//! SFTP reuses the pure-Rust SSH transport and strict host-key trust boundary
//! used by terminal sessions. File contents cross IPC only for an explicit
//! upload or download and each operation is capped to protect WebView memory.

use crate::hostkeys::{HostKeyRecord, TrustVerdict};
use crate::ssh::{AuthMethod, TrustingHandler};
use base64::Engine;
use russh::client;
use russh_sftp::client::SftpSession;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub const MAX_TRANSFER_BYTES: usize = 32 * 1024 * 1024;
const MAX_PATH_LENGTH: usize = 4096;
const MAX_DIRECTORY_ENTRIES: usize = 10_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpConnectRequest {
    pub profile_id: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub auth: AuthMethod,
    #[serde(default)]
    pub use_saved_password: bool,
    #[serde(default)]
    pub remember_password: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpSessionSummary {
    pub session_id: String,
    pub profile_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub current_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "outcome"
)]
pub enum SftpConnectOutcome {
    Connected {
        session: SftpSessionSummary,
    },
    HostUnknown {
        host: String,
        port: u16,
        algorithm: String,
        fingerprint: String,
    },
    HostChanged {
        host: String,
        port: u16,
        algorithm: String,
        received_fingerprint: String,
        expected: HostKeyRecord,
    },
    AuthFailed,
    Failed {
        stage: &'static str,
        detail: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    pub kind: &'static str,
    pub size: u64,
    pub modified_at: Option<u64>,
    pub permissions: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpDirectory {
    pub path: String,
    pub entries: Vec<SftpEntry>,
}

struct SftpSessionEntry {
    summary: SftpSessionSummary,
    sftp: Arc<SftpSession>,
    // Holding the transport keeps the SSH session alive with the SFTP channel.
    _transport: client::Handle<TrustingHandler>,
}

#[derive(Default)]
pub struct SftpRegistry {
    sessions: Mutex<HashMap<String, SftpSessionEntry>>,
    counter: AtomicU64,
}

impl SftpRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    fn next_id(&self) -> String {
        let number = self.counter.fetch_add(1, Ordering::Relaxed) + 1;
        format!("sftp-{number}")
    }

    pub fn list(&self) -> Vec<SftpSessionSummary> {
        self.sessions
            .lock()
            .map(|guard| guard.values().map(|entry| entry.summary.clone()).collect())
            .unwrap_or_default()
    }

    fn session(&self, session_id: &str) -> Result<Arc<SftpSession>, String> {
        self.sessions
            .lock()
            .map_err(|error| error.to_string())?
            .get(session_id)
            .map(|entry| Arc::clone(&entry.sftp))
            .ok_or_else(|| format!("no SFTP session called '{session_id}'"))
    }

    fn insert(&self, entry: SftpSessionEntry) -> Result<(), String> {
        self.sessions
            .lock()
            .map_err(|error| error.to_string())?
            .insert(entry.summary.session_id.clone(), entry);
        Ok(())
    }

    fn remove(&self, session_id: &str) -> Result<Option<SftpSessionEntry>, String> {
        Ok(self
            .sessions
            .lock()
            .map_err(|error| error.to_string())?
            .remove(session_id))
    }
}

fn failed(stage: &'static str, detail: impl ToString) -> SftpConnectOutcome {
    SftpConnectOutcome::Failed {
        stage,
        detail: detail.to_string(),
    }
}

fn trust_outcome(verdict: Option<TrustVerdict>, fallback: impl ToString) -> SftpConnectOutcome {
    match verdict {
        Some(TrustVerdict::Unknown {
            host,
            port,
            algorithm,
            fingerprint,
        }) => SftpConnectOutcome::HostUnknown {
            host,
            port,
            algorithm,
            fingerprint,
        },
        Some(TrustVerdict::Changed {
            host,
            port,
            algorithm,
            received_fingerprint,
            expected,
        }) => SftpConnectOutcome::HostChanged {
            host,
            port,
            algorithm,
            received_fingerprint,
            expected,
        },
        _ => failed("connect", fallback),
    }
}

pub async fn connect(
    registry: Arc<SftpRegistry>,
    known: Option<HostKeyRecord>,
    request: SftpConnectRequest,
) -> SftpConnectOutcome {
    let verdict = Arc::new(Mutex::new(None));
    let handler = TrustingHandler {
        host: request.hostname.clone(),
        port: request.port,
        known,
        verdict: Arc::clone(&verdict),
    };
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(3600)),
        ..Default::default()
    });

    let mut transport =
        match client::connect(config, (request.hostname.as_str(), request.port), handler).await {
            Ok(transport) => transport,
            Err(error) => {
                let recorded = verdict.lock().ok().and_then(|slot| slot.clone());
                return trust_outcome(recorded, error);
            }
        };

    let authenticated = match &request.auth {
        AuthMethod::Password { password } => {
            match transport
                .authenticate_password(&request.username, password)
                .await
            {
                Ok(result) => result.success(),
                Err(error) => return failed("authenticate", error),
            }
        }
    };
    if !authenticated {
        return SftpConnectOutcome::AuthFailed;
    }

    let channel = match transport.channel_open_session().await {
        Ok(channel) => channel,
        Err(error) => return failed("channel", error),
    };
    if let Err(error) = channel.request_subsystem(true, "sftp").await {
        return failed("subsystem", error);
    }
    let sftp = match SftpSession::new(channel.into_stream()).await {
        Ok(sftp) => Arc::new(sftp),
        Err(error) => return failed("subsystem", error),
    };
    sftp.set_timeout(30);

    let current_path = match sftp.canonicalize(".").await {
        Ok(path) => path,
        Err(error) => return failed("directory", error),
    };
    let summary = SftpSessionSummary {
        session_id: registry.next_id(),
        profile_id: request.profile_id,
        host: request.hostname,
        port: request.port,
        username: request.username,
        current_path,
    };
    if let Err(error) = registry.insert(SftpSessionEntry {
        summary: summary.clone(),
        sftp,
        _transport: transport,
    }) {
        return failed("registry", error);
    }

    SftpConnectOutcome::Connected { session: summary }
}

fn validate_path(path: &str) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("The remote path is empty.".to_string());
    }
    if trimmed.len() > MAX_PATH_LENGTH {
        return Err("The remote path is too long.".to_string());
    }
    if trimmed
        .chars()
        .any(|character| matches!(character, '\0' | '\r' | '\n'))
    {
        return Err("The remote path contains unsupported control characters.".to_string());
    }
    Ok(trimmed.to_string())
}

fn validate_name(name: &str) -> Result<String, String> {
    let name = validate_path(name)?;
    if name == "." || name == ".." || name.contains('/') {
        return Err("The name must be one file or folder name.".to_string());
    }
    Ok(name)
}

fn join_path(parent: &str, name: &str) -> String {
    if parent == "/" {
        format!("/{name}")
    } else {
        format!("{}/{}", parent.trim_end_matches('/'), name)
    }
}

pub async fn list_directory(
    registry: &SftpRegistry,
    session_id: &str,
    path: &str,
) -> Result<SftpDirectory, String> {
    let session = registry.session(session_id)?;
    let canonical = session
        .canonicalize(validate_path(path)?)
        .await
        .map_err(|error| error.to_string())?;
    let directory = session
        .read_dir(canonical.clone())
        .await
        .map_err(|error| error.to_string())?;

    let mut entries = directory
        .take(MAX_DIRECTORY_ENTRIES + 1)
        .map(|entry| {
            let metadata = entry.metadata();
            let kind = if metadata.is_dir() {
                "directory"
            } else if metadata.is_symlink() {
                "symlink"
            } else if metadata.is_regular() {
                "file"
            } else {
                "other"
            };
            SftpEntry {
                name: entry.file_name(),
                path: entry.path(),
                kind,
                size: metadata.len(),
                modified_at: metadata.mtime.map(u64::from),
                permissions: metadata.permissions().to_string(),
            }
        })
        .collect::<Vec<_>>();

    if entries.len() > MAX_DIRECTORY_ENTRIES {
        return Err(format!(
            "This directory has more than {MAX_DIRECTORY_ENTRIES} entries; narrow the remote path."
        ));
    }
    entries.sort_by(|left, right| {
        let left_group = if left.kind == "directory" { 0 } else { 1 };
        let right_group = if right.kind == "directory" { 0 } else { 1 };
        left_group
            .cmp(&right_group)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    Ok(SftpDirectory {
        path: canonical,
        entries,
    })
}

pub async fn create_directory(
    registry: &SftpRegistry,
    session_id: &str,
    parent: &str,
    name: &str,
) -> Result<(), String> {
    let parent = validate_path(parent)?;
    let name = validate_name(name)?;
    registry
        .session(session_id)?
        .create_dir(join_path(&parent, &name))
        .await
        .map_err(|error| error.to_string())
}

pub async fn rename(
    registry: &SftpRegistry,
    session_id: &str,
    path: &str,
    new_name: &str,
) -> Result<(), String> {
    let path = validate_path(path)?;
    let new_name = validate_name(new_name)?;
    let parent = path
        .rsplit_once('/')
        .map(|(parent, _)| if parent.is_empty() { "/" } else { parent })
        .unwrap_or(".")
        .to_string();
    registry
        .session(session_id)?
        .rename(path, join_path(&parent, &new_name))
        .await
        .map_err(|error| error.to_string())
}

pub async fn remove(
    registry: &SftpRegistry,
    session_id: &str,
    path: &str,
    directory: bool,
) -> Result<(), String> {
    let path = validate_path(path)?;
    let session = registry.session(session_id)?;
    if directory {
        session
            .remove_dir(path)
            .await
            .map_err(|error| error.to_string())
    } else {
        session
            .remove_file(path)
            .await
            .map_err(|error| error.to_string())
    }
}

pub async fn read_file(
    registry: &SftpRegistry,
    session_id: &str,
    path: &str,
) -> Result<String, String> {
    let path = validate_path(path)?;
    let session = registry.session(session_id)?;
    let metadata = session
        .metadata(path.clone())
        .await
        .map_err(|error| error.to_string())?;
    if metadata.len() > MAX_TRANSFER_BYTES as u64 {
        return Err(format!(
            "The file is larger than the {} MiB transfer limit.",
            MAX_TRANSFER_BYTES / 1024 / 1024
        ));
    }
    let file = session
        .open(path)
        .await
        .map_err(|error| error.to_string())?;
    let mut limited = file.take(MAX_TRANSFER_BYTES as u64 + 1);
    let mut bytes = Vec::with_capacity(
        usize::try_from(metadata.len())
            .unwrap_or(MAX_TRANSFER_BYTES)
            .min(MAX_TRANSFER_BYTES),
    );
    limited
        .read_to_end(&mut bytes)
        .await
        .map_err(|error| error.to_string())?;
    if bytes.len() > MAX_TRANSFER_BYTES {
        return Err("The remote file exceeded the transfer limit while reading.".to_string());
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

pub async fn write_file(
    registry: &SftpRegistry,
    session_id: &str,
    parent: &str,
    name: &str,
    data_base64: &str,
) -> Result<(), String> {
    let parent = validate_path(parent)?;
    let name = validate_name(name)?;
    let estimated = data_base64.len().saturating_mul(3) / 4;
    if estimated > MAX_TRANSFER_BYTES {
        return Err(format!(
            "The file is larger than the {} MiB transfer limit.",
            MAX_TRANSFER_BYTES / 1024 / 1024
        ));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64)
        .map_err(|error| format!("The upload was not valid base64: {error}"))?;
    if bytes.len() > MAX_TRANSFER_BYTES {
        return Err(format!(
            "The file is larger than the {} MiB transfer limit.",
            MAX_TRANSFER_BYTES / 1024 / 1024
        ));
    }
    let session = registry.session(session_id)?;
    let mut file = session
        .create(join_path(&parent, &name))
        .await
        .map_err(|error| error.to_string())?;
    file.write_all(&bytes)
        .await
        .map_err(|error| error.to_string())?;
    file.flush().await.map_err(|error| error.to_string())?;
    file.shutdown().await.map_err(|error| error.to_string())
}

pub async fn disconnect(registry: &SftpRegistry, session_id: &str) -> Result<(), String> {
    let Some(entry) = registry.remove(session_id)? else {
        return Ok(());
    };
    entry.sftp.close().await.map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_reject_control_characters_and_invalid_names() {
        assert!(validate_path("/srv/files").is_ok());
        assert!(validate_path("/srv/\nfiles").is_err());
        assert!(validate_name("report.csv").is_ok());
        assert!(validate_name("../report.csv").is_err());
        assert!(validate_name("folder/report.csv").is_err());
    }

    #[test]
    fn path_joining_keeps_the_remote_root_valid() {
        assert_eq!(join_path("/", "home"), "/home");
        assert_eq!(
            join_path("/srv/files/", "report.csv"),
            "/srv/files/report.csv"
        );
    }

    #[test]
    fn connected_outcome_uses_frontend_field_names() {
        let outcome = serde_json::to_value(SftpConnectOutcome::Connected {
            session: SftpSessionSummary {
                session_id: "sftp-1".into(),
                profile_id: "profile-1".into(),
                host: "example.test".into(),
                port: 22,
                username: "operator".into(),
                current_path: "/home/operator".into(),
            },
        })
        .unwrap();

        assert_eq!(outcome["outcome"], "connected");
        assert_eq!(outcome["session"]["sessionId"], "sftp-1");
        assert_eq!(outcome["session"]["currentPath"], "/home/operator");
    }
}
