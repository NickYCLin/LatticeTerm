# 更新日誌 (Changelog)

本專案遵循語意化版本（Semantic Versioning）發布，所有更新內容均以繁體中文條列說明。

---

## [0.8.0](https://github.com/NickYCLin/LatticeTerm/compare/v0.7.0...v0.8.0) (2026-08-21)


### 🚀 新增功能

* **監控:** 連線後真的能看到主機的 CPU、記憶體、硬碟了 ([593eac5](https://github.com/NickYCLin/LatticeTerm/commit/593eac512f3b662f79e30584e85fcdad7fdfbda8))
* **通道:** 實作原生 SSH 通道轉發與 SOCKS5 動態代理管理視圖 ([6f07cf1](https://github.com/NickYCLin/LatticeTerm/commit/6f07cf1b2bdd6dd32f631f2ae76c2f5f75fb5018))
* **連線:** 支援用 SSH 私鑰登入，不用再只能打密碼 ([6f02cda](https://github.com/NickYCLin/LatticeTerm/commit/6f02cda9c358b14e49b5de1e26dca5f96e3b6134))


### 🛠️ 問題修正

* **介面:** 修掉四個藏在細節裡的問題 ([2dae9d3](https://github.com/NickYCLin/LatticeTerm/commit/2dae9d32f715f3f9460f7850feef9a466b8dad9e))
* **通道:** 修正遠端轉送介面語意 ([58a219a](https://github.com/NickYCLin/LatticeTerm/commit/58a219a6e9a1029cf85e2cec4414ccb69d8c9867))
* **通道:** 強化 SSH 通道安全邊界 ([d76c36e](https://github.com/NickYCLin/LatticeTerm/commit/d76c36e55962b323d7346a64f27dfe7bcb1a3ced))
* **通道:** 讓連接埠轉送真正經過 SSH 傳輸資料 ([d550195](https://github.com/NickYCLin/LatticeTerm/commit/d550195249ed1f0ad32d7ade8b5247272d53e788))


### 🎨 介面與視覺調整

* **圖示:** 全面升級左側主導覽列 7 大功能之向量圖示設計 ([fe6836a](https://github.com/NickYCLin/LatticeTerm/commit/fe6836a3e41fef11b21f34d0df641f92cafc36e3))

## [0.7.0](https://github.com/NickYCLin/LatticeTerm/compare/v0.6.0...v0.7.0) (2026-08-21)

### 🚀 新增功能
* **SSH 通道與連接埠轉送 (Tunnels)**：
  - 新增本機轉送 (`-L`)、動態 SOCKS5 代理 (`-D`) 與遠端轉送 (`-R`) 完整功能。
  - 支援透過跳板機安全穿透連線內網資料庫（PostgreSQL、MySQL、Redis）或內部網頁。
  - 提供即時連線數統計、傳輸流量監控，以及一鍵複製標準 OpenSSH 終端指令。
* **左側主功能列圖示全面重繪**：
  - 重新設計 7 大功能圖示（雙層伺服器機架、終端機視窗、AI 多核心星芒、拱型通道、防護金庫、即時脈搏波形、六齒機械齒輪），辨識度與視覺層次大幅提升。
* **全新 7 套原創手繪色彩主題**：
  - 重新調配黑曜金珀（預設）、星穹紫境、極地冰霜、北歐墨翠、雅緻亮白、暖陶赭石、極限高對比主題。
* **AI 工作階段原生續接**：
  - 支援直接續接既有的 Agent 工作階段（Native Session Resume），避免重啟時遺失上下文。

### 🛠️ 問題修正與優化
* **行程安全釋放**：結束終端機或退出 App 時，後端會主動且安全地停止所有背景子行程，不再殘留佔用系統資源。
* **介面去蕪存菁**：移除左側底部重複的主題按鈕，統一由「設定 ➔ 外觀」管理，讓工作區視野更寬敞。

---

## [0.6.0](https://github.com/NickYCLin/LatticeTerm/compare/v0.5.0...v0.6.0) (2026-08-20)

### 🚀 新增功能
* **工作區命名與拖曳排序**：
  - 支援為多個 AI Agent 工作區自訂名稱並自由拖曳調整排列順序。
  - 啟動偏好設定自動持久化儲存，重新開啟 App 後立即恢復上次佈局。

### 🛠️ 問題修正
* **工作區安全性檢驗**：增加本機磁碟儲存路徑的安全名稱過濾，防止非法字元或路徑穿越。
* **版本號精準同步**：介面版號與建置資訊直接連動，確保各處顯示的版本號完全一致。

---

## [0.5.0](https://github.com/NickYCLin/LatticeTerm/compare/v0.4.0...v0.5.0) (2026-08-20)

### 🚀 新增功能
* **工作區獨立儲存**：
  - 實作安全隔離的工作區設定儲存，保護個別工作區的命令參數與工作目錄。
  - 新增工作區快速切換面板，簡化多專案多任務之間的切換流程。

---

## [0.4.0](https://github.com/NickYCLin/LatticeTerm/compare/v0.3.0...v0.4.0) (2026-08-20)

### 🚀 新增功能
* **批次指令廣播 (Fleet Broadcast)**：
  - 支援同時勾選多個活躍工作階段並一鍵廣播傳送指令或提示詞。
  - 提供即時送達狀態回饋，方便多主機或多 Agent 同步操作。

---

## [0.3.0](https://github.com/NickYCLin/LatticeTerm/compare/v0.2.0...v0.3.0) (2026-08-20)

### 🚀 新增功能
* **AI Agent Fleet 多工作階段管理**：
  - 內建本機 PTY 虛擬終端核心，支援多個 CLI Agent 並行執行與狀態監控。
  - 提供 Working / Waiting / Needs Attention / Done 四種即時生命週期識別。
* **SFTP 檔案傳輸工作區**：
  - 整合純 Rust `russh-sftp` 檔案瀏覽器，支援遠端目錄瀏覽、檔案上傳、下載、重新命名與權限檢視。
* **Lattice Remote 遠端桌面與主機分享**：
  - 支援本機螢幕唯讀畫面串流分享與 Web RDP 遠端連線畫布。
  - 支援一鍵擷取高解析度截圖（PNG）與畫面錄影下載（WebM）。
* **系統金鑰保管庫 (Key Vault)**：
  - SSH 與 RDP 密碼採用作業系統原生認證儲存區（Windows Credential Manager / macOS Keychain / Linux Secret Service）加密保護。
  - 主機金鑰指紋（Host Keys）在首次連線時比對防護（TOFU），伺服器變更金鑰時主動攔截警示。
* **App 內建自動更新**：
  - 整合數位簽章驗證的自動更新機制，可在「設定」介面直接檢查最新版本並就地更新。

### 🛠️ 問題修正
* **檔案覆寫防呆**：SFTP 上傳同名檔案時強制跳出覆寫確認對話框。
* **視窗與焦點優化**：修正在關閉對話框時鍵盤焦點丟失的問題。
* **跨平台相容性**：優化 Linux 環境下的系統相依性，提升各發行版安裝穩定度。
