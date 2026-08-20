# Release 自動化與版本規則

LatticeTerm 使用 Release Please、Conventional Commits 與 Tauri Action 管理版本。系統會自動計算下一個版本並維護 Release PR，但**合併 Release PR 才會正式發布**，因此版本判定可被檢視，發布時機也保留人工閘門。

## 版本如何判定

從上一個 Git tag 起，Release Please 依提交類型套用 SemVer：

| 最高影響提交 | 版本變化 | 範例 |
| --- | --- | --- |
| `feat:` | minor | `0.2.0` → `0.3.0` |
| `fix:`、`perf:` | patch | `0.3.0` → `0.3.1` |
| 類型後加 `!`，或內文含 `BREAKING CHANGE:` | major | `0.3.1` → `1.0.0` |
| 只有 `docs:`、`test:`、`ci:`、`chore:`、`style:`、`refactor:`、`build:` | 不版更 | 等待下一個可發布變更 |

提交標題必須符合 Conventional Commits，且專案提交說明使用繁體中文，例如：

```text
feat(遠端): 加入 Relay 連線模式
fix(RDP): 修正高 DPI 游標座標
feat(設定)!: 調整連線設定格式
```

PR 的 CI 會驗證每一筆非合併提交的格式。若需明確指定下一版，可在提交內文使用 `Release-As: 0.4.0`；這是例外操作，提交內容必須說明原因。

## 自動發布流程

1. 功能 PR 通過 CI 並合併到 `main`。
2. `Release` workflow 讀取自 `v0.2.0` 或上一個 Release 起的提交。
3. 若有可發布變更，自動建立或更新一個 draft Release PR，內容包含新版本、`CHANGELOG.md` 與所有版本檔差異。
4. workflow 另外以 `workflow_dispatch` 對 Release PR 分支觸發四平台 CI，避免 `GITHUB_TOKEN` 建立的 PR 無法自動連鎖觸發檢查。
5. 檢視版本與 changelog，將 Release PR 標示為 ready 並合併。
6. 下一次 `Release` workflow 建立 `vX.Y.Z` tag 與 GitHub Release。
7. Linux amd64、Linux arm64、Windows amd64、macOS arm64 原生 runner 建置安裝檔，上傳更新簽章與 `latest.json`。

Release PR 是唯一正式發布閘門。一般功能 PR 不應手動修改版本、建立 tag，或直接建立同版本 Release。

## 同步的版本來源

Release PR 會一起更新：

- `package.json`
- `package-lock.json` 的根版本與 workspace 根版本
- `.release-please-manifest.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock` 中的 `lattice-term` 套件版本

`npm run version:check` 會比對上述七個值，`npm run check` 與 CI 都會執行它。任何來源漂移都會在合併或發布前失敗。
由於 Cargo 會移除 lockfile 內的自訂註記，Release workflow 會先執行 `npm run version:sync-lock`，只同步 `lattice-term` package block，再以繁中 bot commit 寫回 Release PR。

## 簽章與失敗處理

- GitHub Actions 必須保存 `TAURI_SIGNING_PRIVATE_KEY` 與 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。缺少私鑰時發布會直接失敗，避免產生客戶端拒絕的未簽章更新包。
- Tauri updater 簽章用來驗證更新內容，與 Windows Authenticode 或 Apple Developer ID／notarization 是不同層次。目前自動化保證 updater 簽章；正式對外散佈前仍應補齊各作業系統的發行者憑證。
- 某個平台失敗時，在 GitHub Actions 重新執行失敗的 job；Tauri Action 會尋找既有 tag 的 Release 並補上資產，不需再建同版本 tag。
- `workflow_dispatch` 可重新整理 Release PR；若沒有可發布提交，它不會憑空增加版本。

## 維護規則

- 小項目也要在相稱驗證後提交並推送。
- 所有提交使用繁體中文 Conventional Commit。
- PR 通過必要檢查並完成審查後合併到 `main`。
- 合併後刪除已整合的功能分支；不可讓長期分支成為另一條發布來源。
