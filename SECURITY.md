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

- The foundation UI stores connection profiles only in memory.
- Password storage, private-key import, SSH host verification, and protocol engines are not implemented.
- The Tauri application exposes only core permissions and a read-only runtime summary command.
- Logs and screenshots must not contain secrets or private infrastructure details.

These statements describe the current source tree, not a security audit or certification.
