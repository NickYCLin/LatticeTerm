# Security policy

LatticeTerm handles remote-host identities and will eventually handle authentication material. Security reports are treated as private by default.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability or include credentials, private keys, host inventories, or exploit details in public discussions.

Use the repository's private [GitHub Security Advisory form](https://github.com/NickYCLin/LatticeTerm/security/advisories/new). Include:

- the affected commit or version;
- operating system and architecture;
- reproduction steps with sanitized test hosts;
- expected and observed behavior;
- potential impact;
- a suggested fix, if available.

You should receive an acknowledgement through GitHub after the report is reviewed. No response-time guarantee is offered during the pre-release stage.

## Supported versions

LatticeTerm has not published a stable release. Security fixes currently target the latest commit on `main`.

## Current security boundaries

- Connection profiles persist in the operating system's per-user application-data directory and contain no passwords, private keys, passphrases, or tokens.
- SSH terminal sessions use the Rust `russh` engine. Passwords are held only for the active connection and are never written to disk.
- SSH host keys are checked strictly against `known_hosts.json`. Unknown keys require an explicit comparison, changed keys are blocked, and the Key Vault view manages the same real trust store.
- Lattice Remote Agent captures the primary display only after the local user explicitly starts sharing. The integrated host mode refuses wildcard or multicast bindings, keeps its eight-digit pairing code in process/WebView memory, removes the code from UI state after pairing, and terminates the sidecar when sharing stops. The stream uses Noise XXpsk3 with ChaChaPoly and BLAKE2s; version 1 is view-only.
- Web RDP runs IronRDP in an isolated child process. The password is sent once over stdin, never appears in process arguments or persistent state, and the browser surface receives display frames rather than network credentials.
- Web RDP enforces TLS certificate validation. A self-signed certificate is rejected first; the UI may retry only with the exact SHA-256 certificate fingerprint explicitly approved for that attempt. NLA/CredSSP is required and legacy graphical TLS login is disabled.
- Screenshots and recordings are initiated explicitly in the session toolbar and are produced from the remote Canvas only. Media stays in WebView memory until the user downloads it; LatticeTerm does not upload or persist captures in application storage.
- Credential persistence, private-key import, Stronghold integration, OS keychain integration, SFTP, and VNC are not implemented.
- Tauri IPC exposes scoped profile-storage, SSH-session, Lattice Remote, Web RDP input/session, trusted-host, runtime-summary, and updater operations; it does not expose arbitrary filesystem access.
- Logs and screenshots must not contain secrets or private infrastructure details.

These statements describe the current source tree, not a security audit or certification.
