# Lattice Remote 中繼伺服器（lattice-relay）

讓 Lattice Remote 做到「輸入九位數裝置 ID 就能連線」的自架服務。
被控端與檢視端都主動連到中繼站，由它把兩條連線接起來；NAT 後的機器
因此不需要開 port 或設定轉發。

## 安全邊界

- 中繼站**只轉送密文**。畫面、輸入與檔案全程使用兩端之間的
  Noise（XXpsk3）端對端加密，配對碼從不經過伺服器。
- 伺服器磁碟上只有「裝置 ID → 註冊 token 的雜湊」。即使整台被拿走，
  也無法冒充裝置或解開任何工作階段。
- 公網入口必須使用 `wss://`，由 HTTPS 保護裝置註冊與尋址控制訊息。
  原生 TCP 沒有 TLS，只能放在可信任的私有網路或 VPN；畫面工作階段本身
  無論走哪種載體都仍由 Noise 端對端加密。
- 裝置 ID 由第一次註冊的 token 綁定，其他機器無法搶註同一組號碼。
- 檢視端第一次連上某個裝置 ID 時會釘選該裝置的永久身分金鑰
  （trust-on-first-use）；之後金鑰不符會直接拒連，即使中繼站被
  掉包或有人搶到同號也冒充不了。裝置重灌後需在檢視端的
  `remote-device-pins.json` 移除該筆再連。
- 每個來源 IP 每分鐘最多 30 條新連線，阻擋透過中繼站暴力嘗試
  配對碼或掃描裝置 ID。

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
lattice-relay --bind 127.0.0.1:44910 --state /var/lib/lattice-relay/devices.json
```

### 免費 Cloudflare Quick Tunnel

Relay 啟動後，在同一台機器執行：

```bash
cloudflared tunnel --url http://127.0.0.1:44910 --no-autoupdate
```

`cloudflared` 印出的 `https://隨機名稱.trycloudflare.com` 要在 LatticeTerm
填成 `wss://隨機名稱.trycloudflare.com`。Quick Tunnel 免費且不需要網域，
但程序每次重啟網址都會改；要固定網址仍需 Cloudflare 上的網域與 named tunnel。

## 用戶端設定

- **被分享端**：「分享這台裝置」→ 分享方式選「透過中繼伺服器」，
  公網填入 `wss://你的伺服器`，私有網路可填 `你的伺服器:44910`。
  啟動後畫面會顯示永久的九位數裝置 ID 與
  配對碼；配對碼可自訂為固定八位數（無人值守用），或每次分享自動產生。
- **檢視端**：右上角「以 ID 連線」，輸入對方的裝置 ID、配對碼與同一台
  中繼伺服器位址即可。

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
