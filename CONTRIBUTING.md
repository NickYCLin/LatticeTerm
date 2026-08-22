# Contributing to LatticeTerm

Thanks for helping build LatticeTerm. Security, portability, and truthful capability claims take priority over feature count.

## Before making a change

1. Open an issue for a substantial feature or protocol change.
2. Never use production credentials, hostnames, private keys, or customer data in tests.
3. Keep platform-specific code behind a small, documented interface.
4. Add tests for validation, parsing, trust decisions, and failure paths.

## Commit 訊息規範

所有 commit 都必須使用繁體中文描述異動，並採用以下結構：

```text
<type>(<scope>): <subject>

<body>

<footer>
```

這項規範參考 [Git Commit Message 這樣寫會更好](https://ithelp.ithome.com.tw/articles/10228738)。其中 `type` 使用固定的英文識別字，讓自動化工具可以解析；`subject`、`body` 與一般說明使用繁體中文。

### Header

- `type` 為必要欄位，只能使用下列類別：
  - `feat`：新增或修改功能。
  - `fix`：修正錯誤。
  - `docs`：文件異動。
  - `style`：不影響程式行為的格式調整。
  - `refactor`：不屬於功能或錯誤修正的重構。
  - `perf`：效能改善。
  - `test`：新增或調整測試。
  - `chore`：建置流程、工具或其他維護工作。
  - `revert`：撤銷先前的 commit。
- `scope` 為選填欄位，用來指出影響範圍，例如 `ui`、`tauri`、`storage`、`ci` 或 `docs`。
- `subject` 為必要欄位，使用繁體中文簡述異動，不超過 50 個字元，結尾不加句號。

### Body

- Header 後空一行再開始 Body。
- 說明「為什麼要改」以及「改了什麼」，不要只列出檔名。
- 需要詳細說明時，可使用「問題」、「原因」與「調整項目」分段。
- 每行以不超過 72 個字元為原則。

### Footer

- 有對應任務時，填寫 `issue #123` 或其他可追蹤的編號。
- 不相容變更以 `BREAKING CHANGE:` 開頭，並以繁體中文說明影響、原因與遷移方式。

### 範例

```text
feat(連線): 新增 SSH 連線設定驗證

調整原因：
避免無效的主機名稱或連接埠進入連線引擎。

調整項目：
1. 驗證主機名稱與連接埠範圍。
2. 補上錯誤狀態與測試案例。

issue #123
```

每個 commit 應只處理一個有意義的異動單位，讓訊息能準確對應程式碼變更。

## Local checks

Run these checks before opening a pull request:

```sh
npm ci
npm run check
npm run build:sidecars
cargo test --manifest-path crates/lattice-remote/Cargo.toml --features agent
cargo test --manifest-path crates/lattice-rdp/Cargo.toml
cargo test --manifest-path crates/lattice-vnc/Cargo.toml
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
