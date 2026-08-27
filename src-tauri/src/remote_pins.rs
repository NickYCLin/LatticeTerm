//! Trust-on-first-use pinning of relay devices' Noise static keys.
//!
//! The first successful connection to a device ID records a fingerprint of
//! the key the device presented; later connections must present the same key.
//! A malicious relay (or someone who hijacked the ID) cannot substitute its
//! own endpoint without the viewer noticing, even if it guessed the pairing
//! code. The file holds only public-key fingerprints — nothing secret.

use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::Path;

pub const PINS_FILE: &str = "remote-device-pins.json";

#[derive(Debug, PartialEq, Eq)]
pub enum PinOutcome {
    /// First connection to this device: its key is now pinned.
    FirstUse,
    /// The device presented the same key as before.
    Matched,
}

pub fn fingerprint(static_key: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(b"lattice-remote-device-key-v1:");
    digest.update(static_key);
    digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn load(path: &Path) -> Result<HashMap<String, String>, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|error| format!("The pin file is unreadable: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(error) => Err(format!("The pin file is unreadable: {error}")),
    }
}

fn save(path: &Path, pins: &HashMap<String, String>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let json = serde_json::to_vec_pretty(pins).map_err(|error| error.to_string())?;
    std::fs::write(path, json).map_err(|error| error.to_string())
}

/// Checks the presented key against the pin for this device ID, pinning it
/// on first use. A mismatch is an error the connection must not survive.
pub fn verify_or_pin(
    path: &Path,
    device_id: &str,
    static_key: &[u8],
) -> Result<PinOutcome, String> {
    let mut pins = load(path)?;
    let presented = fingerprint(static_key);
    match pins.get(device_id) {
        Some(pinned) if *pinned == presented => Ok(PinOutcome::Matched),
        Some(_) => Err(format!(
            "Device {device_id} presented a different identity key than it did before. \
If the device was reinstalled this is expected once — remove its entry from \
{PINS_FILE} in the app data folder and connect again. Otherwise someone may be \
impersonating it; do not enter the pairing code anywhere else."
        )),
        None => {
            pins.insert(device_id.to_string(), presented);
            save(path, &pins)?;
            Ok(PinOutcome::FirstUse)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn scratch_file(name: &str) -> PathBuf {
        std::env::temp_dir()
            .join(format!("lattice-pin-tests-{}", std::process::id()))
            .join(name)
    }

    #[test]
    fn first_use_pins_and_matching_key_passes() {
        let path = scratch_file("pins-a.json");
        let _ = std::fs::remove_file(&path);
        assert_eq!(
            verify_or_pin(&path, "123456789", b"key-one").unwrap(),
            PinOutcome::FirstUse
        );
        assert_eq!(
            verify_or_pin(&path, "123456789", b"key-one").unwrap(),
            PinOutcome::Matched
        );
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_changed_key_is_rejected() {
        let path = scratch_file("pins-b.json");
        let _ = std::fs::remove_file(&path);
        verify_or_pin(&path, "123456789", b"key-one").unwrap();
        let error = verify_or_pin(&path, "123456789", b"key-two").unwrap_err();
        assert!(error.contains("different identity key"));
        // The original pin survives the failed attempt.
        assert_eq!(
            verify_or_pin(&path, "123456789", b"key-one").unwrap(),
            PinOutcome::Matched
        );
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn devices_are_pinned_independently() {
        let path = scratch_file("pins-c.json");
        let _ = std::fs::remove_file(&path);
        verify_or_pin(&path, "111111111", b"key-one").unwrap();
        assert_eq!(
            verify_or_pin(&path, "222222222", b"key-two").unwrap(),
            PinOutcome::FirstUse
        );
        assert_eq!(
            verify_or_pin(&path, "111111111", b"key-one").unwrap(),
            PinOutcome::Matched
        );
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn fingerprints_hide_the_key_and_stay_stable() {
        let print = fingerprint(b"some-public-key");
        assert_eq!(print, fingerprint(b"some-public-key"));
        assert_ne!(print, fingerprint(b"other-public-key"));
        assert_eq!(print.len(), 64);
    }
}
