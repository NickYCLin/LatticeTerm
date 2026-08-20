# LatticeTerm UI/UX 設計需求書

文件版本：0.1
更新日期：2026-08-20
設計對象：Windows、Linux、macOS 桌面應用程式
預設語言：英文，架構需支援繁體中文與其他語言
設計階段：產品基礎版，供專業 UI/UX 設計與工程交接使用

## 1. 專案摘要

LatticeTerm 是一套開放原始碼、跨平台的遠端工作空間，預計整合：

- SSH 終端機
- SFTP 檔案傳輸
- RDP 圖形桌面
- VNC 圖形桌面
- SSH Tunnel／Port Forwarding
- 連線設定、金鑰與認證資料管理

產品目標不是複製 Termius 的外觀，而是建立一套有自己識別、適合工程師與維運人員長時間使用的桌面工具。Termius 可以作為功能完整度的參考，但視覺、互動與品牌應為原創。

目前程式已有可操作的深色介面概念稿，包含左側導覽、連線清單、協定卡片與新增連線表單；它是資訊架構的起點，不是必須沿用的最終視覺稿。

### 公開與商業模式

- 專案 Repository 為 Public，核心桌面應用程式採開放原始碼模式。
- 商業化對象是託管、同步、團隊、支援或其他服務；具體服務範圍仍可調整。
- 核心本機功能應維持清楚、可獨立使用，不應強迫登入商業服務才能開啟本機連線。
- UI 必須清楚區分本機核心功能與選用的商業服務，避免使用者誤以為開源功能是試用版或被鎖住。
- 設計稿、Mock data 與截圖不得出現真實客戶、內部主機、帳密或商業服務基礎設施。

## 2. 產品定位

一句話定位：

> 讓使用者在一個可信任、快速、清楚的桌面工作空間中，管理文字終端機、檔案與遠端圖形桌面。

設計關鍵字：

- 專業、可靠、冷靜
- 資訊密度高，但不擁擠
- 鍵盤優先，滑鼠同樣容易使用
- 安全狀態透明，不用恐嚇式文案
- 長時間工作時不疲勞
- 原生桌面工具感，不像行銷網站

## 3. 主要使用者

### A. 個人工程師

管理少量開發機、家用伺服器與雲端主機，希望快速重連並保留工作分頁。

### B. 維運／系統管理人員

管理大量主機，需要群組、標籤、環境辨識、Jump Host、Tunnel、歷史紀錄與嚴格的主機金鑰驗證。

### C. 偶爾使用遠端桌面的人

不熟悉 SSH 細節，但需要透過 RDP 或 VNC 操作遠端圖形介面，希望錯誤訊息易懂且連線步驟簡單。

## 4. 核心使用情境

使用者應能：

1. 在三個操作內找到並開啟常用連線。
2. 清楚知道目前連到哪一台主機、使用哪一種協定與哪一組身分。
3. 在同一個工作空間切換 SSH、SFTP、RDP 與 VNC 分頁。
4. 第一次連線時核對主機指紋；主機金鑰變更時得到明確且不可忽略的警告。
5. 安全地解鎖、使用與重新鎖定認證資料庫。
6. 快速辨認 Production、Staging、Development 等不同環境，降低誤操作風險。
7. 使用鍵盤完成搜尋、開啟連線、切換分頁與執行常用動作。

## 5. MVP 與後續範圍

### MVP 必須設計

- 初次啟動與安全儲存區設定
- Connections 連線管理
- 新增／編輯 SSH、SFTP、RDP、VNC 設定
- SSH 終端機工作區
- SFTP 雙欄檔案工作區
- RDP／VNC 圖形工作區
- 主機指紋信任流程
- Key Vault 認證資料管理
- Activity 連線紀錄
- Settings 與安全設定
- 空白、載入、離線、失敗、鎖定與權限不足狀態

### 可列入設計系統，但不要求 MVP 實作

- 多人／團隊同步
- 行動版
- 雲端帳號
- 協作共享與權限管理
- 巨集、Snippet 與自動化工作流
- 多視窗與廣播輸入

設計稿需清楚區分「已可用」、「尚未設定」與「規劃中」，不可用看似可操作的假按鈕誤導使用者。

## 6. 建議資訊架構

| 一級區域 | 目的 | 主要內容 |
| --- | --- | --- |
| Connections | 找到與管理遠端主機 | Favorites、Recent、Groups、Tags、搜尋、快速連線 |
| Workspace | 執行實際工作 | SSH、SFTP、RDP、VNC 分頁與分割視窗 |
| Tunnels | 管理連接埠轉送 | Local、Remote、Dynamic forwarding 與狀態 |
| Key Vault | 管理認證與信任資料 | SSH keys、密碼、主機信任、鎖定狀態 |
| Activity | 查看連線歷史與可診斷事件 | 成功、失敗、時間、協定、可安全匯出的紀錄 |
| Settings | 應用程式與安全偏好 | 外觀、終端機、鎖定、剪貼簿、更新、進階設定 |

Connections 應是預設首頁；使用者已有未關閉的工作階段時，重新開啟應優先回到 Workspace。

## 7. 建議桌面框架

桌面版應將大部分空間留給實際工作內容，不建議使用占據大量高度的首頁 Hero。

| 區域 | 建議尺寸／行為 | 內容 |
| --- | --- | --- |
| 全域導覽 | 約 56–72 px，可只顯示圖示 | Connections、Tunnels、Vault、Activity、Settings |
| 資源側欄 | 約 240–320 px，可收合與調整 | 搜尋、群組、主機、狀態、快捷操作 |
| 工作區 | 彈性寬度 | 終端機、檔案或遠端桌面 |
| 分頁列 | 工作區頂端，可水平捲動 | 主機名、協定、連線狀態、未讀／錯誤提示 |
| 狀態列 | 底部精簡呈現 | 延遲、編碼、工作階段、Tunnel、縮放與安全狀態 |
| Inspector | 選用，可從右側展開 | 連線資訊、工作階段屬性與快速動作 |

推薦以「全域導覽 + 資源側欄 + 分頁工作區」為主要骨架。側欄收合後，RDP／VNC 應能進入真正的沉浸式全畫面。

## 8. 必要畫面

### 8.1 初次啟動

目標：用最少步驟完成安全儲存區設定，不要求使用者先理解加密技術名稱。

需包含：

- 產品價值簡介
- 「建立本機安全儲存區」主操作
- 使用系統登入保護的說明
- 可選的主密碼與復原提醒
- 從加密備份匯入
- 完成後新增第一個連線

### 8.2 Connections 首頁

目標：快速找到、判讀與開啟連線。

需包含：

- 全域搜尋與 Command Palette 入口
- Favorites、Recent、Groups、Tags
- List／Compact list 為預設；Card view 可選
- 每列顯示名稱、主機、協定、環境、最後使用時間與可辨識的狀態
- 主操作：Connect
- 次操作：Edit、Duplicate、Open SFTP、Open via Tunnel、Delete
- 空白狀態與匯入入口

不要只靠顏色表示 Production 或錯誤；需搭配文字或圖示。

### 8.3 新增／編輯連線

建議採分段表單或精簡 Stepper：

1. Protocol：SSH、SFTP、RDP、VNC
2. Target：名稱、Hostname／IP、Port、Environment、Group、Tags
3. Authentication：使用者、Key／Password／Agent、Jump Host
4. Options：編碼、Keepalive、顯示解析度、Tunnel 等協定專屬設定
5. Review：安全摘要、Test connection、Save and connect

設計要求：

- 常用欄位先出現，進階設定預設收合。
- 密碼預設不可見，並清楚詢問是否儲存。
- Test connection 必須回報目前測到哪一層：網路、認證、主機信任或協定。
- 表單錯誤就近顯示，保留使用者已輸入內容。
- 關閉未儲存表單前需提醒。

### 8.4 SSH 終端機工作區

需包含：

- 多分頁與分割窗格
- 可辨識的主機名、使用者、環境與連線狀態
- 搜尋、複製、貼上、重新連線、Duplicate session
- 字型、字級與縮放
- 狀態列：延遲、編碼、工作階段時間、Tunnel 狀態
- 連線中斷後保留輸出，提供明確的 Reconnect

終端機內容是視覺焦點，工具列應安靜且不遮擋輸出。

### 8.5 SFTP 工作區

建議採雙欄檔案瀏覽：Local 與 Remote。

需包含：

- 麵包屑路徑、上一層、重新整理、搜尋
- 檔名、大小、修改時間、權限
- 上傳、下載、重新命名、新增資料夾、刪除
- 傳輸佇列、進度、速度、暫停、重試與取消
- 衝突處理：覆蓋、略過、重新命名、套用到全部
- 破壞性操作的清楚確認與可復原資訊

### 8.6 RDP／VNC 工作區

目標：讓圖形桌面占用最大可視區域。

需包含：

- Fit、Actual size、Zoom、Fullscreen
- 輸入捕捉狀態與離開快捷鍵提示
- 顯示器、解析度、畫質與剪貼簿控制
- 連線品質／延遲指示
- 重新連線與安全地中斷
- 多螢幕或多工作階段切換的延伸空間

工具列可自動收合，但捕捉鍵盤／滑鼠時必須始終有可發現的退出方法。

### 8.7 Tunnels

需呈現 Local、Remote、Dynamic 三種 Tunnel 的差異、來源與目的位址、綁定範圍、使用中的工作階段及啟停狀態。錯誤需指出是連接埠占用、SSH 中斷或權限問題。

### 8.8 Key Vault

目標：讓使用者感受到「可理解的安全」，而不是看到底層資料庫名稱。

需包含：

- Locked、Unlocking、Unlocked、Auto-lock imminent、Unavailable、Recovery required 等狀態
- SSH key、Password、Jump host credential、RDP credential 與 Host trust 分類
- 認證項目被哪些連線引用
- 新增、編輯、刪除、匯入與安全匯出
- 最後使用時間與來源
- 鎖定按鈕及自動鎖定倒數提醒

介面不應出現 redb、Stronghold 等實作名稱；應使用「Secure Vault」、「System credential store」等使用者可理解的詞。

### 8.9 Activity

只記錄診斷所需資訊，不顯示密碼、私鑰、Token 或完整指令內容。

需包含：

- 時間、連線、協定、結果、失敗階段
- 篩選、搜尋與安全匯出
- 可操作的錯誤摘要與 Retry
- 清除紀錄的範圍、影響與確認

### 8.10 Settings

分類建議：General、Appearance、Terminal、Remote Desktop、Transfers、Security、Network、Updates、Advanced。

安全設定至少包含：

- 自動鎖定時間
- 背景時是否鎖定
- 剪貼簿敏感內容清除時間
- 是否允許儲存認證
- 主機金鑰驗證政策
- 加密備份與復原
- 系統憑證儲存區狀態

## 9. 關鍵流程

### 流程 A：第一次建立 SSH 連線

Connections → Add connection → 選擇 SSH → 輸入目標 → 選擇認證 → Test connection → 核對主機指紋 → Save and connect → 開啟 SSH 分頁。

### 流程 B：未知主機指紋

對話框需顯示：主機、Port、演算法、完整指紋、複製按鈕、核對說明，以及「僅本次信任」與「信任並儲存」兩個有清楚差異的選項。

### 流程 C：主機金鑰已變更

這是阻擋式高風險狀態。不可提供模糊的「繼續」主按鈕；需說明可能原因、顯示舊／新指紋、提供核對方式，並將更新信任資料設為明確的進階操作。

### 流程 D：Vault 已鎖定

開啟需要認證的連線 → 顯示就地 Unlock → 系統登入或主密碼 → 成功後直接繼續原本動作，不讓使用者重新操作一次。

### 流程 E：RDP 經 SSH Tunnel

選擇 RDP profile → 顯示將使用的 Jump Host 與 Tunnel 摘要 → 建立 Tunnel → 建立 RDP → 進入圖形工作區。任一步失敗都要指出層級並保留安全的重試方式。

## 10. 安全 UX 原則

- Production、Staging、Development 使用文字標籤搭配語意色，不只靠顏色。
- 主機指紋必須可完整查看與複製，不可只顯示截斷值。
- 高風險警告應說明「發生什麼、風險是什麼、下一步怎麼核對」。
- 不在畫面、通知、錯誤訊息、螢幕截圖模式或記錄中洩漏秘密。
- 密碼顯示需按住或短暫揭露；離開欄位後可自動隱藏。
- 複製敏感內容後顯示清除倒數與立即清除入口。
- 自動鎖定前先以不打斷工作的方式提醒；鎖定後終端機／圖形工作階段如何處理需有清楚策略。
- 破壞性操作使用具體動詞，例如「刪除 3 個連線」，避免只有 Yes／No。

## 11. 視覺方向

### 建議基調

- Dark-first，並保留未來 Light theme 的 token 架構。
- 深色中性背景搭配低對比層次，避免整頁純黑。
- 目前的薄荷綠可作為品牌 Accent 起點，但設計師可以調整色相與飽和度。
- 連線狀態、警告與環境標籤使用獨立的 semantic colors。
- UI 字型使用清楚的無襯線字體；終端機與指紋使用等寬字體。
- 邊框、陰影與圓角應克制，維持工具感。
- 動畫短而有目的，並支援 Reduced Motion。

可參考但不可直接複製的體驗特質：

- Raycast／Linear：快速搜尋與鍵盤操作
- VS Code：側欄、工作區、分頁與面板關係
- 1Password：Vault、解鎖與安全狀態的信任感
- Termius：跨協定功能覆蓋範圍

請採用一致的開源圖示庫並提供授權資訊。現有介面的文字符號與暫用圖示需全部替換，不使用 Emoji 充當正式功能圖示。

## 12. 無障礙與平台需求

- 以 WCAG 2.2 AA 為目標。
- 所有主要流程可只用鍵盤完成，Focus 順序與 Focus ring 清楚。
- 顏色對比、錯誤提示、按鈕狀態與表單標籤需符合無障礙要求。
- 圖示按鈕需有 Tooltip 與輔助技術名稱。
- 支援 200% 顯示縮放與字型放大。
- 不以 Hover 作為唯一資訊來源。
- Windows、Linux、macOS 的標題列與快捷鍵差異需在元件規格中說明。
- 最小可用視窗建議 1024 × 700；主要設計基準為 1440 × 900，另驗證 1280 × 800 與超寬螢幕。

## 13. 必要元件

- App shell 與可收合導覽
- Resource tree／connection list
- Command Palette
- Workspace tabs 與 split panes
- Status badge、environment badge、protocol badge
- Connection form controls 與 secret field
- Terminal toolbar 與 status bar
- File browser、transfer queue、progress row
- Remote desktop floating toolbar
- Vault item 與 lock state
- Host fingerprint dialog 與高風險警告
- Drawer、Dialog、Context menu、Tooltip
- Empty、Loading、Skeleton、Error、Offline、Permission denied states
- Toast、Inline validation、Persistent problem banner

元件需包含 Default、Hover、Focus、Active、Selected、Disabled、Loading、Error 等狀態。

## 14. 文案原則

- 英文 UI 優先，但所有字串必須可本地化，版面需預留繁體中文較長文字。
- 使用短句與具體動詞，例如 Connect、Reconnect、Trust and save、Lock vault。
- 錯誤訊息包含失敗階段與可採取的下一步。
- 避免把底層例外直接丟給一般使用者；技術細節可放在可展開區塊並支援安全複製。
- 未實作的功能標示 Planned，不以 Disabled 按鈕假裝已存在。

## 15. 交付內容

請設計師提供：

1. Figma 原始檔與清楚的頁面結構。
2. 資訊架構與主要 User flow。
3. 低保真 Wireframe，先確認框架與密度。
4. 高保真 Dark theme 核心畫面。
5. 可點擊 Prototype：新增 SSH、信任主機、解鎖 Vault、SSH 工作區、RDP 經 Tunnel。
6. 完整 Component library 與所有互動狀態。
7. Color、Typography、Spacing、Radius、Elevation、Motion 等 Design tokens。
8. Windows、Linux、macOS 差異註記。
9. Accessibility 註記與鍵盤操作表。
10. Logo、App icon、功能圖示與授權來源。
11. 工程交接標註，包括尺寸、間距、斷點、狀態與互動規則。

至少需交付下列高保真 Frame：

- First run／Create vault
- Vault locked／Unlock failure
- Connections：有資料、空白、搜尋無結果
- Add SSH：正常、驗證錯誤、Test connection 失敗
- Unknown host fingerprint
- Changed host key 高風險警告
- SSH workspace：單分頁、多分頁、分割窗格、斷線
- SFTP：傳輸中、衝突、失敗
- RDP／VNC：正常、全畫面、連線品質差、斷線
- Tunnels：正常、Port conflict
- Key Vault：Locked、Unlocked、Unavailable
- Activity 與 Settings／Security

## 16. 驗收標準

- 新使用者不看說明即可建立第一個連線。
- 熟練使用者可用鍵盤搜尋並開啟常用連線。
- 任一工作畫面都能辨認目前主機、協定、環境與連線狀態。
- 未知主機與主機金鑰變更的風險層級不會混淆。
- RDP／VNC 能最大化顯示面積，且可容易退出輸入捕捉與全畫面。
- 所有失敗狀態都有可採取的下一步，不會只顯示 Error。
- 重要資訊不只靠顏色傳達。
- 設計系統可直接對應 React 元件與 Tauri 桌面應用，不依賴網頁專屬互動。

## 17. 設計師可探索的題目

- Connection list 的最佳密度與 Group／Tag 呈現方式。
- 新增連線應採 Drawer、Dialog 或獨立頁面。
- 同一主機的 SSH、SFTP、RDP 是否應合併為一個 Profile 下的多個服務。
- Command Palette 在新手與進階使用者之間的可發現性。
- Terminal、SFTP 與 Remote Desktop 同時使用時，分頁與分割視窗的最佳模型。
- Vault 鎖定時，既有工作階段應如何被視覺化而不洩漏敏感資訊。

預設建議是：以主機為核心建立 Profile，一個 Profile 可包含多種服務；常用連線採緊湊 List；新增流程使用可保存草稿的獨立頁面或大型 Drawer。
