# LatticeTerm

LatticeTerm 是一套安全、跨平台的遠端工作空間，用來管理 SSH、SFTP、RDP 與 VNC 連線，以 Tauri 2、Rust、React 與 TypeScript 建構。

> [!IMPORTANT]
> LatticeTerm 目前處於基礎建設階段。現行版本只管理不含機密的連線設定，並呈現產品介面；它**尚未**連線到任何遠端主機，也不儲存任何認證資料。

## 目前完成的基礎

- 依照設計需求書重建的桌面介面：全域導覽列、資源側欄、工作區與狀態列
- 連線設定的管理與驗證，介面上沒有任何密碼或私鑰欄位
- 搜尋、群組、標籤、環境標記與命令面板（`Ctrl` + `K`）
- 深色為主、可切換淺色的設計 token 系統，並提供密度與動態效果偏好
- 最小化的 Tauri 權限設定與明確的內容安全政策（CSP）
- 已備妥 Rust 與前端之間的指令邊界，供後續協定引擎接上
- Windows、Linux、macOS 的原生應用程式圖示
- 單元測試，以及 Linux x64、Linux arm64 與 Windows amd64 的 CI

## 誠實呈現的介面原則

介面必須讓使用者一眼分辨「已經可用」與「還在規劃」：

- 尚未實作的功能一律標示為 **Planned** 並註明里程碑，不使用看起來可按、實際上停用的假按鈕。
- 連線列上的 `Connect · Planned` 是狀態標示，不是按鈕，因為協定引擎還不存在。
- 狀態列持續顯示資料只存在記憶體、關閉即消失，以及認證儲存區尚未建立。
- 「安全儲存區」的狀態由 Rust 端的 `runtime_summary` 回報，不是寫死在畫面上的文案。

## 開發藍圖

1. 透過系統 OpenSSH 用戶端與 PTY 建立 SSH 終端機工作階段
2. 以作業系統金鑰鏈保存機密，並嚴格驗證 `known_hosts`
3. SFTP 瀏覽與安全檔案傳輸
4. SSH Tunnel 與原生 RDP 啟動
5. 內嵌式 RDP 與 VNC 工作階段
6. 已簽章的安裝檔與更新通道

在安全邊界與測試就位之前，本專案不會宣稱任何協定已經可用。

## 開發

### 環境需求

- Node.js LTS 與 npm
- Rust stable 與 Cargo
- 所在作業系統對應的 Tauri 前置需求

系統套件需求請參考 [Tauri 官方前置需求](https://v2.tauri.app/start/prerequisites/)。

### 執行網頁介面

```sh
npm install
npm run dev
```

### 執行桌面應用程式

```sh
npm install
npm run tauri dev
```

### 驗證專案

```sh
npm run check
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

## 原始碼結構

| 路徑 | 內容 |
| --- | --- |
| `src/domain` | 連線資料模型、驗證、搜尋與排序規則，以及範例資料，皆有測試涵蓋 |
| `src/app` | 應用層狀態：偏好設定、工作空間狀態、導覽定義、Rust 執行環境資訊 |
| `src/components` | 共用元件：導覽列、側欄、連線列、Inspector、抽屜、對話框、命令面板、圖示 |
| `src/views` | 各功能區畫面：Connections、Activity、Settings 與規劃中區域 |
| `src/styles` | 設計 token 與樣式層，`index.css` 為進入點 |
| `src-tauri` | Rust 端程式、權限設定與應用程式圖示 |

介面設計的完整說明請見 [介面實作說明](docs/UI_IMPLEMENTATION.zh-TW.md)。

## 鍵盤操作

| 快捷鍵 | 動作 |
| --- | --- |
| `Ctrl` + `K` | 開啟或關閉命令面板 |
| `Ctrl` + `B` | 顯示或隱藏資源側欄 |
| `/` | 聚焦側欄搜尋欄位 |
| `N` | 新增連線 |
| `Esc` | 關閉命令面板、抽屜或對話框 |
| `↑` `↓` `Enter` | 在命令面板中移動與執行 |

## 架構支援狀況

| 平台 | 架構 | 狀態 |
| --- | --- | --- |
| Linux | x86_64 / amd64 | CI 基礎驗證 |
| Linux | aarch64 / arm64 | 原生 arm64 CI 基礎驗證 |
| Windows | x86_64 / amd64 | 本機開發與 CI 基礎驗證 |
| macOS | Apple Silicon 與 Intel | 規劃中的驗證項目 |

目前尚未提供已簽章的發行檔案。

## 專案模式

LatticeTerm 以公開方式開發。核心桌面應用程式採用 [Mozilla Public License 2.0](LICENSE) 開放原始碼授權；託管、代管、團隊、支援等服務則可能為商業性質並另行授權。

公開儲存庫不得包含服務憑證、內部基礎設施資訊、客戶資料或專有的部署設定。

## 產品文件

- [UI/UX 設計需求書](docs/UI_UX_DESIGN_BRIEF.zh-TW.md)
- [介面實作說明](docs/UI_IMPLEMENTATION.zh-TW.md)
- [本機儲存與安全性決策](docs/STORAGE_SECURITY_DECISION.zh-TW.md)

## 安全性

請勿將密碼、私鑰、權杖或正式環境的主機清單放入原始碼、Issue、螢幕截圖或記錄中。回報安全性問題前請先閱讀 [SECURITY.md](SECURITY.md)。

## 參與貢獻

開發與審查的期待請見 [CONTRIBUTING.md](CONTRIBUTING.md)，其中包含必須遵守的繁體中文 commit 訊息規範。

## 授權與商標

原始碼採用 [Mozilla Public License 2.0](LICENSE) 授權。LatticeTerm 名稱與標誌不在原始碼授權範圍內，詳見 [TRADEMARKS.md](TRADEMARKS.md)。
