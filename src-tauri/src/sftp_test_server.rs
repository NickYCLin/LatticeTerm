//! Test-only OpenSSH peer. No sshd, listening port, account or credentials.
//! Every request uses paths under a newly created temporary directory.

use crate::sftp_limits::BoundedSftpStream;
use std::future::Future;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::process::{Child, Command};

pub(crate) struct OpenSshServer {
    // kill_on_drop also cleans up if an assertion or the deadline fails.
    child: Child,
    pub(crate) directory: tempfile::TempDir,
}

impl OpenSshServer {
    pub(crate) fn start(
        denied_requests: Option<&str>,
    ) -> (Self, impl AsyncRead + AsyncWrite + Unpin + Send) {
        let executable = ["/usr/libexec/sftp-server", "/usr/lib/openssh/sftp-server"]
            .into_iter()
            .find(|path| Path::new(path).is_file())
            .expect("Install OpenSSH sftp-server before running the ignored openssh_ tests");
        let directory = tempfile::Builder::new()
            .prefix("latticeterm-openssh-")
            .tempdir()
            .unwrap();
        let mut command = Command::new(executable);
        command
            .current_dir(directory.path())
            .env_clear()
            // The application, not an inherited restrictive umask, must
            // establish private file permissions. Avoid writing to syslog.
            .args(["-e", "-u", "000"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true);
        if let Some(requests) = denied_requests {
            command.args(["-P", requests]);
        }
        let mut child = command.spawn().unwrap();
        let stream = BoundedSftpStream::new(tokio::io::join(
            child.stdout.take().unwrap(),
            child.stdin.take().unwrap(),
        ));
        (Self { child, directory }, stream)
    }

    pub(crate) fn path(&self, name: &str) -> String {
        self.directory
            .path()
            .join(name)
            .to_str()
            .unwrap()
            .to_owned()
    }

    pub(crate) async fn stop(mut self) {
        self.child.kill().await.unwrap();
    }
}

pub(crate) async fn bounded(test: impl Future<Output = ()>) {
    tokio::time::timeout(Duration::from_secs(45), test)
        .await
        .expect("OpenSSH interoperability test exceeded 45 seconds");
}
