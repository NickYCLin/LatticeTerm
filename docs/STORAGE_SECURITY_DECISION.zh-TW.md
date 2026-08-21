# LatticeTerm 本機儲存與安全架構決策

文件版本：1.0  
更新日期：2026-08-20  
狀態：Accepted / Phase 1 Implemented  

---

## 1. 核心結論與分層儲存架構

LatticeTerm 採取明確的資料分類與分層儲存策略：

- **非機密中繼資料層**：連線設定、顯示名稱、協定、連接埠、群組、標籤與 UI 偏好。未來採用 **redb / SQLCipher** 純 Rust 嵌入式資料庫保存。
- **安全金鑰與憑證保管庫 (Key Vault)**：目前以 known_hosts.json 管理主機信任，並由作業系統認證儲存區隔離使用者明確保存的 SSH／SFTP／RDP 密碼；未來再以 **Tauri Stronghold** 提供整庫加密、自動鎖定與跨機備份。
- **系統憑證保護層 (OS Credential Store)**：已使用 Windows Credential Manager、macOS Keychain 與 Linux Secret Service 保存密碼；未來也可用來包裝 Stronghold 的主密鑰。
- **SSH 私鑰認證**：只在使用者連線時從明確選擇的本機路徑讀取並簽章，不把私鑰內容或 Passphrase 複製到 Profile、前端持久層或目前的認證儲存區。
- **非機密備份與匯出**：以結構化 JSON 提供非機密設定匯出與匯入，絕不輸出或解析任何密碼或私鑰。

---

## 2. 儲存架構流程

```mermaid
flowchart LR
    UI[React UI] -->|Profile request / short session ID| CORE[Rust Application Core]
    CORE --> META[Metadata Store (redb / Storage Trait)]
    CORE -. future .-> VAULT[Tauri Stronghold Secure Vault]
    CORE --> KEYRING[OS Credential Store]
    CORE --> LOCALKEY[User-selected local SSH key]
    META -->|credential_ref only| CORE
    KEYRING -. future wrapped master key .-> VAULT
    VAULT -. future decrypted credentials .-> CORE
    LOCALKEY -->|sign in Rust memory only| CORE
    CORE --> ENGINE[SSH / SFTP / RDP / VNC Engines]
```

---

## 3. 資料分級規範

| 資料等級 | 資料範例 | 安全與儲存要求 |
|---|---|---|
| **一般中繼資料** | 顯示名稱、協定、連接埠、群組、標籤、環境標記、外觀設定 | 儲存於中繼資料庫，支援交易、版本與安全匯出 |
| **敏感資產資訊** | 主機名稱、IP 位址、使用者名稱、連線活動紀錄 | 不可進入遠端診斷日誌，支援非機密 JSON 匯出 |
| **使用者產生的媒體** | 遠端 Canvas 的 PNG 截圖、WebM／MP4 錄影 | 僅在使用者主動擷取時產生；下載前暫存於 WebView 記憶體，不進應用程式資料目錄或設定匯出 |
| **機密與信任根** | 密碼、Token、私鑰 bytes、Passphrase、主機金鑰指紋 | 必須靜態加密與完整性保護，禁止寫入前端持久層 |

---

## 4. 實作進度與規劃

### Phase 1：安全資料邊界 (已完成 ✅)
- 建立純 Rust `domain` 領域模型與 `Storage` trait 抽象層。
- 前端 Profile 嚴格僅保存中繼資料與組織設定，不含任何機密欄位。
- 實作安全非機密 JSON 匯出與匯入驗證器。

### Phase 2：Key Vault 與主機指紋信任 (進行中 🔄)
- 已完成主機指紋核對對話框（Unknown host fingerprint）與金鑰變更警告（Changed host key）。
- 已完成 `known_hosts.json` 持久化，以及 Key Vault 內真實資料的列出、搜尋、手動新增與確認移除。
- 網頁預覽不顯示範例信任資料；信任檔讀不到時維持安全失敗，不退化成空清單。
- 已完成系統金鑰庫（Keyring）整合；只有使用者明確勾選且驗證成功的 SSH／SFTP／RDP 密碼才會寫入，前端只能查詢是否存在或要求刪除，不能讀取明文。
- 已完成 SSH 私鑰認證；私鑰由使用者指定本機路徑，內容與 Passphrase 不會保存。Tauri Stronghold 仍待整合。
- 尚待實作認證資料的自動鎖定、解鎖與閒置保護機制。
- SSH／SFTP／RDP 密碼預設只供單次連線；只有使用者明確選擇記住且驗證成功後才存入系統認證儲存區。內嵌 Lattice Remote 主機模式只把配對碼保留於程序與 WebView 記憶體並在配對後清除；RDP 密碼則以 stdin 傳入每工作階段獨立的 engine。
- RDP 自簽憑證信任也是當次重試限定，不寫入 profile 或 `known_hosts.json`。

### Phase 3：加密備份與跨平台遷移
- 提供整庫加密匯出與還原（*.latticeterm-backup）。
- Windows、Linux 與 macOS 跨平台相容性驗證。
