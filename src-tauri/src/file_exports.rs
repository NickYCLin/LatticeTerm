//! User-requested exports, separate from private application data.

use std::fs;
use std::io::{ErrorKind, Write};
use std::path::Path;

const MAX_EXPORT_BYTES: usize = 28 * 1024 * 1024;

pub fn prepare_documents(directory: &Path) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let metadata = fs::symlink_metadata(directory).map_err(|error| error.to_string())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("The documents location must be a directory, not a link.".into());
    }
    Ok(())
}

fn validate_export(filename: &str, contents: &str) -> Result<(), String> {
    let known_name = (filename.starts_with("latticeterm-connections-")
        && filename.ends_with(".json"))
        || (filename.starts_with("LatticeTerm-") && filename.ends_with(".latticeterm-backup"));
    if !known_name
        || filename.len() > 160
        || filename.contains("..")
        || !filename
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.'))
    {
        return Err("The export filename is invalid.".into());
    }
    if contents.is_empty() || contents.len() > MAX_EXPORT_BYTES {
        return Err("The export is empty or exceeds the size limit.".into());
    }
    Ok(())
}

/// Write completely before publishing; never overwrite an existing file,
/// including a symlink or a file created concurrently by the Files app.
pub fn save_document(directory: &Path, filename: &str, contents: &str) -> Result<String, String> {
    validate_export(filename, contents)?;
    prepare_documents(directory)?;
    let mut staging = tempfile::Builder::new()
        .prefix(".latticeterm-export-")
        .tempfile_in(directory)
        .map_err(|error| error.to_string())?;
    staging
        .write_all(contents.as_bytes())
        .and_then(|_| staging.as_file().sync_all())
        .map_err(|error| error.to_string())?;
    let (stem, extension) = filename.rsplit_once('.').expect("validated extension");
    for attempt in 1..=1_000 {
        let candidate = if attempt == 1 {
            filename.to_string()
        } else {
            format!("{stem} ({attempt}).{extension}")
        };
        match staging.persist_noclobber(directory.join(&candidate)) {
            Ok(_) => return Ok(candidate),
            Err(error) if error.error.kind() == ErrorKind::AlreadyExists => staging = error.file,
            Err(error) => return Err(error.error.to_string()),
        }
    }
    Err("Too many exports with this filename. Move older exports and try again.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    const NAME: &str = "latticeterm-connections-2026-09-05.json";

    #[test]
    fn publishes_complete_files_without_overwriting_previous_exports() {
        let directory = tempfile::tempdir().unwrap();
        assert_eq!(
            save_document(directory.path(), NAME, "first").unwrap(),
            NAME
        );
        let next = save_document(directory.path(), NAME, "second").unwrap();
        assert_eq!(next, "latticeterm-connections-2026-09-05 (2).json");
        assert_eq!(
            fs::read_to_string(directory.path().join(NAME)).unwrap(),
            "first"
        );
        assert_eq!(
            fs::read_to_string(directory.path().join(next)).unwrap(),
            "second"
        );
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 2);
    }

    #[test]
    fn rejects_paths_and_oversized_exports_before_creating_files() {
        let directory = tempfile::tempdir().unwrap();
        for filename in [
            "../latticeterm-connections-test.json",
            "/latticeterm-connections-test.json",
            "latticeterm-connections-../test.json",
            "latticeterm-connections-\\test.json",
            "latticeterm-connections-\0.json",
            "vault.json",
        ] {
            assert!(save_document(directory.path(), filename, "data").is_err());
        }
        assert!(save_document(directory.path(), NAME, "").is_err());
        assert!(save_document(directory.path(), NAME, &"x".repeat(MAX_EXPORT_BYTES + 1)).is_err());
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 0);
    }

    #[test]
    fn concurrent_exports_keep_every_file() {
        let directory = tempfile::tempdir().unwrap();
        std::thread::scope(|scope| {
            let threads: Vec<_> = (0..8)
                .map(|index| {
                    let path = directory.path();
                    scope.spawn(move || save_document(path, NAME, &index.to_string()).unwrap())
                })
                .collect();
            let names: std::collections::HashSet<_> = threads
                .into_iter()
                .map(|thread| thread.join().unwrap())
                .collect();
            assert_eq!(names.len(), 8);
        });
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 8);
    }

    #[test]
    fn encrypted_backup_extension_is_preserved() {
        let directory = tempfile::tempdir().unwrap();
        let name = "LatticeTerm-2026-09-05T00-00-00-000Z.latticeterm-backup";
        assert_eq!(
            save_document(directory.path(), name, "encrypted").unwrap(),
            name
        );
    }

    #[cfg(unix)]
    #[test]
    fn links_cannot_redirect_exports_and_files_remain_private() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let directory = tempfile::tempdir().unwrap();
        let external = tempfile::tempdir().unwrap();
        let target = external.path().join("keep");
        fs::write(&target, "keep").unwrap();
        symlink(&target, directory.path().join(NAME)).unwrap();
        let saved = save_document(directory.path(), NAME, "new").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "keep");
        let mode = fs::metadata(directory.path().join(saved))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
        let linked_directory = directory.path().join("linked");
        symlink(external.path(), &linked_directory).unwrap();
        assert!(save_document(&linked_directory, NAME, "blocked").is_err());
        assert!(!external.path().join(NAME).exists());
    }
}
