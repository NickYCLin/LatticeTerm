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

## 文件與專案描述維護

程式碼與文件要一起動。**任何影響使用者能力邊界的異動**（新增／移除功能、改變安全邊界、改變支援平台或協定），在同一個 PR 內就要把下列對應處一起更新；只改行為不改文件的 PR 會被退回。

### 一句話專案描述（單一事實來源）

專案的一句話描述有多份副本，必須**逐字一致**。改動產品範圍時要同步更新全部：

| 位置 | 用途 |
|---|---|
| `package.json` 的 `description` | npm／前端工具鏈 |
| `src-tauri/Cargo.toml` 的 `description` | 應用程式後端 crate |
| `crates/*/Cargo.toml` 的 `description` | 各 sidecar crate（範圍相符即可，不必逐字） |
| `src-tauri/tauri.conf.json` 的產品資訊 | 打包後的安裝檔中繼資料 |
| GitHub repo 描述（`gh repo edit --description "…"`） | 專案首頁與搜尋結果，用繁體中文 |

規則：先改 `package.json`／`Cargo.toml` 的英文正式描述，再把 GitHub 的繁中描述改成同一個意思。四份 manifest 的英文描述要一字不差；GitHub 繁中版可換句話說但語意須相符。

### README

`README.md` 有三個地方描述能力，改功能時三者要一起動：

1. **狀態表**：更新對應列的狀態（可用／基礎功能可用／規劃中）與說明。
2. **主要特色清單**：新增或修改對應的條列，並清楚區分「已實作」與「規劃中」。
3. **後續開發重點（roadmap）**：完成的項目要從規劃移到已完成，或標註已可用。

### 深入文件

`docs/` 是機制層的深入說明。改到某子系統的**運作方式**時，更新對應檔案，別讓它描述舊行為：

- `docs/UI_IMPLEMENTATION.zh-TW.md`：各面板與前後端資料流。
- `docs/AGENT_FLEET_ARCHITECTURE.zh-TW.md`：Agent Fleet、CLI 偵測與啟動、Reporter。
- `docs/STORAGE_SECURITY_DECISION.zh-TW.md`：儲存與認證安全決策。
- `docs/RELEASE_AUTOMATION.zh-TW.md`：發布與更新流程。
- `docs/UI_UX_DESIGN_BRIEF.zh-TW.md`：設計語言與視覺規範。

### 介面文字

任何使用者看得到的字串都放在語系檔，**兩個語系都要補齊**：`src/i18n/messages/zh-TW.ts`（正體，也是 `MessageKey` 的事實來源）與 `src/i18n/messages/en.ts`。缺翻譯會在編譯時就被擋下。

### CHANGELOG

`CHANGELOG.md` 由 release-please 依 commit 的 `type`／`scope` 自動產生，**請勿手改**。寫好符合規範的 commit 訊息，就等於寫好了 changelog。

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
- 依「文件與專案描述維護」同步 README、`docs/`、語系檔與（範圍有變時）一句話描述；純行為異動不得缺少對應文件更新。

By contributing, you agree that your contribution is licensed under MPL-2.0.
