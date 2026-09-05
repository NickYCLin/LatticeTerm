use super::*;
use crate::sftp_test_server::{bounded, OpenSshServer};
use std::os::unix::fs::symlink;

#[tokio::test]
#[ignore = "Requires the local OpenSSH sftp-server; CI runs these explicitly"]
async fn openssh_listing_handles_batches_unicode_and_symlinks() {
    bounded(async {
        let (server, stream) = OpenSshServer::start(None);
        std::fs::create_dir(server.path("資料夾")).unwrap();
        std::fs::write(server.path("報表.txt"), b"report").unwrap();
        symlink(server.path("missing"), server.path("link")).unwrap();
        for index in 0..500 {
            std::fs::write(server.path(&format!("file-{index:04}.txt")), []).unwrap();
        }
        let raw = RawSftpSession::new(stream);
        raw.init().await.unwrap();
        let path = raw.realpath(".").await.unwrap().files.remove(0).filename;
        let handle = raw.opendir(path.clone()).await.unwrap().handle;
        let entries = collect_directory(&raw, &handle, &path).await.unwrap();
        raw.close(handle).await.unwrap();
        assert_eq!(entries.len(), 503);
        assert_eq!(entries[0].name, "資料夾");
        assert_eq!(entries[0].kind, "directory");
        let report = entries
            .iter()
            .find(|entry| entry.name == "報表.txt")
            .unwrap();
        assert_eq!(report.kind, "file");
        assert_eq!(report.size, 6);
        assert_eq!(
            entries
                .iter()
                .find(|entry| entry.name == "link")
                .unwrap()
                .kind,
            "symlink"
        );
        assert!(entries
            .iter()
            .all(|entry| entry.name != "." && entry.name != ".."));
        server.stop().await;
    })
    .await;
}

#[tokio::test]
#[ignore = "Requires the local OpenSSH sftp-server; CI runs these explicitly"]
async fn openssh_listing_enforces_the_real_directory_entry_limit() {
    bounded(async {
        let (server, stream) = OpenSshServer::start(None);
        for index in 0..MAX_DIRECTORY_ENTRIES {
            std::fs::write(server.path(&format!("file-{index:05}")), []).unwrap();
        }
        let raw = RawSftpSession::new(stream);
        raw.init().await.unwrap();
        let path = raw.realpath(".").await.unwrap().files.remove(0).filename;
        let handle = raw.opendir(path.clone()).await.unwrap().handle;
        assert_eq!(
            collect_directory(&raw, &handle, &path).await.unwrap().len(),
            MAX_DIRECTORY_ENTRIES
        );
        raw.close(handle).await.unwrap();
        std::fs::write(server.path("one-too-many"), []).unwrap();
        let handle = raw.opendir(path.clone()).await.unwrap().handle;
        let error = collect_directory(&raw, &handle, &path).await.unwrap_err();
        raw.close(handle).await.unwrap();
        assert!(
            error.contains("limit") || error.contains("more than"),
            "{error}"
        );
        server.stop().await;
    })
    .await;
}
