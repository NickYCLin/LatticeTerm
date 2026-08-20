# LatticeTerm 介面實作說明

文件版本：1.0  
更新日期：2026-08-20  
對應文件：[UI/UX 設計規格書](UI_UX_DESIGN_BRIEF.zh-TW.md)  

本文件說明前端與桌面端元件的架構實作、狀態管理以及與設計規格書的對照。

---

## 1. 元件與畫面結構

| 區域 | 核心元件 | 實作檔案 | 職責與特性 |
|---|---|---|---|
| **全域導覽** | `NavRail` | `src/components/shell/NavRail.tsx` | 56 px 側邊導覽列，支援 Tooltip、主題快速切換與無障礙指示條。 |
| **資源側欄** | `ResourceSidebar` | `src/components/shell/ResourceSidebar.tsx` | 280 px 側欄，包含關鍵字搜尋輸入框、群組分組統計、環境標籤與釘選篩選。 |
| **工作區標頭** | `ViewHeader` | `src/components/shell/ViewHeader.tsx` | 顯示當前檢視標題、說明與側欄展開/收合切換按鈕。 |
| **連線檢視** | `ConnectionsView` | `src/views/ConnectionsView.tsx` | 連線卡片、排序控制項、非機密 JSON 匯出/匯入與空狀態引導。 |
| **連線卡片** | `ConnectionCard` | `src/components/connections/ConnectionCard.tsx` | 玻璃質感卡片，整張卡開啟詳細資料，星號與操作按鈕為同層元素。 |
| **連線詳細面板** | `ConnectionInspector` | `src/components/connections/ConnectionInspector.tsx` | 344 px 右側面板，分「連線資訊」與「主機狀態」兩個分頁。 |
| **主機資源面板** | `HostMetricsPanel` | `src/components/connections/HostMetricsPanel.tsx` | CPU、記憶體、磁碟與開機時間的量表；尚未連線時顯示原因而非假數值。 |
| **新增/編輯抽屜** | `ConnectionDrawer` | `src/components/overlays/ConnectionDrawer.tsx` | 抽屜式連線表單，支援即時驗證、Tab 焦點循環鎖定與重複目標提醒。 |
| **命令面板** | `CommandPalette` | `src/components/overlays/CommandPalette.tsx` | `Ctrl` + `K` 全域命令面板，支援搜尋連線與執行全域快捷動作。 |
| **活動紀錄** | `ActivityView` | `src/views/ActivityView.tsx` | 活動日誌清單、關鍵字搜尋、事件類型篩選與純文字日誌匯出。 |
| **設定檢視** | `SettingsView` | `src/views/SettingsView.tsx` | 外觀設定（主題、密度、動態效果）、安全機制說明與執行環境資訊。 |
| **狀態列** | `StatusBar` | `src/components/shell/StatusBar.tsx` | 28 px 底部狀態列，顯示連線數、記憶體/儲存模式與 Vault 鎖定狀態。 |

---

## 2. 狀態管理與領域模型

- **連線領域模型 (`src/domain/connection.ts`)**：
  - 定義 `ConnectionProfile`、`ConnectionDraft`、`Protocol` 與 `Environment`。
  - 嚴格驗證主機名稱（排除空格、scheme 與路徑）、連接埠範圍（1-65535）與標籤正規化。
- **安全匯出/匯入 (`src/domain/export.ts`)**：
  - 實作 `serializeProfiles` 與 `parseAndValidateImport`，過濾所有機密，驗證匯入格式。
- **活動日誌模型 (`src/domain/activity.ts`)**：
  - 提供 `filterActivity` 與 `exportActivityLogText`，維護最新 200 筆視窗活動紀錄。
- **Workspace Hook (`src/app/useWorkspace.ts`)**：
  - 整合 Profiles 集合、即時搜尋過濾、群組與標籤收集、CRUD 操作與批次匯入。
- **Preferences Hook (`src/app/preferences.ts`)**：
  - 管理主題（深色/淺色/跟隨系統）、密度（舒適/緊湊）與動態偏好，並同步至 DOM 與 localStorage。

---

## 3. 設計 Token 與樣式體系

樣式層定義於 `src/styles/`：
- `tokens.css`：定義色彩、間距、圓角、字級、陰影與動態時間變數。
- `base.css`：重設瀏覽器預設樣式、焦點環樣式與無障礙文字截斷（`.truncate`）。
- `shell.css`、`connections.css`、`controls.css`、`overlays.css`：元件專用樣式。

---

## 4. 鍵盤操作規範

| 快捷鍵 | 動作 |
|---|---|
| `Ctrl` + `K` | 開啟或關閉命令面板 |
| `Ctrl` + `B` | 展開或收合資源側欄 |
| `/` | 聚焦側欄搜尋欄位 |
| `N` | 開啟新增連線抽屜 |
| `Esc` | 關閉開啟中的抽屜、對話框或命令面板 |
| `↑` `↓` `Enter` | 在命令面板與清單中導覽與確認 |

---

## 5. 多語系

- 語系檔位於 `src/i18n/messages/`，`zh-TW.ts` 是所有鍵的基準，`en.ts` 必須滿足同一個 `Messages` 型別，缺鍵會在編譯時就失敗，而不是在畫面上留下空白。
- 預設語系為繁體中文，可在設定或命令面板切換，選擇會存入偏好設定並同步 `<html lang>`。
- 元件不得直接寫入顯示文字：
  - 欄位驗證回傳 `{ key, values }` 錯誤代碼，由介面翻譯。
  - 匯入問題回傳 `ImportIssue`，含欄位層級的原因代碼。
  - 操作紀錄存的是資料與訊息鍵，所以切換語言後舊紀錄一樣讀得懂。
- 時間與數字使用 `Intl` 並帶入目前語系標籤。

---

## 6. 主題

`src/styles/tokens.css` 提供六種主題，`src/app/themes.ts` 負責目錄與預覽色票：

| 主題 | 說明 |
| --- | --- |
| 深色 | 預設，薄荷綠品牌色 |
| 淺色 | 明亮環境 |
| 午夜藍 | 偏藍深色調 |
| 石墨黑 | 中性灰深色調 |
| 暖砂 | 低藍光暖色調 |
| 高對比 | 關閉半透明與漸層，加強對比 |

另有「跟隨系統」選項，會在深色與淺色之間切換。

質感規則：

- 背景由各主題自行提供 `--app-gradient` 漸層，固定在視窗上不隨捲動位移。
- 浮起的表面統一使用 `.glass`（半透明 + `backdrop-filter`）與 `.glass--sheen`（斜向反光）。
- 高對比主題把 `--glass-blur` 設為 0、`--app-gradient` 設為 `none`，因為半透明與漸層正是這個主題的使用者最不需要的東西。
- 深淺色切換時同時呼叫 Tauri 的 `setTheme`，讓原生標題列跟著換色，避免視窗頂端出現色塊接縫。

---

## 7. 主機資源監控

需求是「連線後要能看到 CPU、記憶體、硬碟」，因此資料模型與畫面位置先行，資料來源等連線引擎完成後接上。

- 放置位置：連線詳細面板的「主機狀態」分頁。資源屬於某一台主機，不是全域資訊，放在選取的連線旁邊最直覺，也不必為此新增一個一級區域。
- 資料模型：`src/domain/metrics.ts` 定義 `HostMetrics`（CPU 使用率與核心數、記憶體、置換空間、各掛載點磁碟、開機時間、系統負載），並提供容量格式化、使用率計算與嚴重度分級。
- 狀態機：`unavailable`、`loading`、`ready`、`error`。目前所有主機都是 `unavailable`，畫面直接說明「要連線成功後才有資料」，不顯示假的數字或永遠轉不完的載入動畫。
- 顏色分級（正常／注意／危險）一律搭配百分比數字，不單靠顏色判讀。

---

## 8. 連線設定的存放

- 位置：作業系統的應用程式資料目錄（Windows 為 `%APPDATA%\io.github.nickyclin.latticeterm`），檔名 `connections.json`。放在這裡而不是執行檔旁邊，更新程式不會弄丟資料，多人共用電腦時也會跟著各自的使用者帳號走。
- 內容：只有主機資訊與整理用的標籤。`ConnectionProfile` 沒有密碼、金鑰或通行碼欄位，所以這個檔案可以直接備份或附在問題回報裡而不會外洩。
- 寫入方式：先寫暫存檔再改名覆蓋，寫到一半斷電只會留下前一份完整檔案，不會產生半截檔。
- 讀不到的檔案不會被刪除：會改名保留（`connections.json.unreadable`），介面在設定頁明確告知原因與保留位置，再以空白清單啟動。同樣的情況發生第二次也不會覆蓋掉第一份。
- 版本欄位：檔案標記結構版本，遇到比目前新的版本一樣採取「保留原檔、空白啟動」，避免誤讀。
- 操作紀錄仍然只存在記憶體，關閉即消失，這點沒有改變。
