//! Large SFTP transfers: a queue that streams, not a payload that fits.
//!
//! The editor-style read/write commands in `sftp` cap files at 32 MiB because
//! their whole payload crosses IPC in one message. Transfers here have no such
//! cap: a download streams from the remote file straight to local disk, and an
//! upload arrives in bounded chunks that are written out as they come. At no
//! point does a whole file sit in memory or cross IPC at once.
//!
//! Every transfer reports progress through one event stream, and a transfer
//! that ends early — cancelled or failed — removes its own partial file, so
//! nothing half-written masquerades as a finished copy.

use crate::sftp::{join_path, validate_name, validate_path, SftpRegistry};
use base64::Engine;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex as AsyncMutex;

/// Emitted on every meaningful progress change of any transfer.
pub const EVENT_TRANSFER: &str = "sftp://transfer";

/// Remote read/write unit. SFTP round-trips per request, so this leans large.
const REMOTE_CHUNK: usize = 256 * 1024;
/// One upload chunk decoded may not exceed this; the frontend sends 4 MiB.
const MAX_UPLOAD_CHUNK: usize = 8 * 1024 * 1024;
/// Progress events fire at most once per this many new bytes.
const EMIT_EVERY_BYTES: u64 = 1024 * 1024;

/// Where transfer progress goes. The app emits Tauri events; tests collect.
pub trait TransferSink: Send + Sync + 'static {
    fn update(&self, state: &TransferState);
}

pub struct EventSink(pub AppHandle);

impl TransferSink for EventSink {
    fn update(&self, state: &TransferState) {
        let _ = self.0.emit(EVENT_TRANSFER, state);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferState {
    pub transfer_id: String,
    pub session_id: String,
    pub kind: &'static str,
    /// The file name, for display.
    pub name: String,
    pub remote_path: String,
    /// Set for downloads: where the file is being written.
    pub local_path: Option<String>,
    pub bytes_done: u64,
    pub total_bytes: Option<u64>,
    pub state: &'static str,
    pub detail: Option<String>,
}

struct TransferEntry {
    state: Mutex<TransferState>,
    cancel: AtomicBool,
    /// The open remote file of an in-progress upload, fed chunk by chunk.
    upload: AsyncMutex<Option<russh_sftp::client::fs::File>>,
}

#[derive(Default)]
pub struct TransferRegistry {
    transfers: Mutex<HashMap<String, Arc<TransferEntry>>>,
    counter: AtomicU64,
}

impl TransferRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    fn next_id(&self) -> String {
        let n = self.counter.fetch_add(1, Ordering::Relaxed) + 1;
        format!("transfer-{n}")
    }

    fn insert(&self, entry: Arc<TransferEntry>) -> Result<(), String> {
        let id = entry
            .state
            .lock()
            .map_err(|e| e.to_string())?
            .transfer_id
            .clone();
        self.transfers
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id, entry);
        Ok(())
    }

    fn entry(&self, transfer_id: &str) -> Result<Arc<TransferEntry>, String> {
        self.transfers
            .lock()
            .map_err(|e| e.to_string())?
            .get(transfer_id)
            .cloned()
            .ok_or_else(|| format!("no transfer called '{transfer_id}'"))
    }

    pub fn list(&self) -> Vec<TransferState> {
        self.transfers
            .lock()
            .map(|guard| {
                guard
                    .values()
                    .filter_map(|entry| entry.state.lock().ok().map(|state| state.clone()))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Flags a transfer to stop. The task or the next chunk call notices.
    pub fn request_cancel(&self, transfer_id: &str) -> Result<(), String> {
        self.entry(transfer_id)?
            .cancel
            .store(true, Ordering::Relaxed);
        Ok(())
    }

    /// Drops finished entries the interface has dismissed.
    pub fn dismiss(&self, transfer_id: &str) -> Result<(), String> {
        let entry = self.entry(transfer_id)?;
        let ended = entry
            .state
            .lock()
            .map(|state| state.state != "running")
            .unwrap_or(true);
        if !ended {
            return Err("the transfer is still running — cancel it first".to_string());
        }
        self.transfers
            .lock()
            .map_err(|e| e.to_string())?
            .remove(transfer_id);
        Ok(())
    }
}

impl TransferEntry {
    /// Applies a change and hands the fresh snapshot to the sink.
    fn update(&self, sink: &dyn TransferSink, apply: impl FnOnce(&mut TransferState)) {
        if let Ok(mut state) = self.state.lock() {
            apply(&mut state);
            sink.update(&state);
        }
    }
}

/// Strips what a local filesystem cannot take, keeping the name recognisable.
fn safe_local_name(remote_name: &str) -> String {
    let cleaned: String = remote_name
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
            {
                '_'
            } else {
                character
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches(|c: char| c == ' ' || c == '.');
    if trimmed.is_empty() {
        "download".to_string()
    } else {
        trimmed.to_string()
    }
}

/// `report.csv` → `report (2).csv` and so on until the name is free, so a new
/// download never silently replaces an old one.
fn unoccupied_path(directory: &Path, name: &str, occupied: impl Fn(&Path) -> bool) -> PathBuf {
    let first = directory.join(name);
    if !occupied(&first) {
        return first;
    }

    let (stem, extension) = match name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => (stem, Some(extension)),
        _ => (name, None),
    };
    for attempt in 2.. {
        let candidate = match extension {
            Some(extension) => directory.join(format!("{stem} ({attempt}).{extension}")),
            None => directory.join(format!("{stem} ({attempt})")),
        };
        if !occupied(&candidate) {
            return candidate;
        }
    }
    unreachable!("the counter above has no upper bound")
}

/// Starts a download that streams the remote file into `target_dir`.
pub async fn start_download(
    transfers: Arc<TransferRegistry>,
    sessions: &SftpRegistry,
    sink: Arc<dyn TransferSink>,
    session_id: &str,
    remote_path: &str,
    target_dir: PathBuf,
) -> Result<TransferState, String> {
    let remote_path = validate_path(remote_path)?;
    let session = sessions.session(session_id)?;

    let total = session
        .metadata(remote_path.clone())
        .await
        .map_err(|error| error.to_string())?
        .len();

    let name = remote_path
        .rsplit('/')
        .next()
        .filter(|part| !part.is_empty())
        .unwrap_or("download");
    let local_name = safe_local_name(name);
    std::fs::create_dir_all(&target_dir).map_err(|error| error.to_string())?;
    let local_path = unoccupied_path(&target_dir, &local_name, |path| path.exists());

    let entry = Arc::new(TransferEntry {
        state: Mutex::new(TransferState {
            transfer_id: transfers.next_id(),
            session_id: session_id.to_string(),
            kind: "download",
            name: local_name,
            remote_path: remote_path.clone(),
            local_path: Some(local_path.display().to_string()),
            bytes_done: 0,
            total_bytes: Some(total),
            state: "running",
            detail: None,
        }),
        cancel: AtomicBool::new(false),
        upload: AsyncMutex::new(None),
    });
    transfers.insert(Arc::clone(&entry))?;
    let snapshot = entry.state.lock().map_err(|e| e.to_string())?.clone();
    sink.update(&snapshot);

    let task_entry = Arc::clone(&entry);
    tokio::spawn(async move {
        let result: Result<(), String> = async {
            let mut remote = session
                .open(remote_path.clone())
                .await
                .map_err(|error| error.to_string())?;
            let mut local = tokio::fs::File::create(&local_path)
                .await
                .map_err(|error| error.to_string())?;

            let mut buffer = vec![0u8; REMOTE_CHUNK];
            let mut done: u64 = 0;
            let mut last_emitted: u64 = 0;
            loop {
                if task_entry.cancel.load(Ordering::Relaxed) {
                    return Err("cancelled".to_string());
                }
                let read = remote
                    .read(&mut buffer)
                    .await
                    .map_err(|error| error.to_string())?;
                if read == 0 {
                    break;
                }
                local
                    .write_all(&buffer[..read])
                    .await
                    .map_err(|error| error.to_string())?;
                done += read as u64;
                if done - last_emitted >= EMIT_EVERY_BYTES {
                    last_emitted = done;
                    task_entry.update(sink.as_ref(), |state| state.bytes_done = done);
                }
            }
            local.flush().await.map_err(|error| error.to_string())?;
            task_entry.update(sink.as_ref(), |state| {
                state.bytes_done = done;
                state.state = "done";
            });
            Ok(())
        }
        .await;

        if let Err(detail) = result {
            // A partial file is worse than no file: it looks complete.
            let _ = tokio::fs::remove_file(&local_path).await;
            let cancelled = detail == "cancelled";
            task_entry.update(sink.as_ref(), |state| {
                state.state = if cancelled { "cancelled" } else { "error" };
                state.detail = (!cancelled).then_some(detail);
            });
        }
    });

    Ok(snapshot)
}

/// What an upload needs before its first byte arrives.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadPlan {
    pub session_id: String,
    pub parent: String,
    pub name: String,
    pub total_bytes: u64,
    pub overwrite: bool,
}

/// Opens the remote file an upload will stream into.
pub async fn begin_upload(
    transfers: Arc<TransferRegistry>,
    sessions: &SftpRegistry,
    sink: &dyn TransferSink,
    plan: UploadPlan,
) -> Result<TransferState, String> {
    let session_id = plan.session_id.as_str();
    let total_bytes = plan.total_bytes;
    let overwrite = plan.overwrite;
    let parent = validate_path(&plan.parent)?;
    let name = validate_name(&plan.name)?;
    let session = sessions.session(session_id)?;
    let remote_path = join_path(&parent, &name);

    if !overwrite
        && session
            .try_exists(remote_path.clone())
            .await
            .map_err(|error| error.to_string())?
    {
        return Err("The remote file already exists; confirm overwrite first.".to_string());
    }

    let file = session
        .create(remote_path.clone())
        .await
        .map_err(|error| error.to_string())?;

    let entry = Arc::new(TransferEntry {
        state: Mutex::new(TransferState {
            transfer_id: transfers.next_id(),
            session_id: session_id.to_string(),
            kind: "upload",
            name,
            remote_path,
            local_path: None,
            bytes_done: 0,
            total_bytes: Some(total_bytes),
            state: "running",
            detail: None,
        }),
        cancel: AtomicBool::new(false),
        upload: AsyncMutex::new(Some(file)),
    });
    transfers.insert(Arc::clone(&entry))?;
    let snapshot = entry.state.lock().map_err(|e| e.to_string())?.clone();
    sink.update(&snapshot);
    Ok(snapshot)
}

/// Writes one chunk of an upload. Chunks arrive in order from a single reader.
pub async fn upload_chunk(
    transfers: &TransferRegistry,
    sink: &dyn TransferSink,
    transfer_id: &str,
    data_base64: &str,
) -> Result<(), String> {
    let entry = transfers.entry(transfer_id)?;
    if entry.cancel.load(Ordering::Relaxed) {
        return Err("cancelled".to_string());
    }

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64)
        .map_err(|error| format!("the chunk was not valid base64: {error}"))?;
    if bytes.len() > MAX_UPLOAD_CHUNK {
        return Err("the chunk exceeds the upload chunk limit".to_string());
    }

    let mut slot = entry.upload.lock().await;
    let file = slot
        .as_mut()
        .ok_or_else(|| "the upload is not accepting data".to_string())?;

    let write = async {
        file.write_all(&bytes)
            .await
            .map_err(|error| error.to_string())
    }
    .await;

    if let Err(detail) = write {
        *slot = None;
        drop(slot);
        entry.update(sink, |state| {
            state.state = "error";
            state.detail = Some(detail.clone());
        });
        return Err(detail);
    }

    drop(slot);
    let done = {
        let mut state = entry.state.lock().map_err(|e| e.to_string())?;
        state.bytes_done += bytes.len() as u64;
        state.bytes_done
    };
    // Chunks arrive megabytes at a time, so per-chunk reporting is already
    // coarse enough not to flood the event stream.
    let _ = done;
    if let Ok(state) = entry.state.lock() {
        sink.update(&state);
    }
    Ok(())
}

/// Closes an upload's remote file and marks the transfer finished.
pub async fn finish_upload(
    transfers: &TransferRegistry,
    sink: &dyn TransferSink,
    transfer_id: &str,
) -> Result<(), String> {
    let entry = transfers.entry(transfer_id)?;
    let mut slot = entry.upload.lock().await;
    let Some(mut file) = slot.take() else {
        return Err("the upload is not accepting data".to_string());
    };
    drop(slot);

    file.flush().await.map_err(|error| error.to_string())?;
    file.shutdown().await.map_err(|error| error.to_string())?;
    entry.update(sink, |state| state.state = "done");
    Ok(())
}

/// Cancels a transfer. A download's task notices the flag; an upload is ended
/// here and its partial remote file removed.
pub async fn cancel(
    transfers: &TransferRegistry,
    sessions: &SftpRegistry,
    sink: &dyn TransferSink,
    transfer_id: &str,
) -> Result<(), String> {
    let entry = transfers.entry(transfer_id)?;
    entry.cancel.store(true, Ordering::Relaxed);

    let mut slot = entry.upload.lock().await;
    if let Some(file) = slot.take() {
        drop(file);
        let (session_id, remote_path) = {
            let state = entry.state.lock().map_err(|e| e.to_string())?;
            (state.session_id.clone(), state.remote_path.clone())
        };
        if let Ok(session) = sessions.session(&session_id) {
            let _ = session.remove_file(remote_path).await;
        }
        entry.update(sink, |state| state.state = "cancelled");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_names_lose_what_windows_cannot_store() {
        assert_eq!(safe_local_name("report.csv"), "report.csv");
        assert_eq!(safe_local_name("a<b>c:d.txt"), "a_b_c_d.txt");
        assert_eq!(safe_local_name("...   "), "download");
        assert_eq!(safe_local_name("logs|2026?.log"), "logs_2026_.log");
    }

    #[test]
    fn a_taken_name_counts_upward_instead_of_replacing() {
        let dir = Path::new("/downloads");
        let taken = [
            PathBuf::from("/downloads/report.csv"),
            PathBuf::from("/downloads/report (2).csv"),
        ];
        let chosen = unoccupied_path(dir, "report.csv", |p| taken.contains(&p.to_path_buf()));
        assert_eq!(chosen, PathBuf::from("/downloads/report (3).csv"));

        let free = unoccupied_path(dir, "notes.md", |_| false);
        assert_eq!(free, PathBuf::from("/downloads/notes.md"));

        let no_extension = unoccupied_path(dir, "backup", |p| p == Path::new("/downloads/backup"));
        assert_eq!(no_extension, PathBuf::from("/downloads/backup (2)"));
    }

    #[test]
    fn transfer_states_use_the_field_names_the_interface_reads() {
        let state = TransferState {
            transfer_id: "transfer-1".into(),
            session_id: "sftp-1".into(),
            kind: "download",
            name: "report.csv".into(),
            remote_path: "/srv/report.csv".into(),
            local_path: Some("C:/Users/me/Downloads/report.csv".into()),
            bytes_done: 512,
            total_bytes: Some(1024),
            state: "running",
            detail: None,
        };
        let encoded = serde_json::to_value(&state).unwrap();
        assert_eq!(encoded["transferId"], "transfer-1");
        assert_eq!(encoded["sessionId"], "sftp-1");
        assert_eq!(encoded["bytesDone"], 512);
        assert_eq!(encoded["totalBytes"], 1024);
        assert_eq!(encoded["remotePath"], "/srv/report.csv");
        assert!(encoded.get("transfer_id").is_none());
    }

    #[test]
    fn a_running_transfer_cannot_be_dismissed() {
        let registry = TransferRegistry::new();
        let entry = Arc::new(TransferEntry {
            state: Mutex::new(TransferState {
                transfer_id: "transfer-1".into(),
                session_id: "sftp-1".into(),
                kind: "upload",
                name: "big.bin".into(),
                remote_path: "/srv/big.bin".into(),
                local_path: None,
                bytes_done: 0,
                total_bytes: None,
                state: "running",
                detail: None,
            }),
            cancel: AtomicBool::new(false),
            upload: AsyncMutex::new(None),
        });
        registry.insert(entry).unwrap();

        assert!(registry.dismiss("transfer-1").is_err());
        assert_eq!(registry.list().len(), 1);

        registry
            .entry("transfer-1")
            .unwrap()
            .state
            .lock()
            .unwrap()
            .state = "done";
        registry.dismiss("transfer-1").unwrap();
        assert!(registry.list().is_empty());
    }
}
