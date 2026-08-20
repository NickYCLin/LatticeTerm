# LatticeTerm

LatticeTerm 是一套現代、安全且跨平台的遠端連線工作空間，用來統一管理 SSH、SFTP、RDP 與 VNC 連線，以 Tauri 2、Rust、React 與 TypeScript 建構。

> [!NOTE]
> LatticeTerm 目前處於開發初期階段，提供連線管理、非機密設定安全匯出/匯入、搜尋分組與介面偏好設定，各遠端協定引擎正依開發藍圖陸續接入中。

## 主要特色

- **現代化桌面工作空間**：整合全域導覽列、資源側欄、工作區與即時狀態列。
- **安全的連線管理**：支援 SSH、SFTP、RDP、VNC 連線設定，介面絕不處理或儲存明文密碼與私鑰。
- **非機密設定安全匯出與匯入**：支援以標準 JSON 格式安全備份與移轉連線清單，自動過濾任何機密資訊。
- **強大的組織與檢索**：支援全域關鍵字搜尋、多層群組、環境標籤（Production / Staging / Development）與常用釘選。
- **鍵盤優先與命令面板**：內建全功能命令面板（`Ctrl` + `K`），支援各項快捷操作與頁面切換。
- **多語系介面**：預設繁體中文，可即時切換英文；所有文案集中於語系檔，缺翻譯會在編譯時就被擋下。
- **六種主題**：深色、淺色、午夜藍、石墨黑、暖砂與高對比，另可跟隨系統；切換時原生標題列會一起換色。
- **主機資源檢視**：連線詳細面板保留「主機狀態」分頁，用來顯示 CPU、記憶體與磁碟用量。
- **跨平台支援**：支援 Windows、Linux 與 macOS。

## 誠實呈現的介面原則

介面必須讓使用者一眼分辨「已經可用」與「還在開發」：

- 尚未實作的功能標示為「即將推出」，不使用看起來可按、實際上停用的假按鈕。
- 連線卡片上的「連線 · 即將推出」是狀態標示，不是按鈕，因為協定引擎還不存在。
- 主機資源分頁在未連線時直接說明「要連線成功後才有資料」，不顯示假的 CPU 或記憶體數字。
- 新增連線表單沒有任何密碼、金鑰或通行碼欄位，因為安全儲存區尚未完成。
- 狀態列持續顯示資料只存在記憶體，以及認證儲存區尚未建立。

## 開發藍圖

1. 透過系統 OpenSSH 用戶端與 PTY 建立 SSH 終端機工作階段
2. 以作業系統金鑰鏈保存機密，並嚴格驗證 `known_hosts`
3. SFTP 檔案瀏覽與安全傳輸佇列
4. SSH Tunnel 連接埠轉送與 RDP 連線啟動
5. 內嵌式 RDP 與 VNC 遠端桌面工作階段
6. 跨平台安裝檔打包與自動更新機制

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

### 專案驗證

```sh
npm run check
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
