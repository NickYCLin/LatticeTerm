# LatticeTerm

LatticeTerm 是一套現代、安全且跨平台的終端與遠端連線工作空間，用來統一管理本機 AI CLI、SSH、SFTP、RDP 與 VNC 連線，以 Tauri 2、Rust、React 與 TypeScript 建構。

> [!NOTE]
> LatticeTerm 目前處於 **公開測試與功能成熟化階段**。桌面端的連線管理、SSH／SFTP／Tunnel、Web RDP、VNC、本機 AI Agent Fleet、安全保管庫、備份、跨平台安裝檔與自動更新已可實際使用；背景 Agent daemon、遠端 Fleet、Relay／NAT 穿透與 iOS 等進階能力仍依後續藍圖開發。

## 完成度總覽

| 範圍 | 狀態 | 現況與邊界 |
| --- | --- | --- |
| 桌面連線工作區 | **可用** | Windows、Linux 與 macOS 支援 SSH、SFTP、SSH Tunnel、Web RDP、VNC、主機資源與工作階段管理。 |
| 安全與資料保護 | **可用** | 嚴格主機信任、作業系統認證儲存、主密碼加密保管庫、敏感剪貼簿與加密備份均已接入真實後端。 |
| 本機 AI Agent Fleet | **可用** | 多 CLI PTY、Reporter、批次提示、原生 Session 續接、安全啟動工作區與同程序重新 attach 已完成。 |
| Lattice Remote | **基礎功能可用** | 已完成使用者主動啟動、一次性配對、端對端加密與唯讀主螢幕直連；Relay、NAT 穿透、無人值守及遠端輸入尚未加入。 |
| 發行與更新 | **可用** | Windows x64、Linux x64／arm64、macOS Apple Silicon 安裝檔、更新簽章、Release PR 與應用程式內更新已自動化。 |
| Android | **預覽** | 共用的純 Rust SSH／SFTP／Tunnel／Vault 核心與行動介面可建置；需要桌面 sidecar 的 RDP、VNC 與 Agent Fleet 不提供。 |
| 進階 Agent 與行動能力 | **規劃中** | 跨程序 daemon、遠端 Fleet、任務編排、每 Agent 沙箱、Windows npm shim 與 iOS 尚未完成。 |

## 主要特色

- **現代化桌面工作空間**：整合全域導覽列、資源側欄、工作區與即時狀態列。
- **安全的連線管理**：連線設定檔不含密碼與私鑰；SSH/SFTP/RDP/VNC 驗證成功後可由使用者選擇保存密碼，交給 Windows Credential Manager、macOS Keychain、Linux Secret Service，或以主密碼保護的本機加密保管庫隔離保存。保管庫預設閒置 15 分鐘或視窗進入背景時自動鎖定，也可由使用者調整策略。
- **敏感剪貼簿保護**：Lattice Remote 一次性配對碼預設在複製 30 秒後清除，可調整為 15／60／120 秒或關閉；清除前會比對內容，使用者後來複製的文字不會被覆蓋，亦可從設定立即清除。
- **真實主機信任管理**：Key Vault 直接讀寫桌面核心的 `known_hosts.json`，可搜尋、複製、新增及移除已驗證的 SHA-256 指紋。
- **分層備份與移轉**：連線清單可用標準 JSON 安全匯出並自動過濾機密；完整本機工作區則可匯出成密碼保護的 `.latticeterm-backup`，以 Argon2id 與 XChaCha20-Poly1305 加密後再交給介面下載，還原前會完整驗證並可失敗回滾。
- **強大的組織與檢索**：支援全域關鍵字搜尋、多層群組、環境標籤（Production / Staging / Development）與常用釘選。
- **鍵盤優先與命令面板**：內建全功能命令面板（`Ctrl` + `K`），支援各項快捷操作與頁面切換。
- **多語系介面**：預設繁體中文，可即時切換英文；所有文案集中於語系檔，缺翻譯會在編譯時就被擋下。
- **六種主題**：深色、淺色、午夜藍、石墨黑、暖砂與高對比，另可跟隨系統；切換時原生標題列會一起換色。
- **主機資源檢視**：活躍 SSH 工作階段可定期讀取 Linux 主機的 CPU、記憶體、磁碟與開機時間；未連線或不支援的平台會明確說明，不顯示假數值。
- **本機持久化**：連線設定會存在本機的應用程式資料目錄，關閉再開仍在；檔案只含主機資訊，不含任何認證資料。
- **AI Agent Fleet**：以原生 PTY 同時執行 Codex、Claude Code、Gemini CLI、OpenCode、Hermes 等本機 LLM CLI，也可安全指定自訂可執行檔與參數；通用 Reporter 讓工具 hook 明確回報狀態，並可在二次確認後將同一段提示送給多個已選 Agent。內建 Adapter 可用各 CLI 的原生格式續接 Codex、Claude Code、Gemini CLI 與 Hermes Session；是否把識別值存入可命名、排序的啟動工作區，完全由使用者分開決定。同一桌面程序內若 WebView 重新載入，活躍 PTY 會重新 attach 並重播最近 256 KiB 記憶體輸出。登入資料仍由各 CLI 自行管理。
- **SSH 連線**：以純 Rust 的 russh 實作，可使用密碼或本機 OpenSSH 私鑰建立終端機工作階段。主機金鑰未經確認不會連線，金鑰變更會直接擋下；密碼預設只用於當次連線，使用者可在驗證成功後明確保存到系統認證儲存區，私鑰內容與密語不會保存至連線設定。
- **SSH Tunnel**：可建立本機、遠端與 SOCKS5 動態轉送，顯示即時狀態與連線數；動態代理若未設定驗證只允許綁定 loopback，遠端轉送則依 SSH 伺服器的 GatewayPorts 政策生效。
- **SFTP 檔案工作區**：沿用 SSH 主機指紋驗證與獨立的認證項目，可瀏覽遠端路徑、上下載、新增資料夾、重新命名及確認刪除；大型檔案經有界分塊與原生串流佇列傳輸，不把整個檔案塞進 WebView／IPC 記憶體。上傳先寫入同目錄的私有暫存檔，只有位元組數完整且關檔成功才替換目標，取消、失敗或中斷連線不會把既有檔案變成半成品。
- **Lattice Remote（唯讀 v1）**：桌面版內建「分享這台裝置」，由使用者明確啟動自建 Agent 擷取完整主螢幕，以 Noise XXpsk3 與一次性八位數配對碼建立端對端加密直連；協定在畫面進入 WebView 前限制編碼大小、邊長與總像素，避免異常 Agent 迫使 Canvas 配置無界資源；目前不注入鍵盤或滑鼠。
- **Web RDP Canvas**：IronRDP 原生 engine 以 TLS/NLA 連到 Windows，畫面繪入內嵌 Canvas，並支援滑鼠、滾輪與鍵盤。密碼只經本機 stdin 傳給隔離 engine，也可在成功驗證後安全保存。
- **使用者控制的截圖與錄影**：Lattice Remote、Web RDP 與 VNC 都可手動擷取 PNG，或開始、停止並下載遠端 Canvas 錄影；不會自動錄製或上傳。
- **跨平台支援**：桌面版支援 Windows、Linux 與 macOS；Android 版已可建置執行共用的純 Rust 核心功能，需本機程序的 RDP／VNC／CLI Fleet 維持桌面限定。

## 📥 下載與安裝 (Downloads)

你可以直接前往 [GitHub Releases](https://github.com/NickYCLin/lattice-term/releases) 取得最新發行版本的安裝檔與執行檔：

| 平台 | 安裝包格式 | 系統支援 |
|---|---|---|
| **Windows** | `.exe` (NSIS) | Windows 10 / 11 (x64) |
| **Linux** | `.deb` / `.AppImage` | Ubuntu、Debian 及通用 Linux 發行版 (x64 / arm64) |
| **macOS** | `.dmg` / `.app` | macOS 12+ (Apple Silicon) |

> [!TIP]
> 歡迎至 [Releases 列表](https://github.com/NickYCLin/lattice-term/releases) 下載對應平台的安裝檔或檢視各版本更新說明。
> 維護者可參考 [Release 自動化與版本規則](docs/RELEASE_AUTOMATION.zh-TW.md)；版本會由 Conventional Commits 自動計算，合併 Release PR 後才正式發布。

## 誠實呈現的介面原則

介面必須讓使用者一眼分辨「已經可用」與「還在開發」：

- 尚未實作的功能標示為「即將推出」，不使用看起來可按、實際上停用的假按鈕。
- AI Agent Fleet、SSH、SFTP、Lattice Remote、Web RDP 與 VNC 會啟動真正的工作階段；Agent Fleet 可在同一桌面程序內重新 attach 活躍 PTY，但不會假裝舊程序或終端內容可跨應用程式重啟存活。跨程序背景 daemon 與重新 attach 仍明確標示開發狀態。
- 主機資源分頁只顯示活躍 SSH 工作階段取得的真實 Linux 指標；尚未連線或不支援的平台會直接說明原因，不顯示假的 CPU 或記憶體數字。
- SSH/SFTP/RDP/VNC 密碼永遠不寫入連線設定檔；預設只供當次驗證，勾選後也只有驗證成功才會寫入使用者選擇的作業系統認證儲存區或已解鎖加密保管庫。
- Key Vault 的主機信任、認證與加密保管庫分頁都顯示真正的本機狀態；認證分頁只列連線參照，不顯示密碼內容。
- 加密保管庫解鎖後由全域閒置計時器保護；鍵盤、滑鼠與觸控活動會重設期限，視窗進入背景可立即清除記憶體中的解密金鑰，且不會中斷既有連線。
- Lattice Remote 配對碼使用受限的敏感剪貼簿流程；正式應用程式的 WebView 不能任意讀取剪貼簿，只能要求原生層複製或清除本程式最後追蹤且內容仍相符的敏感值。
- 狀態列由 Rust 核心回報認證儲存區的真實可用狀態，不用固定文案假裝就緒。

## 後續開發重點

1. **Lattice Remote 連線範圍**：加入自建 Relay、NAT 穿透、裝置身分與重放防護，再分階段提供無人值守及由被控端明確授權的鍵盤／滑鼠輸入。
2. **Agent 常駐與遠端能力**：把 PTY owner 抽成使用者自行啟動的背景 daemon，支援跨程序重新 attach，並先以 SSH transport 實作遠端 Agent Fleet。
3. **Agent 編排與隔離**：補齊工具 hook、token／cost 可觀測事件、依賴圖、佇列、排程、資源限制與每 Agent 沙箱／檔案範圍策略。
4. **平台完整度**：設計安全的 Windows npm shim adapter、持續強化 Android 發行流程，並在 macOS／Xcode 環境啟動 iOS 建置與驗證。
5. **正式發行信任**：自動更新包已有 Tauri 簽章；Windows Authenticode 與 Apple Developer ID／notarization 仍需發行者憑證。

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

Agent 顯示的八位數配對碼五分鐘後失效，連續五次失敗就會停止；一次成功工作階段結束後程序也會退出。內嵌模式配對成功後會立即從介面清除配對碼；複製配對碼時預設 30 秒後清除剪貼簿，若內容已被其他複製操作取代則保留，使用者也可調整期限或停用。使用者可隨時停止分享。v1 僅傳畫面，不接受遠端輸入。

### 執行 AI Agent Fleet

Agent Fleet 只在 Tauri 桌面版啟動本機 CLI；網頁預覽會誠實顯示後端不可用。開啟側邊導覽的「AI Agent Fleet」，選擇工作目錄後即可啟動已偵測到的 CLI，或以「每行一個參數」加入自訂工具。批次提示必須先勾選執行中的目標並再次確認，LatticeTerm 不保存提示內容。

「原生 Session 續接」目前支援 Codex、Claude Code、Gemini CLI 與 Hermes Agent。選擇 CLI、貼上該工具提供的 Session ID 或標題後，可直接續接而不保存；只有另外按下「保存續接項目」，識別值才會寫入 `agent-workspaces.json`。參數由版本化內建 Adapter 直接建立，不經 shell，也不能與額外啟動參數混用。這是 CLI 自身的歷史還原，不代表舊 PTY、程序或終端畫面仍存活。

「保存啟動項目」會記錄 CLI 類型、標籤、可執行檔、明確參數與工作目錄，最多 32 個；工作區名稱與項目順序也會保存。原生 Session ID 或標題只會隨使用者明確保存的續接項目寫入。密碼、Token、API Key、Passphrase、Secret 參數、提示、輸出與 Reporter 權杖都不會寫入工作區或磁碟。下次開啟應用程式時，使用者可逐項或依保存順序整批確認並建立新的 CLI 程序；已保存原生識別值的項目會請 CLI 續接既有脈絡，但舊程序與終端畫面不會被假裝還原。工作階段本身仍只存於記憶體；Rust 核心會為每個活躍 PTY 保留最近 256 KiB 輸出，讓同一桌面程序內的 WebView 重新載入後安全重新 attach，不會寫入磁碟。停止工作階段或關閉應用程式仍會終止 CLI。

每個 CLI 都會收到本機 Reporter 環境變數。工具 hook 可執行 `"$LATTICETERM_AGENT_REPORTER" agent-report done`，並以 `working`、`needs-attention`、`idle` 或 `done` 回報狀態；Windows PowerShell 使用 `& $env:LATTICETERM_AGENT_REPORTER agent-report done`。Reporter 只接受該工作階段的隨機權杖，且只能更新狀態。完整協定與安全邊界請見架構文件。

Herdr 類型的背景服務、完整工具語意 Adapter、跨程序原 PTY 重新 attach 與自建遠端 attach 規劃，請見 [AI Agent Fleet 架構與整合藍圖](docs/AGENT_FLEET_ARCHITECTURE.zh-TW.md)。

### 專案驗證

```sh
npm run check
npm run build:sidecars
cargo test --manifest-path crates/lattice-remote/Cargo.toml --features agent
cargo test --manifest-path crates/lattice-rdp/Cargo.toml
cargo test --manifest-path crates/lattice-vnc/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

## 安全性

完整加密備份包含連線設定、主機信任、Agent 工作區、通道與介面偏好，以及已經加密的本機保管庫；不包含作業系統認證儲存區中的密碼、外部 SSH 私鑰、工作階段輸出、截圖或錄影。匯出與還原時保管庫必須鎖定，還原時所有 SSH 通道也必須停止。

請勿將密碼、私鑰、憑證權杖或正式環境的主機資訊提交至原始碼、Issue 或螢幕截圖中。安全性通報請見 [SECURITY.md](SECURITY.md)。

## 參與貢獻

歡迎參與貢獻！開發與審查規範請見 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 授權條款

原始碼採用 [Mozilla Public License 2.0](LICENSE) 授權。商標與名稱規範請見 [TRADEMARKS.md](TRADEMARKS.md)。
