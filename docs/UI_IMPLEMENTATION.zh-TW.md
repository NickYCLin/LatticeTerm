# LatticeTerm 介面實作說明

文件版本：0.1
更新日期：2026-08-20
對應文件：[UI/UX 設計需求書](UI_UX_DESIGN_BRIEF.zh-TW.md)

本文件說明目前程式碼如何實作設計需求書的框架與規則，作為設計與工程之間的對照表。介面文案維持英文（需求書 §14），本文件與 commit 訊息使用繁體中文。

## 1. 桌面框架

實作採用需求書 §7 建議的骨架：全域導覽 + 資源側欄 + 工作區。

| 區域 | 元件 | 尺寸與行為 |
| --- | --- | --- |
| 全域導覽 | `components/shell/NavRail.tsx` | 固定 56 px，只顯示圖示，附 Tooltip 與輔助技術名稱 |
| 資源側欄 | `components/shell/ResourceSidebar.tsx` | 280 px，可用 `Ctrl` + `B` 收合，含搜尋與各facet |
| 工作區標頭 | `components/shell/ViewHeader.tsx` | 區域名稱、說明與該區域的主要操作 |
| 工作區內容 | `views/*` | 彈性寬度，各畫面自行管理捲動 |
| Inspector | `components/connections/ConnectionInspector.tsx` | 320 px，選取連線後從右側展開，視窗小於 78rem 時隱藏 |
| 狀態列 | `components/shell/StatusBar.tsx` | 28 px，顯示數量、儲存模式、Vault 狀態與快捷鍵提示 |

分頁列與分割窗格屬於工作階段功能，等 SSH 引擎完成後才會加入，因此目前不放置空的分頁列。

## 2. 設計 token

所有顏色、字級、間距、圓角、陰影與動態時間都定義在 `src/styles/tokens.css`，元件樣式一律只讀取變數。

- **主題**：深色為預設，`:root[data-theme="light"]` 覆寫同一組變數即得淺色主題。使用者可選 System，會跟隨作業系統設定。
- **密度**：`:root[data-density="compact"]` 調整 `--row-height` 與部分間距，供主機數量多的維運情境使用。
- **動態效果**：`prefers-reduced-motion` 之外，另提供 `:root[data-motion="reduced"]` 的明確覆寫。
- **語意色**：連線狀態、警告與環境標籤各自獨立，不共用品牌色。

顏色對比以 WCAG 2.2 AA 為目標；`--text-faint` 與淺色主題的 `--accent` 都經過調整，以達到 4.5:1 的一般文字門檻。

## 3. 資訊不只靠顏色

需求書 §10 要求風險與環境不可只用顏色表達，實作方式如下：

- 環境標籤同時有色點與文字（Production／Staging／Development／Unassigned）。
- 協定同時有圖示、色彩與文字縮寫。
- 導覽列目前區域除了變色，還有左側指示條與 `aria-current`。
- 規劃中的區域在導覽列有獨立標記點，進入後有 `Planned · Milestone n` 標籤。

## 4. 已實作與規劃中的界線

需求書 §5 與 §14 要求不得用假按鈕誤導使用者。實作規則：

| 情況 | 呈現方式 |
| --- | --- |
| 已可用 | 正常可操作的控制項 |
| 尚未實作的功能 | `Planned` 標籤並註明里程碑，不提供控制項 |
| 尚未實作的區域 | `views/PlannedView.tsx`：說明用途、預定內容與安全邊界 |

連線列的 `Connect · Planned` 使用虛線外框的靜態標籤，不是停用的按鈕。新增連線表單的 Authentication 段落沒有任何輸入欄位，並說明原因；因為認證資料庫尚未建立，任何機密欄位都只會把秘密留在記憶體。

## 5. 連線管理

- 資料模型與驗證：`src/domain/connection.ts`
- 搜尋、篩選、排序與群組：`src/domain/query.ts`
- 兩者皆以 Vitest 覆蓋，包含主機名稱誤填（scheme、路徑、帳號）與標籤正規化。

驗證規則的設計重點：

- 錯誤訊息說明「下一步怎麼做」，例如把帳號填到 username 欄位，而不是只說格式錯誤。
- 送出失敗時保留使用者輸入，並把焦點移到第一個有問題的欄位。
- 重複目標（相同協定、主機與連接埠）以非阻擋的提醒呈現，因為刻意建立的重複設定是合理的。

## 6. 鍵盤操作

| 快捷鍵 | 動作 |
| --- | --- |
| `Ctrl` + `K` | 命令面板，可搜尋連線與指令 |
| `Ctrl` + `B` | 顯示或隱藏資源側欄 |
| `/` | 聚焦搜尋欄位 |
| `N` | 新增連線 |
| `Esc` | 關閉面板、抽屜或對話框 |

在輸入欄位中輸入時，單鍵快捷鍵不會被觸發。抽屜會攔截 `Tab`，避免焦點跑到底層畫面。

## 7. 無障礙

- 所有圖示按鈕都有 `aria-label` 與 Tooltip。
- 篩選與分段控制項使用 `aria-pressed`、`role="radiogroup"` 與 `aria-checked`。
- 表單錯誤以 `aria-invalid` 與 `aria-describedby` 連結。
- 破壞性操作的確認按鈕會寫出動作與對象，例如「Delete Edge gateway」。
- Focus ring 使用與品牌色不同的 `--focus`，在任何背景上都能辨識。

## 8. 圖示

`src/components/icons.tsx` 內的圖示皆為本專案自行繪製，統一 16px 網格與 1.5px 線寬，因此不需引入第三方圖示授權。介面中不使用 Emoji 作為功能圖示。

## 9. 範例資料

`src/domain/samples.ts` 只使用 RFC 2606 的文件用網域（`example.com`）與 RFC 5737 的文件用位址（`192.0.2.0/24`）。範例資料需由使用者主動載入，不會在啟動時自動出現。

## 10. 尚未實作的畫面

以下需求書列出的畫面尚未實作，等對應的子系統完成後再設計與開發，以免產生無法對應真實行為的假畫面：

- 初次啟動與建立安全儲存區
- 主機指紋信任與主機金鑰變更警告
- SSH 終端機、SFTP 雙欄檔案與 RDP／VNC 圖形工作區
- Tunnels 與 Key Vault 的實際內容
