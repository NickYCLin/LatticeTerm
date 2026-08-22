//! Sensitive clipboard lifecycle.
//!
//! The WebView may ask this module to copy one sensitive value or clear the
//! last one it copied, but it never receives arbitrary clipboard read access.
//! Only a SHA-256 digest is retained. Clearing compares the live clipboard
//! first, preserving anything the user copied afterwards.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;
use zeroize::Zeroizing;

const MAX_SENSITIVE_VALUE_BYTES: usize = 4 * 1024;
const ALLOWED_CLEAR_DELAYS: [u64; 4] = [15, 30, 60, 120];

#[derive(Debug, Clone, Copy)]
struct ClipboardRecord {
    generation: u64,
    digest: [u8; 32],
    auto_clear: bool,
}

#[derive(Debug, Default)]
struct ClipboardTracker {
    generation: u64,
    current: Option<ClipboardRecord>,
}

impl ClipboardTracker {
    fn track(&mut self, digest: [u8; 32], auto_clear: bool) -> u64 {
        self.generation = self.generation.wrapping_add(1).max(1);
        self.current = Some(ClipboardRecord {
            generation: self.generation,
            digest,
            auto_clear,
        });
        self.generation
    }

    fn record(
        &self,
        expected_generation: Option<u64>,
        auto_clear_only: bool,
    ) -> Option<ClipboardRecord> {
        let record = self.current?;
        if expected_generation.is_some_and(|expected| expected != record.generation) {
            return None;
        }
        if auto_clear_only && !record.auto_clear {
            return None;
        }
        Some(record)
    }

    fn forget(&mut self, generation: u64) {
        if self
            .current
            .is_some_and(|record| record.generation == generation)
        {
            self.current = None;
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SensitiveClipboardClearOutcome {
    Cleared,
    Nothing,
    Preserved,
    Unavailable,
}

#[derive(Debug, Default)]
pub struct SensitiveClipboard {
    tracker: Mutex<ClipboardTracker>,
}

fn digest_text(value: &str) -> [u8; 32] {
    Sha256::digest(value.as_bytes()).into()
}

fn validate_clear_delay(clear_after_seconds: Option<u64>) -> Result<(), String> {
    if clear_after_seconds.is_some_and(|seconds| !ALLOWED_CLEAR_DELAYS.contains(&seconds)) {
        return Err("The sensitive clipboard clear delay is not supported.".to_string());
    }
    Ok(())
}

impl SensitiveClipboard {
    pub fn copy(
        self: &Arc<Self>,
        app: &AppHandle,
        value: String,
        clear_after_seconds: Option<u64>,
    ) -> Result<(), String> {
        validate_clear_delay(clear_after_seconds)?;
        let value = Zeroizing::new(value);
        if value.is_empty() || value.len() > MAX_SENSITIVE_VALUE_BYTES {
            return Err("Sensitive clipboard text is empty or too long.".to_string());
        }

        let mut tracker = self.tracker.lock().map_err(|error| error.to_string())?;
        // This command is synchronous, so the platform clipboard operation is
        // performed on Tauri's main thread.
        app.clipboard()
            .write_text(value.as_str())
            .map_err(|error| error.to_string())?;
        let generation = tracker.track(digest_text(value.as_str()), clear_after_seconds.is_some());
        drop(tracker);

        if let Some(seconds) = clear_after_seconds {
            let state = Arc::clone(self);
            let timer_app = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(seconds)).await;
                let clear_app = timer_app.clone();
                let _ = timer_app.run_on_main_thread(move || {
                    let _ = state.clear_matching(&clear_app, Some(generation), true);
                });
            });
        }
        Ok(())
    }

    pub fn clear_current(&self, app: &AppHandle) -> SensitiveClipboardClearOutcome {
        self.clear_matching(app, None, false)
    }

    pub fn clear_auto_on_exit(&self, app: &AppHandle) -> SensitiveClipboardClearOutcome {
        self.clear_matching(app, None, true)
    }

    fn clear_matching(
        &self,
        app: &AppHandle,
        expected_generation: Option<u64>,
        auto_clear_only: bool,
    ) -> SensitiveClipboardClearOutcome {
        let Ok(mut tracker) = self.tracker.lock() else {
            return SensitiveClipboardClearOutcome::Unavailable;
        };
        let Some(record) = tracker.record(expected_generation, auto_clear_only) else {
            return SensitiveClipboardClearOutcome::Nothing;
        };
        let Ok(current) = app.clipboard().read_text() else {
            return SensitiveClipboardClearOutcome::Unavailable;
        };
        if current.len() > MAX_SENSITIVE_VALUE_BYTES {
            tracker.forget(record.generation);
            return SensitiveClipboardClearOutcome::Preserved;
        }
        if digest_text(&current) != record.digest {
            tracker.forget(record.generation);
            return SensitiveClipboardClearOutcome::Preserved;
        }
        if app.clipboard().write_text("").is_err() {
            return SensitiveClipboardClearOutcome::Unavailable;
        }
        tracker.forget(record.generation);
        SensitiveClipboardClearOutcome::Cleared
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_the_exposed_clear_delays() {
        for seconds in ALLOWED_CLEAR_DELAYS {
            assert!(validate_clear_delay(Some(seconds)).is_ok());
        }
        assert!(validate_clear_delay(None).is_ok());
        assert!(validate_clear_delay(Some(0)).is_err());
        assert!(validate_clear_delay(Some(31)).is_err());
    }

    #[test]
    fn newer_values_invalidate_older_timers() {
        let mut tracker = ClipboardTracker::default();
        let first = tracker.track(digest_text("first"), true);
        let second = tracker.track(digest_text("second"), true);

        assert!(tracker.record(Some(first), true).is_none());
        assert_eq!(
            tracker
                .record(Some(second), true)
                .map(|record| record.digest),
            Some(digest_text("second"))
        );
    }

    #[test]
    fn disabled_auto_clear_still_allows_an_explicit_clear() {
        let mut tracker = ClipboardTracker::default();
        let generation = tracker.track(digest_text("secret"), false);

        assert!(tracker.record(Some(generation), true).is_none());
        assert!(tracker.record(Some(generation), false).is_some());
    }

    #[test]
    fn forgetting_is_generation_scoped() {
        let mut tracker = ClipboardTracker::default();
        let first = tracker.track(digest_text("first"), true);
        let second = tracker.track(digest_text("second"), true);

        tracker.forget(first);
        assert!(tracker.record(Some(second), false).is_some());
        tracker.forget(second);
        assert!(tracker.record(Some(second), false).is_none());
    }
}
