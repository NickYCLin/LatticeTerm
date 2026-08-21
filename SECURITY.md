# Security policy

LatticeTerm handles remote-host identities and authentication material. Security reports are treated as private by default.

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
- SSH terminal sessions use the Rust russh engine. Passwords default to one connection attempt; when the user explicitly chooses to remember one, it is written only after authentication succeeds and only to the operating system credential store.
- SFTP uses the same russh transport and strict host-key trust store, with a separate OS credential entry per profile. Remote paths reject control characters, mutating actions are user initiated, and overwrites and deletes require confirmation in the UI. Large transfers use bounded streaming; uploads remain in a private same-directory staging file until the declared byte count is complete, then protect and replace an existing target. Cancellation, failure, and session disconnect remove incomplete staging files. The legacy whole-payload read/write IPC remains capped at 32 MiB.
- SSH host keys are checked strictly against `known_hosts.json`. Unknown keys require an explicit comparison, changed keys are blocked, and the Key Vault view manages the same real trust store.
- Lattice Remote Agent captures the primary display only after the local user explicitly starts sharing. The integrated host mode refuses wildcard or multicast bindings, keeps its eight-digit pairing code in process/WebView memory, removes the code from UI state after pairing, and terminates the sidecar when sharing stops. The stream uses Noise XXpsk3 with ChaChaPoly and BLAKE2s; version 1 is view-only.
- Web RDP runs IronRDP in an isolated child process. The password is sent once over stdin, never appears in process arguments or profile files, and the browser surface receives display frames rather than network credentials. Optional persistence uses the same OS credential store and occurs only after a successful connection.
- Web RDP enforces TLS certificate validation. A self-signed certificate is rejected first; the UI may retry only with the exact SHA-256 certificate fingerprint explicitly approved for that attempt. NLA/CredSSP is required and legacy graphical TLS login is disabled.
- Screenshots and recordings are initiated explicitly in the session toolbar and are produced from the remote Canvas only. Media stays in WebView memory until the user downloads it; LatticeTerm does not upload or persist captures in application storage.
- Agent Fleet launches local AI CLIs in native PTYs with the current operating-system user permissions. Executables and arguments remain separate and are never interpolated into a shell command. LatticeTerm does not read or store model API keys, terminal transcripts, or prompt history; every registered CLI is terminated when the user stops it or the app exits.
- Custom Agent Fleet inputs reject control characters and enforce limits on labels, paths, arguments, terminal dimensions, and IPC input size. Working directories are canonicalized before launch. On Windows, only directly executable `.exe` and `.com` files are accepted until a safe command-shim adapter is implemented.
- Agent semantic reports are accepted only by an ephemeral loopback listener. Each PTY child receives a separate 256-bit random token; reports are capped at 4 KiB, time out, and can select only one of four lifecycle states. The reporter cannot send terminal input, launch processes, read files, or retrieve prompts. Processes running as the same operating-system user remain inside this local trust boundary because they may be able to inspect another process environment.
- Password persistence uses Windows Credential Manager, macOS Keychain, or Linux Secret Service through keyring-rs; the optional master-password vault uses Argon2id and XChaCha20-Poly1305. SSH private keys are read only from a user-selected local path and are not copied into profile storage. SSH tunnels and VNC are implemented; VNC is explicitly identified as unencrypted and should be carried through an SSH tunnel on untrusted networks. Stronghold-backed storage and private-key import remain unimplemented.
- Tauri IPC exposes scoped profile-storage, Agent Fleet PTY, SSH/SFTP-session, Lattice Remote, Web RDP input/session, trusted-host, credential-status/existence/deletion, runtime-summary, and updater operations. Agent Fleet input events are capped at 64 KiB and target only an existing in-memory session. SFTP file bytes cross IPC only after an explicit upload or download. There is deliberately no IPC command that returns a saved password to the WebView, and no arbitrary local filesystem access.
- Logs and screenshots must not contain secrets or private infrastructure details.

These statements describe the current source tree, not a security audit or certification.
