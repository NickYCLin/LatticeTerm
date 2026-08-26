# LatticeTerm 程式碼與文件導覽

這份索引讓第一次進入專案的工程師或程式型 Agent，能先找到真正負責功能的入口，不必只靠全文猜測。

## 從需求找程式碼

| 想了解或修改的範圍 | 前端入口 | Rust／協定入口 | 延伸文件 |
| --- | --- | --- | --- |
| 應用程式導覽、頁面切換與全域狀態 | `src/App.tsx`、`src/views/` | `src-tauri/src/lib.rs` | [介面實作現況](UI_IMPLEMENTATION.zh-TW.md) |
| 本機 AI CLI、Agent Fleet、PTY 與狀態回報 | `src/views/AgentsView.tsx`、`src/app/useAgentSessions.ts`、`src/components/agents/` | `src-tauri/src/agent.rs`、`src-tauri/src/agent_plans.rs` | [Agent Fleet 架構](AGENT_FLEET_ARCHITECTURE.zh-TW.md) |
| 工作階段、專案與自訂資料夾 | `src/views/SessionsView.tsx`、`src/components/sessions/`、`src/app/sessionSidebarLayout.ts` | 各工作階段後端模組 | [介面設計摘要](UI_UX_DESIGN_BRIEF.zh-TW.md) |
| SSH 終端、SFTP 與 Tunnel | `src/components/terminal/`、`src/components/sftp/`、`src/views/TunnelsView.tsx` | `src-tauri/src/ssh.rs`、`sftp.rs`、`sftp_transfers.rs`、`tunnel.rs` | [儲存與安全決策](STORAGE_SECURITY_DECISION.zh-TW.md) |
| Lattice Remote 畫面、控制與檔案傳輸 | `src/components/remote/` | `src-tauri/src/remote.rs`、`remote_files.rs`、`crates/lattice-remote/` | [介面實作現況](UI_IMPLEMENTATION.zh-TW.md) |
| RDP 與 VNC | `src/components/rdp/`、`src/components/vnc/` | `src-tauri/src/rdp.rs`、`vnc.rs`、`crates/lattice-rdp/`、`crates/lattice-vnc/` | [介面實作現況](UI_IMPLEMENTATION.zh-TW.md) |
| 保管庫、認證資料、備份與本機儲存 | `src/components/vault/`、`src/components/settings/` | `src-tauri/src/vault.rs`、`backup.rs`、`storage.rs` | [儲存與安全決策](STORAGE_SECURITY_DECISION.zh-TW.md) |
| 自動更新、版本與發行檔 | `src/app/useAppUpdater.ts`、`src/app/version.ts`、`src/views/SettingsView.tsx` | `src-tauri/tauri.conf.json`、`.github/workflows/release.yml` | [Release 自動化](RELEASE_AUTOMATION.zh-TW.md)、[更新紀錄](../CHANGELOG.md) |

## 技術輪廓

- 桌面殼層：Tauri 2。
- 前端：React、TypeScript、Vite、xterm.js。
- 原生後端：Rust；桌面命令集中在 `src-tauri/src/`。
- 獨立引擎：`crates/lattice-remote`、`crates/lattice-rdp`、`crates/lattice-vnc`。
- 測試：Vitest 與 Rust `cargo test`；完整指令列在根目錄 [README](../README.md#專案驗證)。

## 專案邊界

- LatticeTerm 會啟動本機 AI CLI，但不接管它們的 API key、登入 token 或雲端帳號。
- SSH、SFTP、RDP、VNC 與 Lattice Remote 都是真實工作階段，不以假資料模擬已完成能力。
- Lattice Remote 目前是輸入主機端點的一次性加密直連；數字裝置 ID、Signal／Relay 與 NAT 穿透仍是後續階段。
- 桌面版是主要完成範圍；需要 sidecar 或本機 PTY 的功能不會假裝可在瀏覽器或 Android 使用。

安全問題請依 [SECURITY.md](../SECURITY.md) 私下回報；一般修改流程與提交規則請見 [CONTRIBUTING.md](../CONTRIBUTING.md)。
