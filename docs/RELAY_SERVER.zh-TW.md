# Lattice Remote 中繼伺服器（lattice-relay）

讓 Lattice Remote 做到「輸入九位數裝置 ID 就能連線」的自架服務。
被控端與檢視端都主動連到中繼站，由它把兩條連線接起來；NAT 後的機器
因此不需要開 port 或設定轉發。

## 安全邊界

- 中繼站**只轉送密文**。畫面、終端、輸入與檔案全程使用兩端之間的
  Noise（XXpsk3）端對端加密，配對碼從不經過伺服器。
- 伺服器磁碟上只有「裝置 ID → 註冊 token 的雜湊」。即使整台被拿走，
  也無法冒充裝置或解開任何工作階段。
- 公網入口必須使用 `wss://`，由 HTTPS 保護裝置註冊與尋址控制訊息。
  原生 TCP 沒有 TLS，只能放在可信任的私有網路或 VPN；畫面工作階段本身
  無論走哪種載體都仍由 Noise 端對端加密。
- 裝置 ID 由第一次註冊的 token 綁定，其他機器無法搶註同一組號碼。
  Agent 本機的永久身分檔包含註冊 token 與 Noise 私鑰，Unix 上會在建立
  與載入時強制修正為擁有者限定的 `0600`；不要把它放進同步空間或備份給
  其他使用者。
- 檢視端第一次連上某個裝置 ID 時會釘選該裝置的永久身分金鑰
  （trust-on-first-use）；之後金鑰不符會直接拒連，即使中繼站被
  掉包或有人搶到同號也冒充不了。裝置重灌後需在檢視端的
  `remote-device-pins.json` 移除該筆再連。
- 每個來源 IP 每分鐘最多 30 條新連線，阻擋透過中繼站暴力嘗試配對碼或
  掃描裝置 ID。直連的來源在 WebSocket 握手前就先檢查，被擋下的連線買不到
  HTTP 解析工作。
- 預設情況下 loopback 的連線不受此限——經 HTTPS/WSS ingress 轉送時所有
  公網流量的來源都是 127.0.0.1，共用同一個額度反而會互相卡死。代價是
  **這個限速對公網流量完全沒有作用**。加上 `--client-ip-header` 指定
  ingress 寫入真實來源的標頭（Cloudflare 是 `Cf-Connecting-Ip`，nginx
  常用 `X-Real-Ip`），loopback 連線就改記在該位址名下，限速重新涵蓋公網。
  沒開這個選項時，公網的來源限速必須在 ingress 另外設定（例如 Cloudflare
  WAF／Rate Limiting、nginx `limit_req` 或等效閘道能力），不能把 loopback
  豁免誤認成已有公網保護。
- `--client-ip-header` 只信任 loopback 對端送來的該標頭：直接連到這個
  port 的人送什麼都會被忽略，不能自己挑要花哪個額度。前提是前面的代理
  **覆寫**該標頭而不是把客戶端送的值接在前面；relay 取最後一個值，所以
  會附加的代理也安全，但完全不設該標頭的代理就等於沒開。標頭讀不出位址
  時該連線維持豁免，不會被記到猜出來的額度上。
- 中繼位址**不是機密**：兩端必須知道它，DNS、TLS 連線與本機設定也能看見。
  LatticeTerm 在成功保存後只顯示「使用已儲存的中繼伺服器」，是降低日常
  操作雜訊，不是以隱藏網址取代加密、認證或入口防護。

## 目前服務範圍

目前 `lattice-relay` 適合個人或小型可信任團隊自架，不是可直接開放大眾註冊
的多租戶 SaaS。它尚未提供帳戶／組織 ACL、裝置擁有權管理、管理員稽核、
每租戶配額、頻寬計費、封鎖清單、高可用或水平擴充協調。公開 WSS 位址上的
任何人都能送出連線與查找請求；真正建立工作階段仍需正確的八位數配對碼與
相符的裝置金鑰，但營運者仍須在入口加上限速、連線數上限、監控與告警。

每台 Agent 同時只服務一位檢視端；中繼會雙向逐位元組轉送畫面、終端與檔案
流量，因此頻寬約等於所有進行中工作階段的總和，檔案上下載與高 FPS 畫面會
是主要流量，CPU 通常以 WSS 入口的 TLS 與連線管理為主。若要開放很多不互信
使用者，應先補齊上述租戶隔離與營運控制，不能只增加 VM 的 CPU／記憶體。

## 部署

```bash
scripts/deploy-relay.sh user@your-server [ssh-port]
```

腳本會在伺服器上安裝 Rust（若沒有）、編譯 `lattice-relay`、建立
`lattice-relay` 系統使用者與 systemd 服務，並安全地只監聽
`127.0.0.1:44910`。重跑同一指令即可升級；另以 Cloudflare Tunnel、
nginx 或 Caddy 把 HTTPS/WebSocket 入口轉送到這個位址。

手動操作時的關鍵指令：

```bash
cargo build --release --features relay-server --bin lattice-relay \
  --manifest-path crates/lattice-remote/Cargo.toml
lattice-relay --bind 127.0.0.1:44910 --state /var/lib/lattice-relay/devices.json \
  --client-ip-header Cf-Connecting-Ip
```

`--client-ip-header` 依前面的 ingress 而定：Cloudflare 用
`Cf-Connecting-Ip`，nginx 用你在 `proxy_set_header` 設的名稱（常見是
`X-Real-Ip`）。不確定前面會不會覆寫該標頭就先不要加，改在 ingress 做限速。

### 免費 Cloudflare Quick Tunnel

Relay 啟動後，在同一台機器執行：

```bash
cloudflared tunnel --url http://127.0.0.1:44910 --no-autoupdate
```

`cloudflared` 印出的 `https://隨機名稱.trycloudflare.com` 要在 LatticeTerm
填成 `wss://隨機名稱.trycloudflare.com`。Quick Tunnel 免費且不需要網域，
但程序每次重啟網址都會改，而且是 Cloudflare 定位為測試用途、沒有 SLA 的
臨時入口。`trycloudflare.com` 不是自己的網域，掛不上 WAF／Rate Limiting，
所以入口端補不了限速；relay 這邊請務必啟動時加上

```bash
lattice-relay --bind 127.0.0.1:44910 \
  --state /var/lib/lattice-relay/devices.json \
  --client-ip-header Cf-Connecting-Ip
```

否則所有公網流量都是 loopback，內建的每 IP 限速一條都用不到。即使如此，
Quick Tunnel 仍只適合自己測試，不應作為對外多人服務。要固定網址與可控的
入口政策，需使用掛在自己網域下的 named tunnel 或自行管理 nginx／Caddy。
Cloudflare 的限制以
[Quick Tunnel 官方文件](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)
為準。

## 用戶端設定

- **被分享端**：「分享這台裝置」→ 分享方式選「透過中繼伺服器」，
  公網填入 `wss://你的伺服器`，私有網路可填 `你的伺服器:44910`。
  啟動後畫面會顯示永久的九位數裝置 ID 與
  配對碼；配對碼可自訂為固定八位數（無人值守用），或每次分享自動產生。
- **檢視端**：右上角「以 ID 連線」，輸入對方的裝置 ID、配對碼與同一台
  中繼伺服器位址即可。第一次成功使用後，位址會保存在這個安裝的前端本機
  儲存區，之後分享與連線畫面只顯示已儲存狀態；按「修改」仍可查看或更換。
- 連線成功的裝置會留在「我的連線」，之後從清單連線只需要輸入配對碼，
  不必再重打九位數與中繼位址。**配對碼是一次性密碼，不會被保存**。
  這筆記錄存的是裝置 ID 與中繼位址：兩者都不是機密，和其他連線設定檔
  一樣可以命名、分組、標籤與匯出。同一個裝置換到別的中繼位址時，
  下次連上會就地更新，不會多出一筆；你自己改過的名稱不會被覆蓋。
- **無畫面的純文字主機**（沒有桌面環境的伺服器）：在該機器上執行
  `lattice-agent --relay wss://你的伺服器 --terminal --allow-input`，
  分享的是加密的 shell 終端機而不是畫面；檢視端一樣用裝置 ID＋配對碼
  連線，開啟的會是終端分頁。不加 `--allow-input` 則對方只能看不能打字；
  `--file-root` 檔案分享照常可用。
- **無人值守（固定配對碼）**：桌面內嵌分享不會保存固定碼，並以 stdin
  交給 Agent；獨立常駐服務應把八位數碼放在只有服務帳號可讀的檔案，改用
  `--pair-code-file`，避免秘密出現在程序清單。先在 Agent 帳號下建立檔案：

  ```bash
  install -d -m 700 ~/.config/lattice-agent
  read -rsp '固定八位數配對碼：' pair_code; printf '\n'
  (umask 077; printf '%s\n' "$pair_code" > ~/.config/lattice-agent/pair-code)
  unset pair_code
  ```

  然後常駐啟動 headless 主機：

  ```bash
  lattice-agent --relay wss://你的伺服器 --terminal --allow-input \
    --pair-code-file ~/.config/lattice-agent/pair-code \
    --file-root ~/LatticeTermShare
  ```

  `--file-root` 請指向專用交換資料夾，不要直接分享整個家目錄。連續五次
  配對失敗後 Agent 會正常停止；systemd 不要使用 `Restart=always`，否則會
  立即重啟並重設失敗次數。命令列 `--pair-code 12345678` 仍可供臨時手動
  測試，但值可能被其他本機使用者從程序參數看見，不適合常駐服務。

## 協定摘要

單一監聽連接埠（預設 44910）同時接受原生 TCP 與 WebSocket upgrade；
兩種載體內都是 `u32` big-endian 長度前綴的 JSON 控制訊息：

| 訊息 | 方向 | 作用 |
| --- | --- | --- |
| `register` | agent → relay | 以 deviceId + authToken 註冊並保持連線收邀請 |
| `invite` | relay → agent | 有檢視端要連入，附 channelId |
| `join` | agent → relay | 開新連線回應邀請 |
| `dial` | viewer → relay | 以 deviceId 找裝置 |
| `linked` | relay → 雙方 | 之後所有位元組盲目互轉 |
| `ping` / `pong` | 雙向 | 控制連線保活（25 秒） |

`linked` 之後即為既有的 Lattice Remote 加密協定，與直連模式完全相同。
