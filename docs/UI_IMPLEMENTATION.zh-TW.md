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
| **連線檢視** | `ConnectionsView` | `src/views/ConnectionsView.tsx` | 連線清單、排序控制項、非機密 JSON 匯出/匯入與空狀態引導。 |
| **連線詳細面板** | `ConnectionInspector` | `src/components/connections/ConnectionInspector.tsx` | 320 px 右側面板，展示選取連線的中繼資料、各協定狀態與編輯/複製/刪除操作。 |
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
