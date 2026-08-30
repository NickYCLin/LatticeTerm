# Security policy

LatticeTerm handles remote-host identities and authentication material. Security reports are treated as private by default.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability or include credentials, private keys, host inventories, or exploit details in public discussions.

Use the repository's private [GitHub Security Advisory form](https://github.com/NickYCLin/lattice-term/security/advisories/new). Include:

- the affected commit or version;
- operating system and architecture;
- reproduction steps with sanitized test hosts;
- expected and observed behavior;
- potential impact;
- a suggested fix, if available.

You should receive an acknowledgement through GitHub after the report is reviewed. No response-time guarantee is offered during the pre-1.0 stage.

## Supported versions

LatticeTerm is currently pre-1.0. The latest GitHub Release and the latest commit on `main` receive security fixes; fixes land on `main` first and are included in the next applicable release. Older pre-1.0 releases are not maintained as separate support lines.

## Current security boundaries

- Connection profiles persist in the operating system's per-user application-data directory and contain no passwords, private keys, passphrases, or tokens.
- SSH terminal sessions use the Rust russh engine. Passwords default to one connection attempt; when the user explicitly chooses to remember one, it is written only after authentication succeeds and only to the operating system credential store.
- SFTP uses the same russh transport and strict host-key trust store, with a separate OS credential entry per profile. Remote paths reject control characters, mutating actions are user initiated, and overwrites and deletes require confirmation in the UI. Large transfers use bounded streaming; uploads remain in a private same-directory staging file until the declared byte count is complete, then protect and replace an existing target. Cancellation, failure, and session disconnect remove incomplete staging files. The legacy whole-payload read/write IPC remains capped at 32 MiB.
- SSH host keys are checked strictly against `known_hosts.json`. Unknown keys require an explicit comparison, changed keys are blocked, and the Key Vault view manages the same real trust store.
- Lattice Remote starts only after the local user explicitly enables sharing. Direct mode refuses wildcard or multicast bindings and uses a five-minute, one-session pairing code. Relay mode connects outward, keeps serving until stopped, and uses a permanent nine-digit device identity plus an eight-digit pairing code; returning viewers reject a changed device key through trust-on-first-use pinning. A first-use pin is persisted only after the viewer receives the Agent's valid encrypted Hello, which proves that the responder accepted the pairing code; an incomplete or rejected Noise handshake cannot poison the saved identity.
- Lattice Remote protocol version 2 carries either the primary display or a PTY-backed shell through Noise XXpsk3 with ChaChaPoly and BLAKE2s. Sessions are view-only by default. Mouse/keyboard or terminal input requires `--allow-input`, while file browsing, upload, and download require an independently authorised single `--file-root`. Remote paths cannot escape that canonical root, and incomplete uploads are not published.
- The relay endpoint is non-secret connection metadata. LatticeTerm remembers it in WebView local storage and collapses it in routine dialogs after first use, but this is a usability choice rather than a security control. Public endpoints must use `wss://`; the relay sees device IDs and routing metadata but only forwards end-to-end encrypted session bytes and never receives the pairing code. A public ingress must supply per-client abuse controls because loopback connections from a reverse proxy are exempt from the relay's direct-source rate limit.
- A relay device identity contains its registration token and Noise private key. On Unix, new and existing identity files are forced to owner-only mode `0600`; the relay registry stores only token hashes and is also owner-only. Fixed pairing codes are not persisted by the integrated host and are sent to the child Agent through stdin, not process arguments. Standalone unattended deployments should use an owner-only `--pair-code-file`; command-line `--pair-code` values may be visible in process listings.
- Lattice Remote protocol decoding rejects agent names over 256 bytes or containing control characters, close reasons over 1,024 bytes, frames over 8 MiB, dimensions over 16,384 px per edge, more than 32 Mi pixels, unsafe terminal messages, and out-of-bound file chunks before they reach the WebView or host resources. Five consecutive pairing failures stop the Agent; service managers must not defeat that protection with unconditional restarts.
- Web RDP runs IronRDP in an isolated child process. The password is sent once over stdin, never appears in process arguments or profile files, and the browser surface receives display frames rather than network credentials. Optional persistence uses the same OS credential store and occurs only after a successful connection.
- Web RDP enforces TLS certificate validation. A self-signed certificate is rejected first; the UI may retry only with the exact SHA-256 certificate fingerprint explicitly approved for that attempt. NLA/CredSSP is required and legacy graphical TLS login is disabled.
- Screenshots and recordings are initiated explicitly in the session toolbar and are produced from the remote Canvas only. Media stays in WebView memory until the user downloads it; LatticeTerm does not upload or persist captures in application storage.
- Agent Fleet launches local AI CLIs in native PTYs with the current operating-system user permissions. Executables and arguments remain separate and are never interpolated into a shell command. LatticeTerm does not inspect or separately persist model API keys. To restore visible context after a normal app restart, it may retain each Agent's latest 256 KiB terminal-output tail in an XChaCha20-Poly1305 encrypted, device-local file; its random key stays in Windows Credential Manager, macOS Keychain, or Linux Secret Service and never enters the WebView. If the operating-system credential store is unavailable, terminal output remains memory-only. Every registered CLI is terminated when the user stops it or the app exits.
- Custom Agent Fleet inputs reject control characters and enforce limits on labels, paths, arguments, terminal dimensions, and IPC input size. Working directories are canonicalized before launch. On Windows, only directly executable `.exe` and `.com` files are accepted until a safe command-shim adapter is implemented.
- Agent semantic reports are accepted only by an ephemeral loopback listener. Each PTY child receives a separate 256-bit random token; reports are capped at 4 KiB, time out, and can select only one of four lifecycle states. The reporter cannot send terminal input, launch processes, read files, or retrieve prompts. Processes running as the same operating-system user remain inside this local trust boundary because they may be able to inspect another process environment.
- GitHub Actions dependencies are pinned to full commit SHAs and checked by `npm run actions:check`. The default workflow token is read-only; write scopes are granted only to the Release Please, artifact-upload, and release-publish jobs that require them. Updater signing material is injected only into the signing steps and is never stored in the repository or application bundle.
- Linux GTK3 currently requires `glib` 0.18. LatticeTerm vendors the crates.io 0.18.5 source and applies gtk-rs upstream commit `05dff0e` for RUSTSEC-2024-0429; the vendored release-mode iterator tests guard the affected `VariantStrIter` path until Tauri can adopt a newer GTK stack.
- Password persistence uses Windows Credential Manager, macOS Keychain, or Linux Secret Service through keyring-rs; the optional master-password vault uses Argon2id and XChaCha20-Poly1305. SSH private keys are read only from a user-selected local path and are not copied into profile storage. SSH tunnels and VNC are implemented; VNC is explicitly identified as unencrypted and should be carried through an SSH tunnel on untrusted networks. Stronghold is not planned because the upstream project is archived; importing private-key material into either credential backend remains unimplemented.
- Tauri IPC exposes scoped profile-storage, Agent Fleet PTY, SSH/SFTP-session, Lattice Remote, Web RDP input/session, trusted-host, credential-status/existence/deletion, runtime-summary, and updater operations. Agent Fleet input events are capped at 64 KiB and target only an existing in-memory session. SFTP file bytes cross IPC only after an explicit upload or download. There is deliberately no IPC command that returns a saved password to the WebView, and no arbitrary local filesystem access.
- Logs and screenshots must not contain secrets or private infrastructure details.

These statements describe the current source tree, not a security audit or certification.
