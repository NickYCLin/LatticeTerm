# LatticeTerm

LatticeTerm 是一套現代、安全且跨平台的終端與遠端連線工作空間，用來統一管理本機 AI CLI、SSH、SFTP、RDP 與 VNC 連線，以 Tauri 2、Rust、React 與 TypeScript 建構。

> [!NOTE]
> LatticeTerm 目前處於開發初期階段，已提供 AI Agent Fleet、語意狀態 Reporter、SSH、SFTP、SSH Tunnel、Lattice Remote、Web RDP、主機信任與作業系統認證儲存；背景 Agent daemon、VNC、Relay 與 NAT 穿透等功能正依開發藍圖陸續接入。

## 主要特色

- **現代化桌面工作空間**：整合全域導覽列、資源側欄、工作區與即時狀態列。
- **安全的連線管理**：連線設定檔不含密碼與私鑰；SSH/SFTP/RDP 驗證成功後可由使用者選擇保存密碼，交給 Windows Credential Manager、macOS Keychain 或 Linux Secret Service 隔離保管。
- **真實主機信任管理**：Key Vault 直接讀寫桌面核心的 `known_hosts.json`，可搜尋、複製、新增及移除已驗證的 SHA-256 指紋。
- **非機密設定安全匯出與匯入**：支援以標準 JSON 格式安全備份與移轉連線清單，自動過濾任何機密資訊。
- **強大的組織與檢索**：支援全域關鍵字搜尋、多層群組、環境標籤（Production / Staging / Development）與常用釘選。
- **鍵盤優先與命令面板**：內建全功能命令面板（`Ctrl` + `K`），支援各項快捷操作與頁面切換。
- **多語系介面**：預設繁體中文，可即時切換英文；所有文案集中於語系檔，缺翻譯會在編譯時就被擋下。
- **六種主題**：深色、淺色、午夜藍、石墨黑、暖砂與高對比，另可跟隨系統；切換時原生標題列會一起換色。
- **主機資源檢視**：活躍 SSH 工作階段可定期讀取 Linux 主機的 CPU、記憶體、磁碟與開機時間；未連線或不支援的平台會明確說明，不顯示假數值。
- **本機持久化**：連線設定會存在本機的應用程式資料目錄，關閉再開仍在；檔案只含主機資訊，不含任何認證資料。
- **AI Agent Fleet**：以原生 PTY 同時執行 Codex、Claude Code、Gemini CLI、OpenCode、Hermes 等本機 LLM CLI，也可安全指定自訂可執行檔與參數；通用 Reporter 讓工具 hook 明確回報狀態，並可在二次確認後將同一段提示送給多個已選 Agent。內建 Adapter 可用各 CLI 的原生格式續接 Codex、Claude Code、Gemini CLI 與 Hermes Session；是否把識別值存入可命名、排序的啟動工作區，完全由使用者分開決定。登入資料仍由各 CLI 自行管理。
- **SSH 連線**：以純 Rust 的 russh 實作，可使用密碼或本機 OpenSSH 私鑰建立終端機工作階段。主機金鑰未經確認不會連線，金鑰變更會直接擋下；密碼預設只用於當次連線，使用者可在驗證成功後明確保存到系統認證儲存區，私鑰內容與密語不會保存至連線設定。
- **SSH Tunnel**：可建立本機、遠端與 SOCKS5 動態轉送，顯示即時狀態與連線數；動態代理若未設定驗證只允許綁定 loopback，遠端轉送則依 SSH 伺服器的 GatewayPorts 政策生效。
- **SFTP 檔案工作區**：沿用 SSH 主機指紋驗證與獨立的系統認證項目，可瀏覽遠端路徑、上下載、新增資料夾、重新命名及確認刪除。單次傳輸限制為 32 MiB，避免大型內容耗盡 WebView／IPC 記憶體。
- **Lattice Remote（唯讀 v1）**：桌面版內建「分享這台裝置」，由使用者明確啟動自建 Agent 擷取完整主螢幕，以 Noise XXpsk3 與一次性八位數配對碼建立端對端加密直連；目前不注入鍵盤或滑鼠。
- **Web RDP Canvas**：IronRDP 原生 engine 以 TLS/NLA 連到 Windows，畫面繪入內嵌 Canvas，並支援滑鼠、滾輪與鍵盤。密碼只經本機 stdin 傳給隔離 engine，也可在成功驗證後安全保存。
- **使用者控制的截圖與錄影**：Lattice Remote 與 Web RDP 都可手動擷取 PNG，或開始、停止並下載遠端 Canvas 錄影；不會自動錄製或上傳。
- **跨平台支援**：支援 Windows、Linux 與 macOS。

## 📥 下載與安裝 (Downloads)

你可以直接前往 [GitHub Releases](https://github.com/NickYCLin/LatticeTerm/releases) 取得最新發行版本的安裝檔與執行檔：

| 平台 | 安裝包格式 | 系統支援 |
|---|---|---|
| **Windows** | `.msi` / `.exe` (NSIS) | Windows 10 / 11 (x64) |
| **Linux** | `.deb` / `.AppImage` | Ubuntu、Debian 及通用 Linux 發行版 (x64 / arm64) |
| **macOS** | `.dmg` / `.app` | macOS 12+ (Apple Silicon) |

> [!TIP]
> 歡迎至 [Releases 列表](https://github.com/NickYCLin/LatticeTerm/releases) 下載對應平台的安裝檔或檢視各版本更新說明。
> 維護者可參考 [Release 自動化與版本規則](docs/RELEASE_AUTOMATION.zh-TW.md)；版本會由 Conventional Commits 自動計算，合併 Release PR 後才正式發布。

## 誠實呈現的介面原則

介面必須讓使用者一眼分辨「已經可用」與「還在開發」：

- 尚未實作的功能標示為「即將推出」，不使用看起來可按、實際上停用的假按鈕。
- AI Agent Fleet、SSH、SFTP、Lattice Remote 與 Web RDP 會啟動真正的工作階段；Agent Fleet 可保存安全啟動工作區，但不會假裝舊程序或終端內容可跨重啟存活。背景 Agent daemon、原工作階段重新 attach 與 VNC 仍明確標示開發狀態。
- 主機資源分頁在監控資料尚未接入前直接說明原因，不顯示假的 CPU 或記憶體數字。
- SSH/SFTP/RDP 密碼永遠不寫入連線設定檔；預設只供當次驗證，勾選後也只有驗證成功才會寫入作業系統認證儲存區。
- Key Vault 的主機信任與認證分頁都顯示真正的本機狀態；認證分頁只列連線參照，不顯示密碼內容。
- 狀態列由 Rust 核心回報認證儲存區的真實可用狀態，不用固定文案假裝就緒。

## 開發藍圖

1. 以純 Rust 的 SSH 實作（russh）建立終端機工作階段（已可用，持續強化）
2. 嚴格驗證並管理 known_hosts、以作業系統金鑰鏈保存 SSH/SFTP/RDP 密碼、SSH 私鑰認證（已可用）；Stronghold 保管庫仍待完成
3. Lattice Remote 唯讀加密主螢幕與內嵌主機分享（已可用，後續增加 Relay/NAT 穿透、無人值守與顯式授權的輸入控制）
4. 內嵌 Web RDP Canvas（已可用，持續強化封裝與憑證管理）
5. SFTP 檔案瀏覽與安全傳輸、SSH Tunnel 本機／遠端轉送與 SOCKS5 代理設定（可用）、大型檔案串流佇列（可用）；VNC 仍待完成
6. AI Agent Fleet 本機多 CLI PTY、安全語意 Reporter、批次提示、四種 CLI 原生 Session 續接與可命名排序的跨重啟安全啟動工作區（已可用）；自動 Session ID 擷取、工具 hook、背景 daemon、原程序重新 attach、依賴／佇列編排與遠端 attach 仍待完成
7. 跨平台安裝檔打包、自動版號 Release PR、簽章更新包與自動更新機制（已可用；作業系統發行者簽章仍待憑證）
8. Android 與 iOS 版本（遠端連線核心可沿用；本機 CLI Fleet 為桌面功能）

## 鍵盤快捷鍵

| 快捷鍵 | 動作 |
| --- | --- |
| `Ctrl` + `K` | 開啟或關閉命令面板 |
| `Ctrl` + `B` | 顯示或隱藏資源側欄 |
| `/` | 聚焦側欄搜尋欄位 |
| `N` | 新增連線 |
| `Esc` | 關閉命令面板、抽屜或對話框 |
| `↑` `↓` `Enter` | 在命令面板中移動與執行指令 |

## 本地開發

### 環境需求

- Node.js (>= 22.12) 與 npm
- Rust stable 與 Cargo
- [Tauri 官方前置需求](https://v2.tauri.app/start/prerequisites/)

### 執行網頁預覽

```sh
npm install
npm run dev
```

### 執行桌面應用程式

```sh
npm install
npm run tauri dev
```

### 執行 Lattice Remote Agent

桌面版可直接按「分享這台裝置」，選擇明確的介面 IP、連接埠與更新率，再自行決定是否讓分享留在背景。若要獨立執行 CLI，預設只監聽 loopback；從同一個區網連入時，必須明確指定該機器的 LAN 位址：

```sh
cargo run --manifest-path crates/lattice-remote/Cargo.toml --features agent --bin lattice-agent -- --bind 192.168.1.20:44900
```

Agent 顯示的八位數配對碼五分鐘後失效，連續五次失敗就會停止；一次成功工作階段結束後程序也會退出。內嵌模式配對成功後會立即從介面清除配對碼，使用者可隨時停止分享。v1 僅傳畫面，不接受遠端輸入。

### 執行 AI Agent Fleet

Agent Fleet 只在 Tauri 桌面版啟動本機 CLI；網頁預覽會誠實顯示後端不可用。開啟側邊導覽的「AI Agent Fleet」，選擇工作目錄後即可啟動已偵測到的 CLI，或以「每行一個參數」加入自訂工具。批次提示必須先勾選執行中的目標並再次確認，LatticeTerm 不保存提示內容。

「原生 Session 續接」目前支援 Codex、Claude Code、Gemini CLI 與 Hermes Agent。選擇 CLI、貼上該工具提供的 Session ID 或標題後，可直接續接而不保存；只有另外按下「保存續接項目」，識別值才會寫入 `agent-workspaces.json`。參數由版本化內建 Adapter 直接建立，不經 shell，也不能與額外啟動參數混用。這是 CLI 自身的歷史還原，不代表舊 PTY、程序或終端畫面仍存活。

「保存啟動項目」會記錄 CLI 類型、標籤、可執行檔、明確參數與工作目錄，最多 32 個；工作區名稱與項目順序也會保存。原生 Session ID 或標題只會隨使用者明確保存的續接項目寫入。密碼、Token、API Key、Passphrase、Secret 參數、提示、輸出與 Reporter 權杖都不會保存。下次開啟應用程式時，使用者可逐項或依保存順序整批確認並建立新的 CLI 程序；已保存原生識別值的項目會請 CLI 續接既有脈絡，但舊程序與終端畫面不會被假裝還原。工作階段本身仍只存於記憶體，停止或關閉應用程式會終止 CLI。

每個 CLI 都會收到本機 Reporter 環境變數。工具 hook 可執行 `"$LATTICETERM_AGENT_REPORTER" agent-report done`，並以 `working`、`needs-attention`、`idle` 或 `done` 回報狀態；Windows PowerShell 使用 `& $env:LATTICETERM_AGENT_REPORTER agent-report done`。Reporter 只接受該工作階段的隨機權杖，且只能更新狀態。完整協定與安全邊界請見架構文件。

Herdr 類型的背景服務、完整工具語意 Adapter、原程序重新 attach 與自建遠端 attach 規劃，請見 [AI Agent Fleet 架構與整合藍圖](docs/AGENT_FLEET_ARCHITECTURE.zh-TW.md)。

### 專案驗證

```sh
npm run check
npm run build:sidecars
cargo test --manifest-path crates/lattice-remote/Cargo.toml --features agent
cargo test --manifest-path crates/lattice-rdp/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

## 安全性

請勿將密碼、私鑰、憑證權杖或正式環境的主機資訊提交至原始碼、Issue 或螢幕截圖中。安全性通報請見 [SECURITY.md](SECURITY.md)。

## 參與貢獻

歡迎參與貢獻！開發與審查規範請見 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 授權條款

原始碼採用 [Mozilla Public License 2.0](LICENSE) 授權。商標與名稱規範請見 [TRADEMARKS.md](TRADEMARKS.md)。
