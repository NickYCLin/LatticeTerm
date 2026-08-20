//! Host key trust.
//!
//! The decision this module makes is the one that keeps an SSH session from
//! being handed to the wrong machine, so it is deliberately free of transport
//! code: it takes a host, a port and a key fingerprint, and answers whether
//! that pairing has been seen before. That keeps every rule testable without a
//! network, a server, or a key pair.
//!
//! The three answers map onto three very different situations:
//!
//! * `Trusted` — seen before, same key. Proceed.
//! * `Unknown` — never seen. The user has to look at the fingerprint and
//!   decide; nothing is trusted automatically.
//! * `Changed` — seen before, *different* key. This is the dangerous one. It
//!   may be a rebuilt server, or it may be an interception, and this module
//!   never resolves that ambiguity on the user's behalf.

use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::storage::StorageError;

pub const TRUST_STORE_VERSION: u32 = 1;

const TRUST_FILE: &str = "known_hosts.json";
const TEMP_FILE: &str = "known_hosts.json.tmp";

/// OpenSSH's display form: `SHA256:` followed by unpadded base64 of the digest
/// of the public key blob. Matching this exactly is what lets a user compare
/// against `ssh-keygen -lf` output on the server without conversion.
pub fn fingerprint_of(public_key_blob: &[u8]) -> String {
    let digest = Sha256::digest(public_key_blob);
    let encoded = base64::engine::general_purpose::STANDARD_NO_PAD.encode(digest);
    format!("SHA256:{encoded}")
}

/// `host` for the default port, `[host]:port` otherwise — the same shape
/// OpenSSH writes into `known_hosts`, so the two stay readable side by side.
pub fn host_target_key(host: &str, port: u16) -> String {
    let host = host.trim().to_lowercase();
    if port == 22 {
        host
    } else {
        format!("[{host}]:{port}")
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostKeyRecord {
    pub host: String,
    pub port: u16,
    pub algorithm: String,
    pub fingerprint: String,
    /// Seconds since the epoch, supplied by the caller so tests stay determinate.
    pub first_trusted_at: u64,
    pub last_seen_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum TrustVerdict {
    /// Same host, same key as last time.
    Trusted { record: HostKeyRecord },
    /// Never seen. The user must compare the fingerprint before continuing.
    Unknown {
        host: String,
        port: u16,
        algorithm: String,
        fingerprint: String,
    },
    /// Seen before with a different key. Blocking; never resolved automatically.
    Changed {
        host: String,
        port: u16,
        algorithm: String,
        /// What arrived on this connection.
        received_fingerprint: String,
        /// What was trusted previously.
        expected: HostKeyRecord,
    },
}

impl TrustVerdict {
    /// Whether a session may proceed without asking the user anything.
    pub fn may_proceed(&self) -> bool {
        matches!(self, TrustVerdict::Trusted { .. })
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct TrustFile {
    version: u32,
    hosts: Vec<HostKeyRecord>,
}

/// Trusted host keys, persisted next to the connection list.
///
/// Holds public key fingerprints only. A fingerprint is not a secret — it is
/// published precisely so it can be compared — so this file carries no more
/// risk than the host list itself.
#[derive(Debug)]
pub struct HostTrustStore {
    path: PathBuf,
    entries: HashMap<String, HostKeyRecord>,
}

impl HostTrustStore {
    pub fn open(dir: &Path) -> Result<Self, StorageError> {
        fs::create_dir_all(dir).map_err(|e| StorageError::Internal(e.to_string()))?;

        let path = dir.join(TRUST_FILE);
        let mut store = Self {
            path,
            entries: HashMap::new(),
        };

        let raw = match fs::read_to_string(&store.path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(store),
            Err(error) => return Err(StorageError::Internal(error.to_string())),
        };

        // An unreadable trust file must not degrade into "trust everything":
        // it is reported, and every host then reads as Unknown, which asks the
        // user rather than letting a session through unchecked.
        match serde_json::from_str::<TrustFile>(&raw) {
            Ok(file) if file.version <= TRUST_STORE_VERSION => {
                for record in file.hosts {
                    store
                        .entries
                        .insert(host_target_key(&record.host, record.port), record);
                }
                Ok(store)
            }
            Ok(file) => Err(StorageError::Validation(format!(
                "known_hosts file was written by a newer version (found {}, supported {})",
                file.version, TRUST_STORE_VERSION
            ))),
            Err(error) => Err(StorageError::Validation(format!(
                "known_hosts file could not be read: {error}"
            ))),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn records(&self) -> Vec<HostKeyRecord> {
        let mut list: Vec<HostKeyRecord> = self.entries.values().cloned().collect();
        list.sort_by(|a, b| a.host.cmp(&b.host).then_with(|| a.port.cmp(&b.port)));
        list
    }

    /// The trust decision for one presented key. Read-only: seeing a key never
    /// records it, because recording on sight is exactly how a changed key
    /// would be silently accepted.
    pub fn verify(
        &self,
        host: &str,
        port: u16,
        algorithm: &str,
        fingerprint: &str,
    ) -> TrustVerdict {
        match self.entries.get(&host_target_key(host, port)) {
            Some(record) if record.fingerprint == fingerprint => TrustVerdict::Trusted {
                record: record.clone(),
            },
            Some(record) => TrustVerdict::Changed {
                host: host.to_string(),
                port,
                algorithm: algorithm.to_string(),
                received_fingerprint: fingerprint.to_string(),
                expected: record.clone(),
            },
            None => TrustVerdict::Unknown {
                host: host.to_string(),
                port,
                algorithm: algorithm.to_string(),
                fingerprint: fingerprint.to_string(),
            },
        }
    }

    /// Records a key the user has explicitly accepted, replacing any previous
    /// entry for the same host and port.
    pub fn trust(
        &mut self,
        host: &str,
        port: u16,
        algorithm: &str,
        fingerprint: &str,
        now: u64,
    ) -> Result<HostKeyRecord, StorageError> {
        let key = host_target_key(host, port);
        let first_trusted_at = self
            .entries
            .get(&key)
            .map(|existing| existing.first_trusted_at)
            .unwrap_or(now);

        let record = HostKeyRecord {
            host: host.trim().to_lowercase(),
            port,
            algorithm: algorithm.to_string(),
            fingerprint: fingerprint.to_string(),
            first_trusted_at,
            last_seen_at: now,
        };

        self.entries.insert(key, record.clone());
        self.persist()?;
        Ok(record)
    }

    /// Drops a host's trusted key, so the next connection asks again.
    pub fn forget(&mut self, host: &str, port: u16) -> Result<bool, StorageError> {
        let removed = self.entries.remove(&host_target_key(host, port)).is_some();
        if removed {
            self.persist()?;
        }
        Ok(removed)
    }

    fn persist(&self) -> Result<(), StorageError> {
        let file = TrustFile {
            version: TRUST_STORE_VERSION,
            hosts: self.records(),
        };

        let json = serde_json::to_string_pretty(&file)
            .map_err(|e| StorageError::Internal(e.to_string()))?;

        let dir = self
            .path
            .parent()
            .ok_or_else(|| StorageError::Internal("trust store path has no directory".into()))?;
        let temp = dir.join(TEMP_FILE);

        {
            let mut handle =
                fs::File::create(&temp).map_err(|e| StorageError::Internal(e.to_string()))?;
            handle
                .write_all(json.as_bytes())
                .map_err(|e| StorageError::Internal(e.to_string()))?;
            handle
                .sync_all()
                .map_err(|e| StorageError::Internal(e.to_string()))?;
        }

        fs::rename(&temp, &self.path).map_err(|e| StorageError::Internal(e.to_string()))
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
        let dir = std::env::temp_dir().join(format!("latticeterm-trust-{label}-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    const FP_A: &str = "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const FP_B: &str = "SHA256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

    #[test]
    fn fingerprints_match_the_openssh_display_form() {
        // The empty digest is a fixed, published value, so this pins both the
        // hash and the unpadded base64 encoding at once.
        assert_eq!(
            fingerprint_of(b""),
            "SHA256:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU"
        );
        assert!(!fingerprint_of(b"anything").ends_with('='));
    }

    #[test]
    fn the_target_key_follows_the_openssh_convention() {
        assert_eq!(
            host_target_key("Gateway.Example.com", 22),
            "gateway.example.com"
        );
        assert_eq!(
            host_target_key("gateway.example.com", 2222),
            "[gateway.example.com]:2222"
        );
    }

    #[test]
    fn an_unseen_host_is_unknown_not_trusted() {
        let store = HostTrustStore::open(&temp_dir("unseen")).unwrap();

        let verdict = store.verify("gateway.example.com", 22, "ssh-ed25519", FP_A);

        assert!(matches!(verdict, TrustVerdict::Unknown { .. }));
        assert!(!verdict.may_proceed());
    }

    #[test]
    fn a_trusted_key_is_recognised_after_reopening() {
        let dir = temp_dir("round-trip");

        let mut store = HostTrustStore::open(&dir).unwrap();
        store
            .trust(
                "gateway.example.com",
                22,
                "ssh-ed25519",
                FP_A,
                1_700_000_000,
            )
            .unwrap();

        let reopened = HostTrustStore::open(&dir).unwrap();
        let verdict = reopened.verify("gateway.example.com", 22, "ssh-ed25519", FP_A);

        assert!(verdict.may_proceed());
        assert!(matches!(verdict, TrustVerdict::Trusted { .. }));
    }

    #[test]
    fn a_different_key_for_a_known_host_is_reported_as_changed() {
        let dir = temp_dir("changed");
        let mut store = HostTrustStore::open(&dir).unwrap();
        store
            .trust(
                "gateway.example.com",
                22,
                "ssh-ed25519",
                FP_A,
                1_700_000_000,
            )
            .unwrap();

        let verdict = store.verify("gateway.example.com", 22, "ssh-ed25519", FP_B);

        match verdict {
            TrustVerdict::Changed {
                received_fingerprint,
                expected,
                ..
            } => {
                assert_eq!(received_fingerprint, FP_B);
                assert_eq!(expected.fingerprint, FP_A);
            }
            other => panic!("expected Changed, got {other:?}"),
        }
        // A changed key never proceeds on its own.
        assert!(!store
            .verify("gateway.example.com", 22, "ssh-ed25519", FP_B)
            .may_proceed());
    }

    #[test]
    fn the_same_host_on_another_port_is_a_separate_decision() {
        let dir = temp_dir("ports");
        let mut store = HostTrustStore::open(&dir).unwrap();
        store
            .trust("gateway.example.com", 22, "ssh-ed25519", FP_A, 1)
            .unwrap();

        let other_port = store.verify("gateway.example.com", 2222, "ssh-ed25519", FP_A);

        assert!(matches!(other_port, TrustVerdict::Unknown { .. }));
    }

    #[test]
    fn host_matching_ignores_case() {
        let dir = temp_dir("case");
        let mut store = HostTrustStore::open(&dir).unwrap();
        store
            .trust("Gateway.Example.COM", 22, "ssh-ed25519", FP_A, 1)
            .unwrap();

        assert!(store
            .verify("gateway.example.com", 22, "ssh-ed25519", FP_A)
            .may_proceed());
    }

    #[test]
    fn re_trusting_keeps_the_original_first_seen_time() {
        let dir = temp_dir("first-seen");
        let mut store = HostTrustStore::open(&dir).unwrap();

        store
            .trust("gateway.example.com", 22, "ssh-ed25519", FP_A, 1_000)
            .unwrap();
        let updated = store
            .trust("gateway.example.com", 22, "ssh-ed25519", FP_B, 2_000)
            .unwrap();

        assert_eq!(updated.first_trusted_at, 1_000);
        assert_eq!(updated.last_seen_at, 2_000);
        assert_eq!(updated.fingerprint, FP_B);
    }

    #[test]
    fn forgetting_a_host_makes_it_unknown_again() {
        let dir = temp_dir("forget");
        let mut store = HostTrustStore::open(&dir).unwrap();
        store
            .trust("gateway.example.com", 22, "ssh-ed25519", FP_A, 1)
            .unwrap();

        assert!(store.forget("gateway.example.com", 22).unwrap());
        assert!(!store.forget("gateway.example.com", 22).unwrap());
        assert!(matches!(
            store.verify("gateway.example.com", 22, "ssh-ed25519", FP_A),
            TrustVerdict::Unknown { .. }
        ));
    }

    #[test]
    fn an_unreadable_trust_file_is_an_error_rather_than_an_empty_store() {
        let dir = temp_dir("corrupt");
        fs::write(dir.join(TRUST_FILE), "{ not json").unwrap();

        let error = HostTrustStore::open(&dir).unwrap_err();

        // Starting empty would silently turn every known host into a fresh
        // "do you trust this?" prompt, which is how a changed key gets waved
        // through. Refusing to open is the safe failure.
        assert!(matches!(error, StorageError::Validation(_)));
    }

    #[test]
    fn the_written_file_holds_fingerprints_and_nothing_private() {
        let dir = temp_dir("shape");
        let mut store = HostTrustStore::open(&dir).unwrap();
        store
            .trust(
                "gateway.example.com",
                2222,
                "ssh-ed25519",
                FP_A,
                1_700_000_000,
            )
            .unwrap();

        let raw = fs::read_to_string(store.path()).unwrap();

        assert!(raw.contains("\"version\": 1"));
        assert!(raw.contains(FP_A));
        for secret in ["password", "privateKey", "PRIVATE KEY", "passphrase"] {
            assert!(
                !raw.contains(secret),
                "unexpected {secret} in the trust store"
            );
        }
    }
}
