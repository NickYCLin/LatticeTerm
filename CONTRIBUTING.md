# Contributing to LatticeTerm

Thanks for helping build LatticeTerm. Security, portability, and truthful capability claims take priority over feature count.

## Before making a change

1. Open an issue for a substantial feature or protocol change.
2. Never use production credentials, hostnames, private keys, or customer data in tests.
3. Keep platform-specific code behind a small, documented interface.
4. Add tests for validation, parsing, trust decisions, and failure paths.

## Local checks

Run these checks before opening a pull request:

```sh
npm ci
npm run check
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

## Pull requests

- Keep each pull request focused on one outcome.
- Explain security implications and architecture coverage.
- Include screenshots for visible interface changes.
- Clearly distinguish implemented behavior from planned behavior.
- Do not add telemetry, network calls, or secret persistence without prior discussion.

By contributing, you agree that your contribution is licensed under MPL-2.0.
