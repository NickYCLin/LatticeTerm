//! Encrypted, device-local terminal history for Agent workspace restoration.
//!
//! Agent output can contain source code, prompts, paths, or credentials, so it
//! must never join the plain JSON workspace metadata. The rolling output tail
//! is sealed with a random device key held by the operating-system credential
//! store. If that secure store is unavailable, restoration simply falls back
//! to relaunching the CLI without persisting terminal contents.

use crate::agent::AgentTerminalHistorySnapshot;
use base64::Engine;
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use zeroize::{Zeroize, Zeroizing};

const HISTORY_FILE: &str = "agent-terminal-history.enc.json";
const HISTORY_VERSION: u32 = 1;
const PAYLOAD_VERSION: u32 = 1;
const NONCE_BYTES: usize = 24;
const KEY_BYTES: usize = 32;
const MAX_HISTORY_SESSIONS: usize = 32;
const MAX_HISTORY_BYTES_PER_SESSION: usize = 256 * 1024;
const MAX_HISTORY_BYTES_TOTAL: usize = 8 * 1024 * 1024;
const AAD: &[u8] = b"LatticeTerm Agent terminal history v1";
const KEYRING_SERVICE: &str = "io.github.NickYCLin.LatticeTerm";
const KEYRING_ACCOUNT: &str = "agent-terminal-history-key-v1";

fn b64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn from_b64(value: &str, field: &str) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::STANDARD
        .decode(value)
        .map_err(|error| format!("The Agent terminal history {field} is not valid base64: {error}"))
}

#[derive(Debug, Serialize, Deserialize)]
struct HistoryEnvelope {
    version: u32,
    nonce: String,
    ciphertext: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryEntry {
    group_id: String,
    definition_id: String,
    output: String,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
struct HistoryPayload {
    version: u32,
    entries: Vec<HistoryEntry>,
}

fn seal(key: &[u8; KEY_BYTES], entries: &[HistoryEntry]) -> Result<HistoryEnvelope, String> {
    let mut plaintext = serde_json::to_vec(&HistoryPayload {
        version: PAYLOAD_VERSION,
        entries: entries.to_vec(),
    })
    .map_err(|error| error.to_string())?;
    let mut nonce = [0_u8; NONCE_BYTES];
    getrandom::fill(&mut nonce).map_err(|error| error.to_string())?;
    let cipher = XChaCha20Poly1305::new(<&Key>::try_from(key.as_slice()).expect("32-byte key"));
    let ciphertext = cipher
        .encrypt(
            &XNonce::from(nonce),
            Payload {
                msg: plaintext.as_slice(),
                aad: AAD,
            },
        )
        .map_err(|_| "The Agent terminal history could not be encrypted.".to_string())?;
    plaintext.zeroize();
    Ok(HistoryEnvelope {
        version: HISTORY_VERSION,
        nonce: b64(&nonce),
        ciphertext: b64(&ciphertext),
    })
}

fn unseal(key: &[u8; KEY_BYTES], envelope: &HistoryEnvelope) -> Result<Vec<HistoryEntry>, String> {
    if envelope.version != HISTORY_VERSION {
        return Err(format!(
            "The Agent terminal history is version {}, but this build supports version {HISTORY_VERSION}.",
            envelope.version
        ));
    }
    let nonce = from_b64(&envelope.nonce, "nonce")?;
    let Ok(nonce) = <&XNonce>::try_from(nonce.as_slice()) else {
        return Err("The Agent terminal history nonce has the wrong size.".to_string());
    };
    let ciphertext = from_b64(&envelope.ciphertext, "ciphertext")?;
    let cipher = XChaCha20Poly1305::new(<&Key>::try_from(key.as_slice()).expect("32-byte key"));
    let mut plaintext = cipher
        .decrypt(
            nonce,
            Payload {
                msg: ciphertext.as_slice(),
                aad: AAD,
            },
        )
        .map_err(|_| {
            "The Agent terminal history key is unavailable, or the history file was modified."
                .to_string()
        })?;
    let decoded = serde_json::from_slice(&plaintext).map_err(|error| error.to_string());
    plaintext.zeroize();
    let payload: HistoryPayload = decoded?;
    if payload.version != PAYLOAD_VERSION || payload.entries.len() > MAX_HISTORY_SESSIONS {
        return Err("The Agent terminal history payload is not supported.".to_string());
    }
    let mut total = 0_usize;
    for entry in &payload.entries {
        if entry.group_id.is_empty()
            || entry.group_id.len() > 256
            || entry.definition_id.is_empty()
            || entry.definition_id.len() > 64
        {
            return Err(
                "The Agent terminal history contains an invalid session identity.".to_string(),
            );
        }
        let bytes = from_b64(&entry.output, "output")?;
        total = total.saturating_add(bytes.len());
        if bytes.len() > MAX_HISTORY_BYTES_PER_SESSION || total > MAX_HISTORY_BYTES_TOTAL {
            return Err("The Agent terminal history payload is too large.".to_string());
        }
    }
    Ok(payload.entries)
}

fn keyring_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|error| error.to_string())
}

fn decode_key(mut encoded: String) -> Result<Zeroizing<[u8; KEY_BYTES]>, String> {
    let decoded = from_b64(&encoded, "key");
    encoded.zeroize();
    let mut bytes = decoded?;
    if bytes.len() != KEY_BYTES {
        bytes.zeroize();
        return Err("The Agent terminal history key has the wrong size.".to_string());
    }
    let mut key = Zeroizing::new([0_u8; KEY_BYTES]);
    key.copy_from_slice(&bytes);
    bytes.zeroize();
    Ok(key)
}

fn load_key() -> Result<Zeroizing<[u8; KEY_BYTES]>, String> {
    let encoded = keyring_entry()?
        .get_password()
        .map_err(|error| match error {
            KeyringError::NoEntry => "The Agent terminal history key does not exist.".to_string(),
            other => other.to_string(),
        })?;
    decode_key(encoded)
}

fn load_or_create_key() -> Result<Zeroizing<[u8; KEY_BYTES]>, String> {
    match load_key() {
        Ok(key) => Ok(key),
        Err(error) if error == "The Agent terminal history key does not exist." => {
            let mut key = Zeroizing::new([0_u8; KEY_BYTES]);
            getrandom::fill(key.as_mut()).map_err(|reason| reason.to_string())?;
            let mut encoded = b64(key.as_ref());
            let result = keyring_entry()?.set_password(&encoded);
            encoded.zeroize();
            result.map_err(|reason| reason.to_string())?;
            Ok(key)
        }
        Err(error) => Err(error),
    }
}

fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), String> {
    let directory = path
        .parent()
        .ok_or_else(|| "The Agent terminal history path has no directory.".to_string())?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let mut temporary = tempfile::Builder::new()
        .prefix(".agent-terminal-history-")
        .suffix(".tmp")
        .tempfile_in(directory)
        .map_err(|error| error.to_string())?;
    temporary
        .write_all(contents)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        temporary
            .as_file()
            .set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }
    temporary
        .persist(path)
        .map(|_| ())
        .map_err(|error| error.error.to_string())
}

fn normalized_entries(snapshots: Vec<AgentTerminalHistorySnapshot>) -> Vec<HistoryEntry> {
    let mut entries = Vec::new();
    let mut total = 0_usize;
    for snapshot in snapshots.into_iter().take(MAX_HISTORY_SESSIONS) {
        if snapshot.group_id.is_empty()
            || snapshot.group_id.len() > 256
            || snapshot.definition_id.is_empty()
            || snapshot.definition_id.len() > 64
        {
            continue;
        }
        let start = snapshot
            .output
            .len()
            .saturating_sub(MAX_HISTORY_BYTES_PER_SESSION);
        let output = &snapshot.output[start..];
        if output.is_empty() || total.saturating_add(output.len()) > MAX_HISTORY_BYTES_TOTAL {
            continue;
        }
        total += output.len();
        entries.push(HistoryEntry {
            group_id: snapshot.group_id,
            definition_id: snapshot.definition_id,
            output: b64(output),
        });
    }
    entries
}

/// In-memory view of the encrypted history file. Decrypted output never
/// crosses into plain workspace metadata and is discarded with this process.
pub struct AgentTerminalHistoryStore {
    path: PathBuf,
    entries: Vec<HistoryEntry>,
    write_blocked: bool,
}

impl AgentTerminalHistoryStore {
    pub fn open(directory: &Path) -> Self {
        let path = directory.join(HISTORY_FILE);
        let (entries, write_blocked) = match fs::read(&path) {
            Ok(raw) => match (|| {
                let envelope: HistoryEnvelope =
                    serde_json::from_slice(&raw).map_err(|error| error.to_string())?;
                let key = load_key()?;
                unseal(&key, &envelope)
            })() {
                Ok(entries) => (entries, false),
                Err(_) => (Vec::new(), true),
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (Vec::new(), false),
            Err(_) => (Vec::new(), true),
        };
        Self {
            path,
            entries,
            write_blocked,
        }
    }

    pub fn replay_for(&self, group_id: &str, definition_id: &str) -> Option<Vec<u8>> {
        let entry = self
            .entries
            .iter()
            .find(|entry| entry.group_id == group_id && entry.definition_id == definition_id)?;
        from_b64(&entry.output, "output").ok()
    }

    pub fn consume_replay(&mut self, group_id: &str, definition_id: &str) {
        if let Some(index) = self
            .entries
            .iter()
            .position(|entry| entry.group_id == group_id && entry.definition_id == definition_id)
        {
            self.entries.remove(index);
        }
    }

    pub fn save(&mut self, snapshots: Vec<AgentTerminalHistorySnapshot>) -> Result<(), String> {
        if self.write_blocked {
            return Err(
                "The existing Agent terminal history could not be opened; it was left unchanged."
                    .to_string(),
            );
        }
        let entries = normalized_entries(snapshots);
        if entries.is_empty() {
            match fs::remove_file(&self.path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.to_string()),
            }
            self.entries.clear();
            return Ok(());
        }
        let key = load_or_create_key()?;
        let envelope = seal(&key, &entries)?;
        let encoded = serde_json::to_vec_pretty(&envelope).map_err(|error| error.to_string())?;
        atomic_write(&self.path, &encoded)?;
        self.entries = entries;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key() -> [u8; KEY_BYTES] {
        [0x5a; KEY_BYTES]
    }

    fn entry(output: &[u8]) -> HistoryEntry {
        HistoryEntry {
            group_id: "project-a".to_string(),
            definition_id: "codex".to_string(),
            output: b64(output),
        }
    }

    #[test]
    fn encrypted_history_round_trips_without_plaintext_in_the_file() {
        let entries = vec![entry(b"private terminal output")];
        let sealed = seal(&key(), &entries).unwrap();
        let encoded = serde_json::to_string(&sealed).unwrap();
        assert!(!encoded.contains("private terminal output"));
        assert_eq!(unseal(&key(), &sealed).unwrap(), entries);
    }

    #[test]
    fn modified_history_fails_authentication() {
        let entries = vec![entry(b"terminal output")];
        let mut sealed = seal(&key(), &entries).unwrap();
        let mut ciphertext = from_b64(&sealed.ciphertext, "ciphertext").unwrap();
        ciphertext[0] ^= 0x80;
        sealed.ciphertext = b64(&ciphertext);
        assert!(unseal(&key(), &sealed).is_err());
    }

    #[test]
    fn history_is_bounded_to_the_latest_output_tail() {
        let output = vec![b'x'; MAX_HISTORY_BYTES_PER_SESSION + 2];
        let entries = normalized_entries(vec![AgentTerminalHistorySnapshot {
            group_id: "group".to_string(),
            definition_id: "codex".to_string(),
            output,
        }]);
        let decoded = from_b64(&entries[0].output, "output").unwrap();
        assert_eq!(decoded.len(), MAX_HISTORY_BYTES_PER_SESSION);
    }

    #[test]
    fn replay_consumes_only_the_matching_oldest_entry() {
        let directory = tempfile::tempdir().unwrap();
        let first = entry(b"first");
        let second = entry(b"second");
        let mut store = AgentTerminalHistoryStore {
            path: directory.path().join(HISTORY_FILE),
            entries: vec![first, second],
            write_blocked: false,
        };
        assert_eq!(store.replay_for("project-a", "codex").unwrap(), b"first");
        store.consume_replay("project-a", "codex");
        assert_eq!(store.replay_for("project-a", "codex").unwrap(), b"second");
    }

    #[test]
    fn unreadable_history_is_preserved_instead_of_overwritten() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(HISTORY_FILE);
        fs::write(&path, b"not an encrypted history envelope").unwrap();
        let mut store = AgentTerminalHistoryStore::open(directory.path());

        assert!(store.save(Vec::new()).is_err());
        assert_eq!(
            fs::read(&path).unwrap(),
            b"not an encrypted history envelope"
        );
    }
}
