//! Live large-transfer tests against the throwaway SSH container.
//!
//! `#[ignore]`d so ordinary `cargo test` and CI stay green. Start the
//! container documented in ssh_live.rs, then run:
//!
//! ```text
//! cargo test --test sftp_transfers_live -- --ignored --test-threads=1
//! ```
//!
//! The point of these tests is the one thing unit tests cannot show: a file
//! larger than the old 32 MiB IPC cap really arrives intact on the other
//! side, in both directions.

use base64::Engine;
use latticeterm_lib::hostkeys::HostTrustStore;
use latticeterm_lib::sftp::{connect, SftpConnectOutcome, SftpConnectRequest, SftpRegistry};
use latticeterm_lib::sftp_transfers::{
    begin_upload, cancel, finish_upload, start_download, upload_chunk, TransferRegistry,
    TransferSink, TransferState, UploadPlan,
};
use latticeterm_lib::ssh::AuthMethod;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const HOST: &str = "127.0.0.1";
const PORT: u16 = 2222;
const USER: &str = "tester";
const PASSWORD: &str = "testpass123";

/// 40 MiB: comfortably past the old cap without slowing the test run much.
const BIG_FILE_BYTES: usize = 40 * 1024 * 1024;
const CHUNK_BYTES: usize = 4 * 1024 * 1024;

#[derive(Default)]
struct Collector {
    states: Mutex<Vec<TransferState>>,
}

impl TransferSink for Collector {
    fn update(&self, state: &TransferState) {
        self.states.lock().unwrap().push(state.clone());
    }
}

fn temp_dir(label: &str) -> std::path::PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("latticeterm-transfer-live-{label}-{unique}"));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn request() -> SftpConnectRequest {
    SftpConnectRequest {
        profile_id: "transfer-live".into(),
        hostname: HOST.into(),
        port: PORT,
        username: USER.into(),
        auth: AuthMethod::Password {
            password: PASSWORD.into(),
        },
        use_saved_password: false,
        remember_password: false,
    }
}

/// A pseudo-random but deterministic payload, so corruption cannot hide.
fn payload() -> Vec<u8> {
    let mut bytes = vec![0u8; BIG_FILE_BYTES];
    let mut state: u64 = 0x9E37_79B9_7F4A_7C15;
    for chunk in bytes.chunks_mut(8) {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
        for (offset, byte) in chunk.iter_mut().enumerate() {
            *byte = (state >> (offset * 8)) as u8;
        }
    }
    bytes
}

async fn connected_session(registry: &Arc<SftpRegistry>) -> String {
    let mut store = HostTrustStore::open(&temp_dir("trust")).unwrap();
    let first = connect(Arc::clone(registry), None, request()).await;
    let SftpConnectOutcome::HostUnknown {
        host,
        port,
        algorithm,
        fingerprint,
    } = first
    else {
        panic!("expected the untrusted host to be refused, got a different outcome");
    };
    let record = store
        .trust(&host, port, &algorithm, &fingerprint, 1)
        .unwrap();

    match connect(Arc::clone(registry), Some(record), request()).await {
        SftpConnectOutcome::Connected { session } => session.session_id,
        other => panic!("expected a session, got {other:?}"),
    }
}

#[tokio::test]
#[ignore = "needs the throwaway SSH container"]
async fn a_file_past_the_old_cap_survives_the_round_trip() {
    let sessions = Arc::new(SftpRegistry::new());
    let session_id = connected_session(&sessions).await;
    let transfers = Arc::new(TransferRegistry::new());
    let sink = Arc::new(Collector::default());

    let original = payload();

    // Upload in the same bounded chunks the interface sends.
    let upload = begin_upload(
        Arc::clone(&transfers),
        &sessions,
        sink.as_ref(),
        UploadPlan {
            session_id: session_id.clone(),
            parent: "/config".into(),
            name: "latticeterm-big.bin".into(),
            total_bytes: original.len() as u64,
            overwrite: true,
        },
    )
    .await
    .unwrap();

    for chunk in original.chunks(CHUNK_BYTES) {
        let encoded = base64::engine::general_purpose::STANDARD.encode(chunk);
        upload_chunk(&transfers, sink.as_ref(), &upload.transfer_id, &encoded)
            .await
            .unwrap();
    }
    finish_upload(&transfers, sink.as_ref(), &upload.transfer_id)
        .await
        .unwrap();

    let finished = transfers
        .list()
        .into_iter()
        .find(|state| state.transfer_id == upload.transfer_id)
        .unwrap();
    assert_eq!(finished.state, "done");
    assert_eq!(finished.bytes_done, original.len() as u64);

    // Download it back into a scratch directory and compare byte for byte.
    let target = temp_dir("download");
    let download = start_download(
        Arc::clone(&transfers),
        &sessions,
        Arc::clone(&sink) as Arc<dyn TransferSink>,
        &session_id,
        "/config/latticeterm-big.bin",
        target.clone(),
    )
    .await
    .unwrap();

    let local_path = download.local_path.expect("downloads have a local path");
    for _ in 0..600 {
        let state = transfers
            .list()
            .into_iter()
            .find(|state| state.transfer_id == download.transfer_id)
            .unwrap();
        match state.state {
            "done" => break,
            "error" | "cancelled" => panic!("download ended early: {:?}", state.detail),
            _ => tokio::time::sleep(Duration::from_millis(100)).await,
        }
    }

    let returned = std::fs::read(&local_path).unwrap();
    assert_eq!(returned.len(), original.len(), "sizes match");
    assert!(returned == original, "every byte survived the round trip");

    // Progress was really reported along the way, not just at the end.
    let reports = sink.states.lock().unwrap();
    assert!(
        reports
            .iter()
            .any(|state| state.state == "running" && state.bytes_done > 0),
        "intermediate progress was visible"
    );
}

#[tokio::test]
#[ignore = "needs the throwaway SSH container"]
async fn a_cancelled_upload_removes_its_partial_remote_file() {
    let sessions = Arc::new(SftpRegistry::new());
    let session_id = connected_session(&sessions).await;
    let transfers = Arc::new(TransferRegistry::new());
    let sink = Arc::new(Collector::default());

    let upload = begin_upload(
        Arc::clone(&transfers),
        &sessions,
        sink.as_ref(),
        UploadPlan {
            session_id: session_id.clone(),
            parent: "/config".into(),
            name: "latticeterm-partial.bin".into(),
            total_bytes: 8 * 1024 * 1024,
            overwrite: true,
        },
    )
    .await
    .unwrap();

    let chunk = base64::engine::general_purpose::STANDARD.encode(vec![7u8; 1024 * 1024]);
    upload_chunk(&transfers, sink.as_ref(), &upload.transfer_id, &chunk)
        .await
        .unwrap();

    cancel(&transfers, &sessions, sink.as_ref(), &upload.transfer_id)
        .await
        .unwrap();

    // Further chunks are refused…
    let refused = upload_chunk(&transfers, sink.as_ref(), &upload.transfer_id, &chunk).await;
    assert!(refused.is_err(), "a cancelled upload accepts nothing more");

    // …and the half-written remote file is gone.
    let session = latticeterm_lib::sftp::list_directory(&sessions, &session_id, "/config")
        .await
        .unwrap();
    assert!(
        !session
            .entries
            .iter()
            .any(|entry| entry.name == "latticeterm-partial.bin"),
        "the partial remote file was removed"
    );
}
