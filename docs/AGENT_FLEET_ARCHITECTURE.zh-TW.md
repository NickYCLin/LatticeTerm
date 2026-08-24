# AI Agent Fleet 架構與整合藍圖

## 目標

Agent Fleet 讓 LatticeTerm 成為多個大型語言模型 CLI 的本機工作中樞：每個 CLI 都有真正的互動式終端機，可並行執行、切換、監看與停止，同時沿用各工具原本的登入方式、設定與權限。

設計概念參考 [Herdr](https://github.com/motionharvest/herdr) 公開呈現的背景終端機、Agent 狀態與遠端 attach 模型，但本專案沒有複製或嵌入 Herdr 程式碼。第一階段先建立可驗證的桌面內 MVP，再逐步加入 daemon 與語意整合。

## 現行架構

```mermaid
flowchart LR
  UI["React Agent Fleet"] -->|"Tauri commands"| REG["Rust AgentRegistry"]
  UI -->|"保存／確認還原"| PLAN["agent-workspaces.json"]
  PLAN -->|"重新驗證啟動資料"| ADAPTER["Built-in Adapter Registry v1"]
  UI -->|"原生 Session ID／標題"| ADAPTER
  ADAPTER -->|"argument vector"| REG
  REG --> PTY["portable-pty"]
  PTY --> A["Codex / Claude / Gemini / ..."]
  PTY --> C["Custom CLI"]
  A -->|"tool hook"] REP["LatticeTerm Reporter CLI"]
  C -->|"custom hook"] REP
  REP -->|"loopback + session token"] REG
  REG -->|"data / state / closed events"| UI
```

- Rust 核心使用 [portable-pty](https://docs.rs/portable-pty/latest/portable_pty/) 建立原生 PTY，不用一般 pipe 假裝終端機。
- 內建 Codex、Claude Code、Gemini CLI、OpenCode、Copilot CLI、Hermes、Cursor Agent、Aider、Qwen Code、Kimi、Droid 與 Grok 目錄，也可輸入自訂可執行檔。
- 每個工作階段都有獨立程序、PTY、尺寸、輸入、輸出與停止控制，並與 SSH、SFTP、Lattice Remote、Web RDP 共用工作階段分頁。
- 啟動時指定經過驗證的工作目錄；CLI 可依目前作業系統使用者權限操作該目錄。
- PTY 位元組以 Base64 跨越 IPC，前端在終端機掛載前最多暫存 256 KiB，之後直接交給 xterm。
- 未整合 hook 的 CLI 使用少量明確提示詞將狀態標成「可能等待輸入」；這只是提醒，不宣稱已理解完整語意。
- 支援 Adapter／hook 明確回報「工作中、等待輸入、閒置、完成」。UI 會顯示狀態來源；收到 Adapter 回報後，終端輸出 heuristic 不再覆蓋該工作階段的語意狀態。
- 支援使用者明確勾選執行中的 Agent，經二次確認後將同一段提示送進最多 32 個獨立 PTY；每個目標逐一回報成功或失敗，提示內容不會保存。
- 支援最多 32 個安全啟動項目，也可命名工作區及調整持久化順序。應用程式重啟後，使用者可逐項或整批確認，LatticeTerm 會重新驗證磁碟資料並依保存順序建立新的 CLI 程序；每項分別回報成功或失敗。
- 版本化內建 Adapter v1 支援 Codex、Claude Code、Gemini CLI 與 Hermes Agent 的原生 Session 續接。使用者可只續接，或另行明確保存識別值供工作區下次還原；舊 PTY、程序與畫面不會被宣稱仍然存活。

### 原生 Session 續接 Adapter v1

| CLI | 由 LatticeTerm 建立的參數 | 依據 |
| --- | --- | --- |
| Codex | `codex resume <SESSION_ID_OR_NAME>` | [OpenAI Codex CLI reference](https://developers.openai.com/codex/cli/reference/) |
| Claude Code | `claude --resume <SESSION_ID>` | [Anthropic CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage) |
| Gemini CLI | `gemini --resume <SESSION_UUID_OR_INDEX>` | [Gemini CLI session management](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/session-management.md) |
| Hermes Agent | `hermes --resume <SESSION_ID_OR_TITLE>` | [Hermes session guide](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/sessions.md) |

Adapter 會把識別值當成單一 argument，不經 shell；長度上限 512 bytes，拒絕控制字元、前導 `-` 與額外啟動參數。OpenCode 目前只有已確認的非互動 `run --session` 介面，尚未加入互動式 PTY 續接白名單。

## 語意 Reporter 協定

每個由 Agent Fleet 啟動的 CLI 都會收到下列環境變數：

- `LATTICETERM_AGENT_REPORTER`：目前 LatticeTerm 可執行檔，可當作狀態回報 CLI。
- `LATTICETERM_AGENT_REPORT_ADDR`：只綁定 `127.0.0.1` 的隨機連接埠。
- `LATTICETERM_AGENT_REPORT_TOKEN`：每個工作階段獨立產生的 256-bit 隨機權杖。
- `LATTICETERM_AGENT_SESSION`：目前 Agent Fleet 工作階段 ID。

POSIX hook 可執行：

```sh
"$LATTICETERM_AGENT_REPORTER" agent-report working
"$LATTICETERM_AGENT_REPORTER" agent-report needs-attention
"$LATTICETERM_AGENT_REPORTER" agent-report idle
"$LATTICETERM_AGENT_REPORTER" agent-report done
```

PowerShell hook 可執行：

```powershell
& $env:LATTICETERM_AGENT_REPORTER agent-report done
```

Reporter 每次只傳一個最多 4 KiB 的 JSON 狀態訊息。Registry 必須同時驗證 session ID 與權杖才會接受；它沒有終端輸入、程序啟動、檔案讀寫或任意命令能力。工具專用 Adapter 後續只需把各 CLI 的 hook 事件映射到這四種狀態，不必取得 Tauri IPC 權限。

## 安全與生命週期

- 可執行檔與參數以分離的 argument vector 交給程序，不把使用者內容串成 shell 指令。
- 自訂名稱、路徑、參數數量、單一參數大小、終端尺寸與輸入事件大小都有上限與控制字元驗證。
- LatticeTerm 不讀取、不複製也不保存模型 API 金鑰；登入仍由各 CLI 自行處理。
- CLI 以啟動 LatticeTerm 的使用者權限執行，不是沙箱。使用者只能加入自己信任的程式。
- 執行中的工作階段只存在記憶體，Rust registry 最多接受 32 個活躍 session；每個 PTY 保留最近 256 KiB 有界輸出與單調 byte offset，因此重播尾端總上限為 8 MiB。WebView 重新載入可重新 attach 並避免快照／即時事件重複。使用者停止或應用程式結束／重啟時仍會終止已登記的 CLI。
- 安全啟動工作區使用獨立的版本化 JSON；v3 可無損讀取 v1／v2，並保存工作區名稱、項目順序、CLI 類型、標籤、可執行檔、明確參數、工作目錄與選填備註。原生 Session ID 或標題只在使用者明確保存續接項目時寫入；備註為選填的純文字（最多 200 bytes、去除前後空白、拒絕控制字元），供使用者一眼看出該項目在做什麼，屬 v3 內的附加欄位，舊檔缺此欄位時預設為空。密碼、Token、API Key、Passphrase、Secret 參數會被拒絕；讀不到或版本不相容的原檔會先移到復原檔，不會直接覆寫。
- 不把終端輸出、提示內容、輸入歷史、程序 ID、Reporter 權杖或模型憑證寫入磁碟；重新 attach 用的 256 KiB 輸出尾端只存在該桌面程序記憶體。
- Reporter 只監聽 loopback，訊息限制 4 KiB 且有讀寫逾時；每個工作階段使用獨立高熵權杖。權杖會存在該 CLI 的環境中，因此相同作業系統使用者權限的程序仍屬於信任邊界，但即使權杖外洩也只能變更該工作階段的顯示狀態。
- Windows 偵測與啟動涵蓋 `.exe`／`.com`，以及 npm／pnpm／yarn 全域安裝常見的 `.cmd`／`.bat` shim（例如 `claude.cmd`）。因為 Windows 無法直接 `CreateProcess` 批次檔，`.cmd`／`.bat` 會自動透過 `cmd /c` 啟動，並先去掉 `canonicalize` 產生的 `\\?\` 前綴以免 cmd 無法解析。

## 完成度矩陣

| 能力 | 現況 | 說明 |
| --- | --- | --- |
| 多 CLI 原生 PTY | 已完成 | 可同時啟動多個獨立工作階段 |
| 內建目錄與 PATH 偵測 | 已完成 | 12 種常見 CLI，可手動重新偵測 |
| 自訂 CLI adapter | 已完成 | 明確 executable 與每行一個 argument |
| 統一終端分頁 | 已完成 | 與其他 LatticeTerm 連線工具共用工作區 |
| 主動停止與退出清理 | 已完成 | 停止按鈕有確認，應用程式退出會清理 |
| 待輸入提醒 | 已完成 | 支援 heuristic，Adapter 可明確覆蓋 |
| CLI 語意 Reporter | 已完成 | loopback、每 session 權杖、四種狀態與來源標示 |
| 批次提示 | 已完成 | 明確選取、二次確認、最多 32 個目標與部分失敗回報 |
| 啟動工作區命名／排序 | 已完成 | 名稱與順序由 Rust 驗證及原子保存，v1 資料可相容遷移 |
| 原生 CLI Session 續接 | 已完成 | Adapter v1 支援 Codex、Claude Code、Gemini CLI、Hermes；保存由使用者明確選擇 |
| 同程序介面重新 attach | 已完成 | 先訂閱事件再 hydration；session 關閉不會被舊快照復活，最近 256 KiB PTY 輸出依 offset 去重重播 |
| 工具專用語意 Adapter | 部分完成 | 已有版本化續接 recipe 與自動 session ID 擷取（白名單 CLI、保守比對）；工具 hook、token／cost 擷取仍未完成 |
| 跨程序背景 daemon 與重新 attach | 未完成 | 關閉 LatticeTerm 後不保留工作階段；目前只支援同一桌面程序內的 WebView 重新 attach |
| 跨重啟還原 | 部分完成 | 已有安全工作區、批次重新啟動、四種 CLI 原生脈絡續接與自動 session ID 擷取；應用程式程序重啟後的原 PTY、pane 與輸出還原尚未完成 |
| 遠端 Agent Fleet | 未完成 | 尚未透過 SSH 或 Lattice Remote 控制遠端 PTY |
| 任務編排 | 部分完成 | broadcast prompt 已完成；依賴圖、佇列與排程仍待實作 |
| 權限隔離 | 未完成 | 尚無每 Agent 容器、沙箱或檔案範圍策略 |

## 下一階段設計

### 1. 語意 adapter

Reporter 傳輸、狀態模型與 Adapter v1 的四種原生 restore recipe 已完成。session ID 自動擷取已完成：輸出經 ANSI 清理後，只在「session」字樣附近出現的 UUID 才被視為 session id（跨 chunk 滾動視窗、僅白名單 CLI 啟用、擷取一次即停），寫入工作階段摘要並以 agent://capture 事件通知介面，續接區塊可一鍵套用。下一步擴充 manifest 的工具 hook 安裝方式，再加入 token／cost 等可觀測事件。只有官方確認可在互動式 PTY 安全續接的 CLI 才進入白名單；其他 CLI 繼續使用保守 heuristic，也可由使用者自訂 hook 呼叫通用 Reporter。

### 2. Lattice Agent daemon

將 PTY owner 從 Tauri 程序抽成使用者自行啟動的本機背景服務。桌面 UI 透過使用者專屬的 local socket attach，daemon 保存 workspace／tab／pane metadata，並使用 CLI 原生 session ID 還原。只有使用者明確選擇「留在背景」的工作階段才可脫離 UI。

### 3. 自建遠端 Fleet

遠端操作不直接混進螢幕分享資料流。重用 Lattice Remote 的一次性配對、Noise 加密與未來 Relay/NAT traversal 基礎，但建立獨立的 `terminal-control` capability、金鑰與授權畫面：

1. 被控端 Lattice Agent 預設只監聽 loopback。
2. 使用者明確啟用遠端 Agent Fleet，選擇可存取的工作目錄與操作範圍。
3. 控制端以一次性配對或已釘選裝置金鑰建立端對端加密控制通道。
4. 每個 PTY 使用獨立 multiplexed stream，控制訊息與終端資料有版本及大小上限。
5. Relay 只轉送密文；無人值守、檔案寫入與高風險指令要分開授權。

第一個遠端版本宜先支援 SSH transport，因為主機信任、認證與 Tunnel 架構較成熟；Lattice Remote transport 則作為自建 Relay 與 NAT 環境的第二條路。

### 4. 編排與可觀測性

安全啟動工作區、工作區命名／排序、明確確認的批次重新啟動與 broadcast prompt 已完成。下一步加入任務依賴、佇列、排程與資源限制。預設只保存狀態 metadata，不保存提示或終端逐字稿；任何錄製都必須由使用者明確開啟並設定保存位置。

## 驗收原則

- UI 顯示「可用」的能力必須有真實後端與測試。
- 各平台必須通過原生 PTY 啟動、輸入輸出、resize、停止與應用程式退出清理。
- 未安裝、立即退出、無權限、錯誤工作目錄與異常大量輸入都要回傳明確錯誤。
- 遠端版本在加入無人值守前，必須先完成裝置身分、能力授權、重放防護與 Relay 威脅模型。
