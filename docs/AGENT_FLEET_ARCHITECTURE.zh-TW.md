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
  ADAPTER -->|"argument vector"| REG
  REG --> PTY["portable-pty"]
  PTY --> A["Codex / Claude / Gemini / ..."]
  PTY --> C["舊版工作區中的 Custom CLI"]
  A -->|"tool hook"| REP["LatticeTerm Reporter CLI"]
  C -->|"custom hook"| REP
  REP -->|"loopback + session token"| REG
  REG -->|"data / state / closed events"| UI
```

- Rust 核心使用 [portable-pty](https://docs.rs/portable-pty/latest/portable_pty/) 建立原生 PTY，不用一般 pipe 假裝終端機。
- 介面提供 Codex、Claude Code、Gemini CLI、Google Antigravity CLI、OpenCode、Copilot CLI、Hermes、Cursor Agent、Aider、Qwen Code、Kimi、Droid 與 Grok 共 13 種目錄。Rust 核心仍可驗證並還原舊工作區中的自訂可執行檔。
- 每個目錄項目都有經原始碼固定且可檢查來源的安裝方式；未偵測到 CLI 時，先顯示完整指令並要求確認，再以可見 PTY 執行。平台缺少必要安裝器或沒有合適的原生安裝路徑時，只提供可複製的上游安裝說明網址，不靜默改動系統。
- 每個工作階段都有獨立程序、PTY、尺寸、輸入、輸出與停止控制，並與 SSH、SFTP、Lattice Remote、Web RDP 共用工作階段分頁。
- 啟動時指定經過驗證的工作目錄；CLI 可依目前作業系統使用者權限操作該目錄。
- PTY 位元組以 Base64 跨越 IPC，前端在終端機掛載前最多暫存 256 KiB，之後直接交給 xterm。
- 未整合 hook 的 CLI 使用少量明確提示詞將狀態標成「可能等待輸入」；這只是提醒，不宣稱已理解完整語意。
- 分頁名稱、CLI 名稱與模型欄位分開保存。模型只接受明確的 `--model` 參數或 CLI 啟動／狀態畫面中的保守格式；沒有可靠值就顯示「模型尚未回報」，不拿產品名稱代替模型。輸入一般提示後停止啟動掃描，只有 `/model` 會重新開啟一次掃描，避免把回答內容誤判成目前模型。
- 支援 Adapter／hook 明確回報「工作中、等待輸入、閒置、完成」。Codex 以官方 `notify` 事件、Claude Code 以工作階段專屬的官方 lifecycle hooks 接上 Reporter；Gemini CLI 則以僅限該程序的暫存 system settings 接上 `BeforeAgent`、`AfterAgent` 與權限通知。OpenCode 透過程序級 inline config 載入暫存 local plugin，使用 `chat.message`、`session.status`、`session.error`、permission 與 question events；主工作階段會與子 Agent 分開追蹤，多個並行主工作階段全部 idle 才回報完成。GitHub Copilot CLI 以程序限定的 `--plugin-dir` 掛載暫存 plugin，追蹤 prompt、`agentStop`、permission、error 與 subagent events；主 Agent 已停止但背景 subagent 尚未全部結束時不回報完成。Hermes Agent 以程序限定的暫存 bundled-plugin overlay 保留原始 provider tree、`HERMES_HOME`、登入、使用者／專案 plugins 與設定，追蹤 session、turn、approval 與 subagent lifecycle；子 Agent 的 `on_session_end` 不會結束主工作。相同 overlay 也從官方 `post_api_request` 取得標準化的輸入、輸出、快取讀寫與推理 token buckets；只轉送有界非負整數及 API request ID，依 request ID 去重後累計主工作與子 Agent 用量，不轉送 request、response、prompt 或 tool 內容。Qwen Code 也以程序限定的暫存 system settings 追蹤 `UserPromptSubmit`、`Stop`、`StopFailure`、permission 與 tool events。只有收到第一個真實 hook 後才停用完成猜測。這些整合不改動使用者或專案設定；已有不可安全合併的程序級設定、專案停用所有 hooks、無法辨識 Hermes 安裝結構，或 pure／safe／bare mode 時保留原設定，退回保守 heuristic。Claude 與 Qwen 的 `Stop` 尚有背景工作時維持工作中，有排程等待時標成閒置。具備完成事件的 CLI 不再用終端控制碼猜測完成；UI 會顯示狀態來源。
- 支援使用者明確勾選執行中的 Agent，經二次確認後將同一段提示送進最多 32 個獨立 PTY；每個目標逐一回報成功或失敗，提示內容不會保存。
- 支援最多 32 個安全啟動項目，也可命名工作區及調整持久化順序。應用程式重啟後，使用者可逐項或整批確認，LatticeTerm 會重新驗證磁碟資料並依保存順序啟動 CLI 程序；每項分別回報成功或失敗。沒有額外參數或舊版明確 Session ID 的 Codex 項目使用 `codex resume --last`，依工作目錄選出最近對話；Cursor 項目使用官方的 `agent --continue` 續接最近對話。
- 可選擇保存一份工作區共用啟動指示；之後每個全新的非 `custom` CLI 進入互動提示後會先收到這段文字，若同時有跨 CLI handoff 則共用指示排在 handoff 前面。自動還原的舊工作階段、明確原生 Session 續接與 `resume --last`／`--continue` 不會重送共用指示。內建繁中 Commit 範本只是可套用的起始內容，預設留空停用，不會把個人規範強加給其他安裝者。
- 目錄會從各 CLI 已存在的本機認證 metadata 讀取 Codex、Claude 與 Gemini 的帳號標籤及登入方式；Rust 只回傳非機密字串，access token、refresh token、API Key 與完整 JWT 都不會序列化到 WebView。
- 版本化內建 Adapter v1 仍可驗證並還原舊工作區中 Codex、Claude Code、Gemini CLI、Hermes Agent 與 Cursor Agent 的原生 Session 項目；介面不再要求使用者手動設定 Session ID。Codex 與 Cursor 的一般保存項目不寫入 Session ID，而是委由各 CLI 自己續接同目錄最近的對話；執行中分頁的「加開 CLI／帶入目前對話」則處理跨 CLI 脈絡接手。

### 舊工作區相容層：原生 Session 續接 Adapter v1

| CLI | 由 LatticeTerm 建立的參數 | 依據 |
| --- | --- | --- |
| Codex | `codex resume <SESSION_ID_OR_NAME>`；一般保存項目使用 `codex resume --last` | [OpenAI Codex CLI reference](https://developers.openai.com/codex/cli/reference/) |
| Claude Code | `claude --resume <SESSION_ID>` | [Anthropic CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage) |
| Gemini CLI | `gemini --resume <SESSION_UUID_OR_INDEX>` | [Gemini CLI session management](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/session-management.md) |
| Hermes Agent | `hermes --resume <SESSION_ID_OR_TITLE>` | [Hermes session guide](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/sessions.md) |
| Cursor Agent | `agent --resume <THREAD_ID>`；一般保存項目使用 `agent --continue` | [Cursor CLI using guide](https://cursor.com/docs/cli/using) |

Adapter 會把舊工作區的識別值當成單一 argument，不經 shell；長度上限 512 bytes，拒絕控制字元、前導 `-` 與額外啟動參數。這層保留是為了避免既有 `agent-workspaces.json` 在升級後失效，不代表目前介面仍提供手動續接設定。

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

Reporter 每次只傳一個最多 4 KiB 的 JSON 狀態或用量訊息。Registry 必須同時驗證 session ID 與權杖才會接受；用量事件另驗證來源 session、API request ID、每欄上限並以最近 4096 個 request ID 去重。它沒有終端輸入、程序啟動、檔案讀寫或任意命令能力。工具專用 Adapter 後續只需把各 CLI 的 hook 事件映射到四種狀態或有界 token buckets，不必取得 Tauri IPC 權限。

## 安全與生命週期

- 可執行檔與參數以分離的 argument vector 交給程序，不把使用者內容串成 shell 指令。
- 自訂名稱、路徑、參數數量、單一參數大小、終端尺寸與輸入事件大小都有上限與控制字元驗證。
- LatticeTerm 不讀取、不複製也不保存模型 API 金鑰；登入仍由各 CLI 自行處理。
- 安裝指令由內建目錄固定，參數分開傳入；執行前顯示完整指令並要求確認，下載與安裝輸出留在使用者可見的終端。LatticeTerm 不自動代填憑證，也不把遠端安裝腳本當成已簽章成品。
- CLI 以啟動 LatticeTerm 的使用者權限執行，不是沙箱。使用者只能加入自己信任的程式。
- 執行中的工作階段只存在記憶體，Rust registry 最多接受 32 個活躍 session；每個 PTY 保留最近 256 KiB 有界輸出與單調 byte offset，因此重播尾端總上限為 8 MiB。WebView 重新載入可重新 attach 並避免快照／即時事件重複。使用者停止或應用程式結束／重啟時仍會終止已登記的 CLI。
- 安全啟動工作區使用獨立的版本化 JSON；v4 可無損讀取 v1／v2／v3，並保存工作區名稱、共用啟動指示、項目順序、CLI 類型、標籤、可執行檔、明確參數、工作目錄與選填備註。原生 Session ID 或標題只在使用者明確保存續接項目時寫入；備註為選填的純文字（最多 200 bytes、去除前後空白、拒絕控制字元）。共用啟動指示最多 8 KiB，留空即停用。密碼、Token、API Key、Passphrase、Secret 參數會被拒絕；讀不到或版本不相容的原檔會先移到復原檔，不會直接覆寫。
- 除使用者明確保存的共用啟動指示外，不把單次提示、輸入歷史、程序 ID、Reporter 權杖或模型憑證寫入工作區 JSON。重新 attach 用的每個 Agent 最近 256 KiB 輸出尾端在正常關閉時會以裝置金鑰加密保存，金鑰只留在 OS 安全儲存區；安全儲存區不可用時維持只存在該桌面程序記憶體。
- Reporter 只監聽 loopback，訊息限制 4 KiB 且有讀寫逾時；每個工作階段使用獨立高熵權杖。權杖會存在該 CLI 的環境中，因此相同作業系統使用者權限的程序仍屬於信任邊界，但即使權杖外洩也只能變更該工作階段的顯示狀態與有界用量數字。
- Windows 偵測與啟動涵蓋 `.exe`／`.com`，以及 npm／pnpm／yarn 全域安裝常見的 `.cmd`／`.bat` shim（例如 `claude.cmd`）。因為 Windows 無法直接 `CreateProcess` 批次檔，`.cmd`／`.bat` 會自動透過 `cmd /c` 啟動，並先去掉 `canonicalize` 產生的 `\\?\` 前綴以免 cmd 無法解析。

## 完成度矩陣

| 能力 | 現況 | 說明 |
| --- | --- | --- |
| 多 CLI 原生 PTY | 已完成 | 可同時啟動多個獨立工作階段 |
| 內建目錄、PATH 偵測與安裝入口 | 已完成 | 13 種常見 CLI，可手動重新偵測；有平台固定指令時確認後開啟安裝終端，否則提供上游說明網址 |
| 自訂 CLI adapter | 相容保留 | 不再顯示新增表單；舊工作區仍會重新驗證後還原 |
| 統一終端分頁 | 已完成 | 與其他 LatticeTerm 連線工具共用工作區 |
| 分頁、CLI 與模型標示 | 已完成 | 分頁改名不會覆蓋 CLI 名稱；模型只顯示參數或 CLI 實際回報，無可靠值時明確標示 |
| 主動停止與退出清理 | 已完成 | 停止按鈕有確認，應用程式退出會清理 |
| 待輸入提醒 | 已完成 | 支援 heuristic，Adapter 可明確覆蓋 |
| CLI 語意 Reporter | 已完成 | loopback、每 session 權杖、四種狀態與來源標示 |
| 批次提示 | 已完成 | 明確選取、二次確認、最多 32 個目標與部分失敗回報 |
| 啟動工作區命名／排序 | 已完成 | 名稱與順序由 Rust 驗證及原子保存，v1 資料可相容遷移 |
| 原生 CLI Session 續接 | 相容保留 | 不再顯示手動設定；Adapter v1 僅供舊工作區還原 |
| 同程序介面重新 attach | 已完成 | 先訂閱事件再 hydration；session 關閉不會被舊快照復活，最近 256 KiB PTY 輸出依 offset 去重重播 |
| 工具專用語意 Adapter | 部分完成 | Codex `notify`、Claude Code、Gemini CLI、Hermes Agent、Qwen Code lifecycle hooks，以及 OpenCode、GitHub Copilot CLI plugin events 已接上 Reporter；Hermes 已提供 token buckets，舊工作區續接 recipe 與保守的 session ID 擷取仍保留，其他工具 hook、token 與 cost 擷取尚未完成 |
| 跨程序背景 daemon 與重新 attach | 未完成 | 關閉 LatticeTerm 後不保留工作階段；目前只支援同一桌面程序內的 WebView 重新 attach |
| 跨重啟還原 | 部分完成 | 已保存的 Codex 項目會續接同工作目錄最近的對話，Cursor 項目會使用 `agent --continue` 續接最近對話；正常關閉時，每個 Agent 最近 256 KiB 終端輸出會以 OS 安全儲存區中的裝置金鑰加密保存，重啟同一項目後先重播。若安全儲存區不可用就不落地輸出；原 PTY 程序與可互動 pane 仍無法跨程序存活 |
| 遠端 Agent Fleet | 未完成 | 尚未透過 SSH 或 Lattice Remote 控制遠端 PTY |
| 任務編排 | 部分完成 | broadcast prompt 已完成；依賴圖、佇列與排程仍待實作 |
| 權限隔離 | 未完成 | 尚無每 Agent 容器、沙箱或檔案範圍策略 |

## 下一階段設計

### 1. 語意 adapter

Reporter 傳輸與狀態模型已完成，Codex、Claude Code、Gemini CLI、OpenCode、GitHub Copilot CLI、Hermes Agent 與 Qwen Code 也已有工作階段限定的完成 hook／plugin event，Hermes 並已回報 token buckets。舊工作區相容層仍保留 Adapter v1 的五種原生 restore recipe，以及白名單 CLI 的保守 session ID 擷取，但目前介面不再提供手動續接區塊。下一步擴充其他工具的 hook 安裝方式，再依各上游實際事件加入 token／cost 等可觀測資料；未整合 CLI 繼續使用保守 heuristic，也可由工具 hook 呼叫通用 Reporter。

### 2. Lattice Agent daemon

將 PTY owner 從 Tauri 程序抽成使用者自行啟動的本機背景服務。桌面 UI 透過使用者專屬的 local socket attach，daemon 保存 workspace／tab／pane metadata，並使用 CLI 原生 session ID 還原。只有使用者明確選擇「留在背景」的工作階段才可脫離 UI。

### 3. 自建遠端 Fleet

Lattice Remote 現已能透過自架 Relay 端對端加密分享單一 shell PTY，但這只是通用純終端工作階段：它不認識 Agent Fleet 工作區、既有 CLI 程序、Reporter 或多 pane 狀態，不能宣稱為遠端 Fleet。真正的遠端 Fleet 仍須在目前裝置身分與 Relay transport 上建立獨立的 `terminal-control` capability、金鑰與授權畫面：

1. 被控端 Lattice Agent 預設只監聽 loopback。
2. 使用者明確啟用遠端 Agent Fleet，選擇可存取的工作目錄與操作範圍。
3. 控制端以一次性配對或已釘選裝置金鑰建立端對端加密控制通道。
4. 每個 PTY 使用獨立 multiplexed stream，控制訊息與終端資料有版本及大小上限。
5. Relay 只轉送密文；無人值守、檔案寫入與高風險指令要分開授權。

Fleet 整合仍宜先支援 SSH transport，因為主機信任、認證與 Tunnel 架構較成熟；已完成的 Lattice Remote 純終端 transport 可作為自建 Relay 與 NAT 環境的第二條路，但必須先補上工作區能力授權與多 PTY multiplexing。

### 4. 編排與可觀測性

安全啟動工作區、工作區命名／排序、明確確認的批次重新啟動與 broadcast prompt 已完成。下一步加入任務依賴、佇列、排程與資源限制。預設只保存狀態 metadata，不保存提示或終端逐字稿；任何錄製都必須由使用者明確開啟並設定保存位置。

## 驗收原則

- UI 顯示「可用」的能力必須有真實後端與測試。
- 各平台必須通過原生 PTY 啟動、輸入輸出、resize、停止與應用程式退出清理。
- 未安裝、立即退出、無權限、錯誤工作目錄與異常大量輸入都要回傳明確錯誤。
- 通用 Lattice Remote 已有固定配對碼無人值守；遠端 Agent Fleet 若要沿用，仍必須另行完成工作區／能力授權、撤銷、重放防護、稽核與 Relay 威脅模型，不得直接把固定碼視為完整團隊權限系統。
