# LatticeTerm

LatticeTerm 是一套現代、安全且跨平台的遠端連線工作空間，用來統一管理 SSH、SFTP、RDP 與 VNC 連線，以 Tauri 2、Rust、React 與 TypeScript 建構。

> [!NOTE]
> LatticeTerm 目前處於開發初期階段，已提供 SSH、Lattice Remote、Web RDP、主機信任與作業系統認證儲存；SFTP、Tunnel、VNC 與 Relay 等功能正依開發藍圖陸續接入。

## 主要特色

- **現代化桌面工作空間**：整合全域導覽列、資源側欄、工作區與即時狀態列。
- **安全的連線管理**：連線設定檔不含密碼與私鑰；SSH/RDP 驗證成功後可由使用者選擇保存密碼，交給 Windows Credential Manager、macOS Keychain 或 Linux Secret Service 隔離保管。
- **真實主機信任管理**：Key Vault 直接讀寫桌面核心的 `known_hosts.json`，可搜尋、複製、新增及移除已驗證的 SHA-256 指紋。
- **非機密設定安全匯出與匯入**：支援以標準 JSON 格式安全備份與移轉連線清單，自動過濾任何機密資訊。
- **強大的組織與檢索**：支援全域關鍵字搜尋、多層群組、環境標籤（Production / Staging / Development）與常用釘選。
- **鍵盤優先與命令面板**：內建全功能命令面板（`Ctrl` + `K`），支援各項快捷操作與頁面切換。
- **多語系介面**：預設繁體中文，可即時切換英文；所有文案集中於語系檔，缺翻譯會在編譯時就被擋下。
- **六種主題**：深色、淺色、午夜藍、石墨黑、暖砂與高對比，另可跟隨系統；切換時原生標題列會一起換色。
- **主機資源檢視**：連線詳細面板保留「主機狀態」分頁，用來顯示 CPU、記憶體與磁碟用量。
- **本機持久化**：連線設定會存在本機的應用程式資料目錄，關閉再開仍在；檔案只含主機資訊，不含任何認證資料。
- **SSH 連線**：以純 Rust 的 russh 實作，可建立終端機工作階段。主機金鑰未經確認不會連線，金鑰變更會直接擋下；密碼預設只用於當次連線，使用者可在驗證成功後明確保存到系統認證儲存區。
- **Lattice Remote（唯讀 v1）**：桌面版內建「分享這台裝置」，由使用者明確啟動自建 Agent 擷取完整主螢幕，以 Noise XXpsk3 與一次性八位數配對碼建立端對端加密直連；目前不注入鍵盤或滑鼠。
- **Web RDP Canvas**：IronRDP 原生 engine 以 TLS/NLA 連到 Windows，畫面繪入內嵌 Canvas，並支援滑鼠、滾輪與鍵盤。密碼只經本機 stdin 傳給隔離 engine，也可在成功驗證後安全保存。
- **使用者控制的截圖與錄影**：Lattice Remote 與 Web RDP 都可手動擷取 PNG，或開始、停止並下載遠端 Canvas 錄影；不會自動錄製或上傳。
- **跨平台支援**：支援 Windows、Linux 與 macOS。

## 📥 下載與安裝 (Downloads)

你可以直接前往 [GitHub Releases](https://github.com/NickYCLin/LatticeTerm/releases) 取得最新發行版本的安裝檔與執行檔：

| 平台 | 安裝包格式 | 系統支援 |
|---|---|---|
| **Windows** | `.msi` / `.exe` (NSIS) | Windows 10 / 11 (x64) |
| **Linux** | `.deb` / `.AppImage` | Ubuntu、Debian 及通用 Linux 發行版 (x64) |
| **macOS** | `.dmg` / `.app` | macOS 12+ (Apple Silicon 與 Intel) |

> [!TIP]
> 歡迎至 [Releases 列表](https://github.com/NickYCLin/LatticeTerm/releases) 下載對應平台的安裝檔或檢視各版本更新說明。

## 誠實呈現的介面原則

介面必須讓使用者一眼分辨「已經可用」與「還在開發」：

- 尚未實作的功能標示為「即將推出」，不使用看起來可按、實際上停用的假按鈕。
- SSH、Lattice Remote 與 Web RDP 會啟動真正的工作階段；SFTP 與 VNC 仍明確標示開發狀態。
- 主機資源分頁在監控資料尚未接入前直接說明原因，不顯示假的 CPU 或記憶體數字。
- SSH/RDP 密碼永遠不寫入連線設定檔；預設只供當次驗證，勾選後也只有驗證成功才會寫入作業系統認證儲存區。
- Key Vault 的主機信任與認證分頁都顯示真正的本機狀態；認證分頁只列連線參照，不顯示密碼內容。
- 狀態列由 Rust 核心回報認證儲存區的真實可用狀態，不用固定文案假裝就緒。

## 開發藍圖

1. 以純 Rust 的 SSH 實作（russh）建立終端機工作階段（已可用，持續強化）
2. 嚴格驗證並管理 known_hosts、以作業系統金鑰鏈保存 SSH/RDP 密碼（已可用）；SSH 私鑰與 Stronghold 保管庫仍待完成
3. Lattice Remote 唯讀加密主螢幕與內嵌主機分享（已可用，後續增加 Relay/NAT 穿透、無人值守與顯式授權的輸入控制）
4. 內嵌 Web RDP Canvas（已可用，持續強化封裝與憑證管理）
5. SFTP 檔案瀏覽、安全傳輸佇列、SSH Tunnel 與 VNC
6. 跨平台安裝檔打包與自動更新機制
7. Android 與 iOS 版本（連線核心不依賴系統 ssh 執行檔，因此可沿用）

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
