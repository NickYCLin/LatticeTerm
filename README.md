# LatticeTerm

LatticeTerm is a secure, cross-platform workspace for SSH, SFTP, RDP, and VNC connections, built with Tauri 2, Rust, React, and TypeScript.

> [!IMPORTANT]
> LatticeTerm is in its foundation stage. The current app manages non-secret connection metadata and previews the product interface. It does **not** connect to remote hosts or store credentials yet.

## Current foundation

- Responsive desktop interface for SSH, SFTP, RDP, and VNC profiles
- Connection metadata validation with no password or private-key fields
- Minimal Tauri capability permissions and an explicit content security policy
- Rust-to-frontend command boundary ready for protocol engines
- Native application icons for Windows, Linux, and macOS
- Unit tests plus Linux x64 and Linux arm64 CI

## Roadmap

1. SSH terminal sessions using the system OpenSSH client through a PTY
2. OS keychain-backed secrets and strict `known_hosts` verification
3. SFTP browsing and secure file transfer
4. SSH tunnels and native RDP launch
5. Embedded RDP and VNC sessions
6. Signed installers and update channels

The project will not claim that a protocol is available until its security boundary and tests are in place.

## Development

### Prerequisites

- Node.js LTS and npm
- Rust stable with Cargo
- Tauri's platform prerequisites for your operating system

See the [official Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for required system packages.

### Run the web interface

```sh
npm install
npm run dev
```

### Run the desktop application

```sh
npm install
npm run tauri dev
```

### Verify the project

```sh
npm run check
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

## Architecture support

| Platform | Architecture | Status |
| --- | --- | --- |
| Linux | x86_64 / amd64 | CI foundation |
| Linux | aarch64 / arm64 | Native arm64 CI foundation |
| Windows | x86_64 / amd64 | Local development foundation |
| macOS | Apple Silicon and Intel | Planned validation |

Signed release artifacts are not available yet.

## Project model

LatticeTerm is developed in public. The core desktop application is open source under the [Mozilla Public License 2.0](LICENSE), while hosted, managed, team, support, and other service offerings may be commercial and separately licensed.

The public repository must not contain service credentials, private infrastructure, customer data, or proprietary deployment configuration.

## Product documents

- [UI/UX design brief (Traditional Chinese)](docs/UI_UX_DESIGN_BRIEF.zh-TW.md)
- [Local storage and security decision (Traditional Chinese)](docs/STORAGE_SECURITY_DECISION.zh-TW.md)

## Security

Do not place passwords, private keys, tokens, or production host inventories in source files, issues, screenshots, or logs. See [SECURITY.md](SECURITY.md) before reporting a vulnerability.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development and review expectations.

## License and trademark

The source code is licensed under the [Mozilla Public License 2.0](LICENSE). The LatticeTerm name and logo are not granted under the source-code license; see [TRADEMARKS.md](TRADEMARKS.md).
