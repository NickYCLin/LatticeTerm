# 更新日誌 (Changelog)

本專案遵循語意化版本（Semantic Versioning）發布，所有更新內容均以繁體中文條列說明。

---

## [0.29.0](https://github.com/NickYCLin/lattice-term/compare/v0.28.0...v0.29.0) (2026-08-28)


### 🚀 新增功能

* **Agent Fleet:** 一般啟動的保存項目也能加備註 ([7580140](https://github.com/NickYCLin/lattice-term/commit/75801404a90c77b9120c7ecd3e9b48c403cdd557))
* **Agent Fleet:** 保存續接項目可以加備註 ([0291b26](https://github.com/NickYCLin/lattice-term/commit/0291b26b4f8528a470abc109dc0d7eea386fe440))
* **Agent Fleet:** 加開 CLI 可帶入目前對話，讓新 CLI 接續脈絡 ([810d2a0](https://github.com/NickYCLin/lattice-term/commit/810d2a03ba68847ad6b0c4df3990b7622a5cb756))
* **Agent Fleet:** 同一分頁掛多個 CLI，一鍵切換、都保持在跑 ([2dfb1b0](https://github.com/NickYCLin/lattice-term/commit/2dfb1b0148e465597325f79255e0612fffc4be88))
* **Agent Fleet:** 執行中的分頁可以就地改名 ([f28f546](https://github.com/NickYCLin/lattice-term/commit/f28f546b5da598d268bdaded4e9ee1759064d947))
* **Agent Fleet:** 補上 CLI 安裝與模型資訊 ([0d7b72a](https://github.com/NickYCLin/lattice-term/commit/0d7b72aa55112264bb8a6f4aa2fdd25bf3094e55))
* **agent:** CLI 印出的 Session ID 會自動抓下來，續接不用再自己翻 ([e017ccb](https://github.com/NickYCLin/lattice-term/commit/e017ccb3a9aee4c09ce448e6da0fb13b8c14510a))
* **agents:** 支援透過 Remote 交付檔案 ([dfc06aa](https://github.com/NickYCLin/lattice-term/commit/dfc06aaf144ac820514df2c797e367856563c063))
* **agents:** 顯示 Remote 檔案傳送進度 ([ba37426](https://github.com/NickYCLin/lattice-term/commit/ba3742692586fecd38cb24ec0152ae96abddd972))
* **agent:** 加入 AI Agent Fleet 操作介面 ([ca7969b](https://github.com/NickYCLin/lattice-term/commit/ca7969b73d7025a53598edad797dd89ef469da04))
* **agent:** 加入原生工作階段續接 Adapter ([4f725ba](https://github.com/NickYCLin/lattice-term/commit/4f725ba03e14426a772508cd31c1b61d89a02310))
* **agent:** 加入安全批次提示傳輸 ([fcaaf4c](https://github.com/NickYCLin/lattice-term/commit/fcaaf4cfbe317be74a9a5f5bb47102fe466175e6))
* **agent:** 加入安全啟動工作區儲存 ([68a6afe](https://github.com/NickYCLin/lattice-term/commit/68a6afe60d5325b8b381fd39d5e26babfae8d93a))
* **agent:** 加入安全語意狀態回報器 ([523f54b](https://github.com/NickYCLin/lattice-term/commit/523f54b4249798c03c6dea6f640a4d5a064aaf25))
* **agent:** 加入工作區命名與排序介面 ([afc5c7a](https://github.com/NickYCLin/lattice-term/commit/afc5c7acd6e8b98fb1e85cc22b6e4972b252ac15))
* **agent:** 加入批次提示操作介面 ([7d9c714](https://github.com/NickYCLin/lattice-term/commit/7d9c7143e74328063a8901b7b6cd5b880e6ff6c1))
* **agent:** 加入啟動工作區操作介面 ([1302bf8](https://github.com/NickYCLin/lattice-term/commit/1302bf8169115a2b17c9c946d3d24dd7889e0d77))
* **agent:** 合併跨重啟安全啟動工作區 ([#20](https://github.com/NickYCLin/lattice-term/issues/20)) ([b3a32c0](https://github.com/NickYCLin/lattice-term/commit/b3a32c06540ea651a30beabd770f4f1a673ebd1e))
* **agent:** 完善 CLI 安裝與模型偵測 ([36deedb](https://github.com/NickYCLin/lattice-term/commit/36deedb99c5063098ee0cc5966c363891b22f099))
* **agent:** 建立本機多 CLI PTY 執行核心 ([5bdcfb8](https://github.com/NickYCLin/lattice-term/commit/5bdcfb8477d6018606dacbe59e7b4eb21e32e81b))
* **agent:** 支援啟動工作區名稱與排序儲存 ([1a17df7](https://github.com/NickYCLin/lattice-term/commit/1a17df78528df23852b1ad0180951f1d9b465abc))
* **agent:** 新增原生 Session 續接介面 ([bb757da](https://github.com/NickYCLin/lattice-term/commit/bb757da1b4411d8198e41987a572a368cc61ebdd))
* **agent:** 顯示 Adapter 語意狀態來源 ([f75ac4f](https://github.com/NickYCLin/lattice-term/commit/f75ac4fb9e58061c1b744160a2fd081fb05e934f))
* **app:** 完善工作階段與桌面使用體驗 ([6afbcdd](https://github.com/NickYCLin/lattice-term/commit/6afbcdd7daff842ea58a7774cbdee3540cad6ae0))
* **connections:** 改版新增連結流程 ([0dd7246](https://github.com/NickYCLin/lattice-term/commit/0dd72460837d484c3c96dd92d26d0c4416a91ceb))
* **remote:** 以裝置 ID 經自架中繼連線 ([7c12190](https://github.com/NickYCLin/lattice-term/commit/7c12190786291155201f82d02b092a13a79b2c8a))
* **remote:** 支援以 WSS 穿越 HTTPS 中繼入口 ([8157a4f](https://github.com/NickYCLin/lattice-term/commit/8157a4f5bd7cc183e7ef3772c5f941f954b96381))
* **remote:** 日常連線不再顯示中繼位址 ([0d0fd75](https://github.com/NickYCLin/lattice-term/commit/0d0fd75314e044d0a21b0f2a08648554b63a63e7))
* **remote:** 純文字主機支援終端分享模式 ([b9116bd](https://github.com/NickYCLin/lattice-term/commit/b9116bd4aaafc64dedcf8b430145fee8e68206ef))
* **remote:** 釘選裝置金鑰並限制中繼撥號頻率 ([403a5d8](https://github.com/NickYCLin/lattice-term/commit/403a5d898bf6ed6bdc3abff21b17610f09a6e611))
* **sftp:** 加入檔案瀏覽與傳輸工作區 ([5ae0472](https://github.com/NickYCLin/lattice-term/commit/5ae0472cefbb8b36a9b616c294d696dbe563d163))
* **sftp:** 合併安全檔案傳輸工作區 ([#13](https://github.com/NickYCLin/lattice-term/issues/13)) ([e5426e4](https://github.com/NickYCLin/lattice-term/commit/e5426e4fbfe955d0daa4b96db4779ba6af667b5b))
* **SFTP:** 大檔案改用串流佇列，32MB 上限拿掉了 ([018cbeb](https://github.com/NickYCLin/lattice-term/commit/018cbebf49ada3bbc470120551d8580c06e5a806))
* **sftp:** 建立安全檔案傳輸後端 ([d23394c](https://github.com/NickYCLin/lattice-term/commit/d23394c1cba1408cd6dcdf40074e218e12475386))
* **SFTP:** 檔案總管支援拖曳上傳 ([0828167](https://github.com/NickYCLin/lattice-term/commit/082816758c01d6eebf925092480e06a411877beb))
* **SSH:** SSH 分頁旁邊直接開檔案總管，可拖曳上傳／下載 ([00dacd8](https://github.com/NickYCLin/lattice-term/commit/00dacd828bf0d53b3b61e8bbadc9e2a151c188e3))
* **SSH:** 從 SSH 分頁一鍵開啟 SFTP 檔案總管 ([3bc1aa8](https://github.com/NickYCLin/lattice-term/commit/3bc1aa886db6b17abaea52ea171a9345584fa670))
* **terminal:** 終端支援右鍵複製與貼上 ([8e5b381](https://github.com/NickYCLin/lattice-term/commit/8e5b3817476059780269e26d7f17f886f17e6ced))
* **VNC:** VNC 可以用了，順手修掉切換視圖後工作階段變空白的問題 ([1ea852e](https://github.com/NickYCLin/lattice-term/commit/1ea852ed7d080b659a6d33298ff3ee45569bed02))
* **workspace:** 加入搜尋與精簡狀態提示 ([87ad71b](https://github.com/NickYCLin/lattice-term/commit/87ad71b3e4e05397f41a0f5cd4637504cb72b2cb))
* **workspace:** 加密還原 Agent 終端輸出 ([70372f0](https://github.com/NickYCLin/lattice-term/commit/70372f0da102f063c04b07b8cbf8c311904d4f19))
* **workspace:** 完善工作階段整理與操作體驗 ([d42da3e](https://github.com/NickYCLin/lattice-term/commit/d42da3ef443dbd75ba3dfb2aee21a270bf8e0073))
* **workspace:** 支援選擇資料夾啟動 CLI ([9af2bb5](https://github.com/NickYCLin/lattice-term/commit/9af2bb55a189561b0e4a4963b70691672a304730))
* **workspace:** 標題列同時顯示工作階段與目前 CLI ([8250492](https://github.com/NickYCLin/lattice-term/commit/825049225761d2ece7071598c6f9f094c525b13b))
* **workspace:** 補齊工作階段整理、移轉與完成通知 ([08b35a2](https://github.com/NickYCLin/lattice-term/commit/08b35a2e68d5b5091a1e65c4702a4ae3afc446bd))
* **workspace:** 還原並分組工作階段 ([fd57961](https://github.com/NickYCLin/lattice-term/commit/fd579610671dde6a5a161a8da3e818b36f7b03c9))
* **workspace:** 顯示各 CLI 即時狀態並支援快速對話 ([cbabb7e](https://github.com/NickYCLin/lattice-term/commit/cbabb7e1b4f4ee29ce07513ce7baaff2c58b2735))
* **代理:** 支援同程序工作階段重新連接 ([76d0560](https://github.com/NickYCLin/lattice-term/commit/76d0560f9603bd2be11f061be6a41a313e1cf545))
* **保管庫:** 加入閒置與背景自動鎖定 ([fd0375d](https://github.com/NickYCLin/lattice-term/commit/fd0375d0ea67e0029a52d7e8213239727717febe))
* **保管庫:** 加密保管庫上線，密碼多了一個不靠作業系統的家 ([53046d3](https://github.com/NickYCLin/lattice-term/commit/53046d3501f77cbadff3f0721ecc8c37193bd800))
* **備份:** 加入完整工作區加密匯出與還原 ([fc36800](https://github.com/NickYCLin/lattice-term/commit/fc36800c2c97ee1004ddbfdb3ab58bc6a38dd035))
* **安全:** 使用系統認證儲存保存 SSH 與 RDP 密碼 ([bdc11a1](https://github.com/NickYCLin/lattice-term/commit/bdc11a141f895bcfd81544e1909ac9a0ebe5f960))
* **安全性:** 加入敏感剪貼簿自動清除 ([3e8e185](https://github.com/NickYCLin/lattice-term/commit/3e8e185495e26648afe633e15bb02cf7db4f2222))
* 整合 Lattice Remote 主機分享模式 ([2a5d9bb](https://github.com/NickYCLin/lattice-term/commit/2a5d9bb9ebce9bf157c9c70ee313d005cf9b8691))
* 新增遠端桌面與主機信任管理 ([0bc8cf0](https://github.com/NickYCLin/lattice-term/commit/0bc8cf0df10ce19231d4548dde676af0e6868645))
* 新增遠端畫面截圖與錄影 ([4859158](https://github.com/NickYCLin/lattice-term/commit/4859158838afc9a06795afdc7ddabe009711d269))
* **更新:** 啟用已簽章的自動更新流程 ([7e13001](https://github.com/NickYCLin/lattice-term/commit/7e13001a8e7f9048060a87dfae3ce4a76ab708be))
* **更新:** 開啟程式時自動偵測新版本並跳出更新提示 ([83d6515](https://github.com/NickYCLin/lattice-term/commit/83d651523bc7a4a55a2ca69d2d62355905a2dad3))
* **發布:** 自動判定版本並產生跨平台發行版 ([c9aaac0](https://github.com/NickYCLin/lattice-term/commit/c9aaac03d61f99cb162a4c99cdfc701723d30d0f))
* **監控:** 連線後真的能看到主機的 CPU、記憶體、硬碟了 ([593eac5](https://github.com/NickYCLin/lattice-term/commit/593eac512f3b662f79e30584e85fcdad7fdfbda8))
* **終端機:** 支援 Ctrl+C 複製 / Ctrl+V 貼上，本機 CLI 可貼圖 ([672cba4](https://github.com/NickYCLin/lattice-term/commit/672cba4aad9feadee97a801a3bdb79c205b3180b))
* **行動版:** Android 版能跑了 ([1ac6975](https://github.com/NickYCLin/lattice-term/commit/1ac6975862666db57b70f4aa8cb26023e340e5d8))
* **行動版:** 一個 QR 掃碼自動辨識手機下載，並建置發布 Android APK ([672db00](https://github.com/NickYCLin/lattice-term/commit/672db00f3c4e0203e712c9423fc46507878a1ddb))
* **通道:** 實作原生 SSH 通道轉發與 SOCKS5 動態代理管理視圖 ([6f07cf1](https://github.com/NickYCLin/lattice-term/commit/6f07cf1b2bdd6dd32f631f2ae76c2f5f75fb5018))
* **連線:** 支援用 SSH 私鑰登入，不用再只能打密碼 ([6f02cda](https://github.com/NickYCLin/lattice-term/commit/6f02cda9c358b14e49b5de1e26dca5f96e3b6134))
* **遠端:** Lattice Remote 加上遠端滑鼠鍵盤控制 ([20cb5cc](https://github.com/NickYCLin/lattice-term/commit/20cb5ccb2e76856c0c327dd1922e7e3ecbd22301))
* **遠端:** 支援主機檔案瀏覽與傳輸 ([#69](https://github.com/NickYCLin/lattice-term/issues/69)) ([87606ae](https://github.com/NickYCLin/lattice-term/commit/87606ae7ff29f3c06f8661c3bdc5b6504dce974f))
* **遠端:** 整合 Lattice Remote 主機分享與 Web RDP 擷取 ([8ad3eb3](https://github.com/NickYCLin/lattice-term/commit/8ad3eb3e8cf261c9442e85b57bbae9702cc71f09))


### 🛠️ 問題修正

* **Agent Fleet:** 偵測得到 Windows 的 .cmd/.bat 版 CLI（例如 npm 裝的 Claude Code） ([aa70459](https://github.com/NickYCLin/lattice-term/commit/aa704592e3f75a38a88e58977591cc056c649a0a))
* **agents:** 修正 Gemini 個人帳號啟動流程 ([648ee6e](https://github.com/NickYCLin/lattice-term/commit/648ee6e7690ad101a140ef00e78cd666b322d993))
* **agent:** 偵測到的執行檔路徑去除 \\?\ 前綴 ([bfef6a4](https://github.com/NickYCLin/lattice-term/commit/bfef6a42cfac2ab3f268d895fe708678f1bfde35))
* **agent:** 模型切換即時更新、工作目錄去除 \\?\ 前綴 ([687aa06](https://github.com/NickYCLin/lattice-term/commit/687aa06c1903d57d444f217a21859fae103134fd))
* **agent:** 結束應用程式時停止所有 CLI ([088ff8a](https://github.com/NickYCLin/lattice-term/commit/088ff8a98217abb8588ab677458fbf9cd4ddb487))
* **agent:** 驗證磁碟中的工作區名稱 ([0572737](https://github.com/NickYCLin/lattice-term/commit/0572737be2f168e70b6b2c928893c2913d724afa))
* **ci:** 在 Rust 驗證前建置遠端 sidecar ([7f837bc](https://github.com/NickYCLin/lattice-term/commit/7f837bc8949fbcb0d2d26c1b83e2b252256befcb))
* **ci:** 在測試前建置桌面 sidecar ([ed88c41](https://github.com/NickYCLin/lattice-term/commit/ed88c415f1fe1ba5465338148b063fcbfc24249a))
* **deploy:** 部署腳本處理改綁 localhost 的舊環境 ([2ab64fd](https://github.com/NickYCLin/lattice-term/commit/2ab64fd7d13114655433f3ab15704d7e09491005))
* **Linux:** 修正 NVIDIA X11 啟動黑畫面 ([8e1920c](https://github.com/NickYCLin/lattice-term/commit/8e1920c5048349e6e88a435331959519ef5b5d5a))
* **macOS:** 相容遠端控制 Insert 鍵 ([e7e4328](https://github.com/NickYCLin/lattice-term/commit/e7e4328c155c913a71dd2312b5641cee32178ea2))
* **notifications:** 避免漏掉 CLI 完成提示音 ([ffd5737](https://github.com/NickYCLin/lattice-term/commit/ffd5737a5b522b95d20cbca2da6c82b4e2a0d717))
* **RDP:** 修正遠端畫面色彩通道 ([8a43683](https://github.com/NickYCLin/lattice-term/commit/8a436839e41b76cbf96d18bbd4a9b1e8c0682669))
* **RDP:** 區分憑證拒絕與連線失敗 ([740e75f](https://github.com/NickYCLin/lattice-term/commit/740e75f09e67ab7e5aac22722460043846fbf260))
* **relay:** 握手前先限流並豁免 loopback ([22e5ba1](https://github.com/NickYCLin/lattice-term/commit/22e5ba1308a581a03533ba54f9da1ee2301500c2))
* **remote:** 依 clippy 改用 is_multiple_of 檢查十六進位長度 ([d87484e](https://github.com/NickYCLin/lattice-term/commit/d87484e0ad2b12444ee80229a5013f4af014b0a5))
* **remote:** 保護裝置身分與固定配對碼 ([e2e5ccf](https://github.com/NickYCLin/lattice-term/commit/e2e5ccfd65dd8f2b6031bff68e88d3d8c576fbce))
* **remote:** 限制中繼登錄檔權限 ([#79](https://github.com/NickYCLin/lattice-term/issues/79)) ([61dd840](https://github.com/NickYCLin/lattice-term/commit/61dd840a62421c4fb74f356f3759f8b5b252d033))
* **sessions:** 支援從側欄移除工作階段 ([77d5b26](https://github.com/NickYCLin/lattice-term/commit/77d5b261699918889427b4122b5b0adc67e972e9))
* **SFTP:** 保護串流覆寫的原始檔案 ([835a4c5](https://github.com/NickYCLin/lattice-term/commit/835a4c5bf73ae67790eb95ed34b9811e2190d69d))
* **SFTP:** 修正傳輸清除狀態同步 ([e4284c9](https://github.com/NickYCLin/lattice-term/commit/e4284c9baf6bbdb08f299d05390585f662953fd9))
* **SFTP:** 修正拖曳上傳完成狀態 ([e7f3a5f](https://github.com/NickYCLin/lattice-term/commit/e7f3a5ff9cb97021a588c2d97a8373ee2103cc1e))
* **SFTP:** 防止變動中的拖曳檔案被發布 ([b1e8484](https://github.com/NickYCLin/lattice-term/commit/b1e8484423d2dc99eb9c617a6cc205ca3efc765e))
* **sftp:** 阻擋未確認的同名檔案覆寫 ([0ddf961](https://github.com/NickYCLin/lattice-term/commit/0ddf961a93939eabaf4360b7da9242269d0b0908))
* **SSH:** 檔案總管改緊湊，日期不再折成三行、窄側欄自動精簡欄位 ([c4cbb28](https://github.com/NickYCLin/lattice-term/commit/c4cbb28fee49437daef9178b241749057bf5ba49))
* **terminal:** 支援 Linux CLI 貼上剪貼簿圖片 ([f118de2](https://github.com/NickYCLin/lattice-term/commit/f118de26be34af60c312329be312dba9f1ae7aa1))
* **ui:** 由建置資訊同步顯示版號 ([c308f49](https://github.com/NickYCLin/lattice-term/commit/c308f497ee12b6bc01d10136c7404524470d6dbc))
* **VNC:** 相容新版 Clippy 像素分塊檢查 ([6ba52de](https://github.com/NickYCLin/lattice-term/commit/6ba52ded7af68f6620332a8074b323dd97059601))
* **VNC:** 補發新版 Rust 像素分塊相容修正 ([73a3155](https://github.com/NickYCLin/lattice-term/commit/73a3155415c2109d315d9e1bab3ad554bb93607c))
* **VNC:** 防止畫面越界與遠端輸入卡住 ([253aeb4](https://github.com/NickYCLin/lattice-term/commit/253aeb4dba8d697e0394684877b5cf0b7306d37e))
* **workspace:** SSH 分頁自動顯示檔案側欄與主機資源 ([ecc6d3c](https://github.com/NickYCLin/lattice-term/commit/ecc6d3c07cddf1c1b135c638a5c011446f6aa9e7))
* **workspace:** 修正工作階段搬移與完成提示音 ([7593414](https://github.com/NickYCLin/lattice-term/commit/7593414473824f5c3cee1a2db1b0320305ec40d6))
* **workspace:** 修正工作階段整理與桌面互動 ([720f96d](https://github.com/NickYCLin/lattice-term/commit/720f96ddbf2011cb7e1af417246bc5ece7c025df))
* **workspace:** 側欄拖曳改用指標事件 ([525fa1e](https://github.com/NickYCLin/lattice-term/commit/525fa1e8f9f9d32d936397f24a437de639c903de))
* **介面:** 修掉四個藏在細節裡的問題 ([2dae9d3](https://github.com/NickYCLin/lattice-term/commit/2dae9d32f715f3f9460f7850feef9a466b8dad9e))
* **介面:** 修正停用確認動作時的對話框焦點 ([cd95138](https://github.com/NickYCLin/lattice-term/commit/cd9513826d4d3b65ec37d5559a6ba5f87baf78d5))
* **介面:** 修正設定操作狀態與翻譯熱更新 ([9bae4c1](https://github.com/NickYCLin/lattice-term/commit/9bae4c1c5914cbdae69802470c67dd707d5cbf5d))
* **介面:** 強化停用按鈕的視覺狀態 ([07f76ba](https://github.com/NickYCLin/lattice-term/commit/07f76ba06e7bd7611356153a6a38abe1b3df70ad))
* **代理:** 關閉工作階段時終止程序群組 ([d12e53d](https://github.com/NickYCLin/lattice-term/commit/d12e53d92e600d3ba841891cfa66581d4ee7a877))
* **儲存:** 確保批次匯入採用原子寫入 ([842c8fe](https://github.com/NickYCLin/lattice-term/commit/842c8fe96193a8971a6f23db2937439dbb0c122d))
* **分頁:** 避免背景工作階段關閉切換目前分頁 ([80e9905](https://github.com/NickYCLin/lattice-term/commit/80e9905b73658179c3a1d405eb497e14f384009a))
* **執行環境:** 阻止瀏覽器預覽誤觸桌面後端 ([7a8d0b8](https://github.com/NickYCLin/lattice-term/commit/7a8d0b81178830345a8b100bb5d886883c7a842c))
* **安全:** 允許瀏覽器預覽刪除連線設定 ([c10e86b](https://github.com/NickYCLin/lattice-term/commit/c10e86bd29480a6f896e928bf6810e906ed924b5))
* **工作階段:** 保留 Agent 與 SSH 非預期中斷原因 ([a338099](https://github.com/NickYCLin/lattice-term/commit/a33809968f47977464d4afd8615ec3a072c8ac13))
* **工作階段:** 重載後恢復現有連線 ([0b3cfcf](https://github.com/NickYCLin/lattice-term/commit/0b3cfcfdf4ec8668929b3df83167c09d8ca83676))
* 明確解參考 RDP 子程序輸入鎖 ([acd5899](https://github.com/NickYCLin/lattice-term/commit/acd5899e861117ce54f233a253180041e3ad38ed))
* **更新:** 修好「有下載卻沒安裝」，更新改成全自動不跳安裝視窗 ([69f53c3](https://github.com/NickYCLin/lattice-term/commit/69f53c3faa0747310c3b350c36782f4ba928a428))
* **更新:** 安裝完成後自動重新啟動 ([#37](https://github.com/NickYCLin/lattice-term/issues/37)) ([33192e5](https://github.com/NickYCLin/lattice-term/commit/33192e53c8ab43833aabdc578c29047d9fa0c5c9))
* **桌面:** 防止重複啟動造成空白視窗 ([f37c3a7](https://github.com/NickYCLin/lattice-term/commit/f37c3a70792e38522c15203985c550f3b3480acf))
* **測試:** 防止端到端測試殘留 Agent 程序 ([f0a2df4](https://github.com/NickYCLin/lattice-term/commit/f0a2df43b8878b9db0f96953e5347b8e20bccbce))
* **版本:** 防止多來源版本號漂移 ([a5a5864](https://github.com/NickYCLin/lattice-term/commit/a5a58643526d28f3f86ba78f08b337507378c548))
* **發布:** 以確定性腳本同步 Cargo 鎖定檔 ([de70270](https://github.com/NickYCLin/lattice-term/commit/de70270530fd769cf42413fe27f482583749bc5b))
* **發布:** 排除版本標題參照連結 ([#39](https://github.com/NickYCLin/lattice-term/issues/39)) ([e2dda53](https://github.com/NickYCLin/lattice-term/commit/e2dda53ef6e41c96d6f16b79c8438ee569f015e8))
* **發布:** 精準同步 Cargo 鎖定檔版本 ([36d3d16](https://github.com/NickYCLin/lattice-term/commit/36d3d16207f6e71a2a3e1d90ac6ed2c659fba94a))
* **發布:** 統一版本說明格式 ([57a49e6](https://github.com/NickYCLin/lattice-term/commit/57a49e691e37d5cbbb2665c2cd31a35bd6aa0885))
* **發布:** 統一版本說明項目符號 ([d1497c0](https://github.com/NickYCLin/lattice-term/commit/d1497c0d0d1fd44b3c066c73c6b46e9f1d50e747))
* **發布:** 避免版本標題重複分類 ([0cb4296](https://github.com/NickYCLin/lattice-term/commit/0cb42969963fe16846326edd8a9a47c1fbf44831))
* **監控:** 容量格式化改用算術運算避免測試逾時 ([e78690c](https://github.com/NickYCLin/lattice-term/commit/e78690cd513cb1f76d9707d58fc4766f5e315e29))
* 移除 Linux Agent 的不相容 PipeWire 依賴 ([dc980e4](https://github.com/NickYCLin/lattice-term/commit/dc980e486bb96c7c1f86e631b1abd37fada4f6cd))
* 符合 RDP 輸入鎖的 Clippy 規範 ([32d0c97](https://github.com/NickYCLin/lattice-term/commit/32d0c9726bdb001547ee82c897cc939b30f30a2d))
* **終端:** 修正 Agent Fleet 中文輸入法 ([c861b2f](https://github.com/NickYCLin/lattice-term/commit/c861b2fe33adfbc27980eafa4135630a272f11b4))
* **終端:** 修正底部遮擋與畫面閃跳 ([727a8ad](https://github.com/NickYCLin/lattice-term/commit/727a8adb7118be666c334402f29e6cc34c5cba82))
* **終端機:** 修好 CLI 黑字黑底看不清楚的問題 ([72a4837](https://github.com/NickYCLin/lattice-term/commit/72a4837aa05df50cdd4e51399be1df8a3b40ac9d))
* **終端機:** 修好 Windows 上打字偶爾重複送出的問題 ([b829577](https://github.com/NickYCLin/lattice-term/commit/b8295776c2581c92e0c9d0c853c8618bd41b884e))
* **終端機:** 修正 Linux 注音重複輸入與字距 ([#73](https://github.com/NickYCLin/lattice-term/issues/73)) ([75691c2](https://github.com/NickYCLin/lattice-term/commit/75691c29c2438afee150a1cc79886b2d98817dc1))
* **終端機:** 修正 Linux 重複輸入與字距 ([8a41bf5](https://github.com/NickYCLin/lattice-term/commit/8a41bf58ce9e4f491d9c9f638a2950bef92c256b))
* **終端機:** 終端機一律用深色底，不再跟著淺色主題走 ([75a7cb2](https://github.com/NickYCLin/lattice-term/commit/75a7cb2425bee5d41418072bdca773246af89258))
* **終端機:** 縮緊 Linux 字元欄距 ([b837bf9](https://github.com/NickYCLin/lattice-term/commit/b837bf995454bf216d1d377dd215dbc109a87564))
* **終端機:** 避免輸入法組字重繪閃爍 ([fa44c14](https://github.com/NickYCLin/lattice-term/commit/fa44c14c4c37d39617caf0dec9f629b292046805))
* **終端:** 補送 WebKit 遺失的中文輸入 ([23d2984](https://github.com/NickYCLin/lattice-term/commit/23d2984420de0269296a9bb0e6039527bed83fda))
* 統一遠端協定可用性狀態 ([0af4f75](https://github.com/NickYCLin/lattice-term/commit/0af4f75f758663355683243b76cbccbbd490f4e9))
* 維持 Linux Agent 的 PipeWire 相容性 ([fcccafb](https://github.com/NickYCLin/lattice-term/commit/fcccafb72beadcfbccfe54f2dc45a57242990857))
* **通道:** 保留停止失敗的活躍設定 ([73cd7c7](https://github.com/NickYCLin/lattice-term/commit/73cd7c70e7a3abfc307559df3fd13eb2107a46ff))
* **通道:** 修正遠端轉送介面語意 ([58a219a](https://github.com/NickYCLin/lattice-term/commit/58a219a6e9a1029cf85e2cec4414ccb69d8c9867))
* **通道:** 強化 SSH 通道安全邊界 ([d76c36e](https://github.com/NickYCLin/lattice-term/commit/d76c36e55962b323d7346a64f27dfe7bcb1a3ced))
* **通道:** 讓連接埠轉送真正經過 SSH 傳輸資料 ([d550195](https://github.com/NickYCLin/lattice-term/commit/d550195249ed1f0ad32d7ade8b5247272d53e788))
* **連線:** 修改欄位時清除驗證錯誤 ([5c7c756](https://github.com/NickYCLin/lattice-term/commit/5c7c756875c2aac03d2a0a4a9585ae092d453b98))
* **連線:** 修正工作階段代號傳到介面時的欄位命名 ([905684c](https://github.com/NickYCLin/lattice-term/commit/905684c71f317f28a10a7c183d129eabc9308714))
* **遠端:** 修正分享狀態同步競態 ([2e2989b](https://github.com/NickYCLin/lattice-term/commit/2e2989bba2f65d3ebb0d0e6d1a1d525ab14fee53))
* **遠端:** 限制畫面協定資源使用 ([ab2f5e2](https://github.com/NickYCLin/lattice-term/commit/ab2f5e205834c50d5ffb9eaab38dbde12232cb76))
* **遠端:** 顯示非預期中斷原因 ([7f8d6b6](https://github.com/NickYCLin/lattice-term/commit/7f8d6b67f26ae9415685c16fb9bdfac212d5eab7))
* **開發:** 排除 Rust 產物監看 ([4dc83a2](https://github.com/NickYCLin/lattice-term/commit/4dc83a24613fad18c77b78c9b520dccc81198291))


### ⚡ 效能與體驗優化

* **介面:** 拆分大型前端啟動模組 ([3ba7345](https://github.com/NickYCLin/lattice-term/commit/3ba7345dee3eceaf27fa760a4b0c46af1d6093df))


### 🎨 介面與視覺調整

* **Agent Fleet:** 把 rename 測試那行照 rustfmt 壓回單行 ([0b51eaa](https://github.com/NickYCLin/lattice-term/commit/0b51eaad46169ea901bbe3c246b66103a0e6df6b))
* **Rust:** 補齊續接程式格式 ([d090e38](https://github.com/NickYCLin/lattice-term/commit/d090e38639b06cd3b677225f23ba050930f1d1cb))
* **圖示:** 全面升級左側主導覽列 7 大功能之向量圖示設計 ([fe6836a](https://github.com/NickYCLin/lattice-term/commit/fe6836a3e41fef11b21f34d0df641f92cafc36e3))
* **圖示:** 替換活動紀錄與設定之圖示設計 ([45426d9](https://github.com/NickYCLin/lattice-term/commit/45426d9a0917368557e53f5988a3725c017c82e7))


### 🧹 架構優化

* **remote:** 直連改回共用 SecureConnection::connect ([fd235c5](https://github.com/NickYCLin/lattice-term/commit/fd235c50b75d141629f3801f309ba67e2bff91e4))
* **workspace:** 改以側欄為唯一的工作階段切換入口 ([e18a4b6](https://github.com/NickYCLin/lattice-term/commit/e18a4b6c8c1b89228aa97d1c372c3ff2bd74bdda))
* **workspace:** 移除專案列的加號按鈕 ([0525fad](https://github.com/NickYCLin/lattice-term/commit/0525fad68ed44c3151b09b427f4502411b5954d4))

## [0.28.0](https://github.com/NickYCLin/lattice-term/compare/v0.27.0...v0.28.0) (2026-08-28)


### 🚀 新增功能

* **agents:** 支援透過 Remote 交付檔案 ([dfc06aa](https://github.com/NickYCLin/lattice-term/commit/dfc06aaf144ac820514df2c797e367856563c063))
* **agents:** 顯示 Remote 檔案傳送進度 ([ba37426](https://github.com/NickYCLin/lattice-term/commit/ba3742692586fecd38cb24ec0152ae96abddd972))
* **connections:** 改版新增連結流程 ([0dd7246](https://github.com/NickYCLin/lattice-term/commit/0dd72460837d484c3c96dd92d26d0c4416a91ceb))
* **workspace:** 加入搜尋與精簡狀態提示 ([87ad71b](https://github.com/NickYCLin/lattice-term/commit/87ad71b3e4e05397f41a0f5cd4637504cb72b2cb))
* **workspace:** 補齊工作階段整理、移轉與完成通知 ([08b35a2](https://github.com/NickYCLin/lattice-term/commit/08b35a2e68d5b5091a1e65c4702a4ae3afc446bd))


### 🛠️ 問題修正

* **agents:** 修正 Gemini 個人帳號啟動流程 ([648ee6e](https://github.com/NickYCLin/lattice-term/commit/648ee6e7690ad101a140ef00e78cd666b322d993))
* **notifications:** 避免漏掉 CLI 完成提示音 ([ffd5737](https://github.com/NickYCLin/lattice-term/commit/ffd5737a5b522b95d20cbca2da6c82b4e2a0d717))
* **sessions:** 支援從側欄移除工作階段 ([77d5b26](https://github.com/NickYCLin/lattice-term/commit/77d5b261699918889427b4122b5b0adc67e972e9))
* **terminal:** 支援 Linux CLI 貼上剪貼簿圖片 ([f118de2](https://github.com/NickYCLin/lattice-term/commit/f118de26be34af60c312329be312dba9f1ae7aa1))

## [0.27.0](https://github.com/NickYCLin/lattice-term/compare/v0.26.1...v0.27.0) (2026-08-27)


### 🚀 新增功能

* **remote:** 日常連線不再顯示中繼位址 ([0d0fd75](https://github.com/NickYCLin/lattice-term/commit/0d0fd75314e044d0a21b0f2a08648554b63a63e7))
* **remote:** 純文字主機支援終端分享模式 ([b9116bd](https://github.com/NickYCLin/lattice-term/commit/b9116bd4aaafc64dedcf8b430145fee8e68206ef))
* **terminal:** 終端支援右鍵複製與貼上 ([8e5b381](https://github.com/NickYCLin/lattice-term/commit/8e5b3817476059780269e26d7f17f886f17e6ced))
* **workspace:** 標題列同時顯示工作階段與目前 CLI ([8250492](https://github.com/NickYCLin/lattice-term/commit/825049225761d2ece7071598c6f9f094c525b13b))
* **workspace:** 顯示各 CLI 即時狀態並支援快速對話 ([cbabb7e](https://github.com/NickYCLin/lattice-term/commit/cbabb7e1b4f4ee29ce07513ce7baaff2c58b2735))


### 🛠️ 問題修正

* **agent:** 偵測到的執行檔路徑去除 \\?\ 前綴 ([bfef6a4](https://github.com/NickYCLin/lattice-term/commit/bfef6a42cfac2ab3f268d895fe708678f1bfde35))
* **agent:** 模型切換即時更新、工作目錄去除 \\?\ 前綴 ([687aa06](https://github.com/NickYCLin/lattice-term/commit/687aa06c1903d57d444f217a21859fae103134fd))
* **deploy:** 部署腳本處理改綁 localhost 的舊環境 ([2ab64fd](https://github.com/NickYCLin/lattice-term/commit/2ab64fd7d13114655433f3ab15704d7e09491005))
* **relay:** 握手前先限流並豁免 loopback ([22e5ba1](https://github.com/NickYCLin/lattice-term/commit/22e5ba1308a581a03533ba54f9da1ee2301500c2))
* **remote:** 保護裝置身分與固定配對碼 ([e2e5ccf](https://github.com/NickYCLin/lattice-term/commit/e2e5ccfd65dd8f2b6031bff68e88d3d8c576fbce))
* **workspace:** SSH 分頁自動顯示檔案側欄與主機資源 ([ecc6d3c](https://github.com/NickYCLin/lattice-term/commit/ecc6d3c07cddf1c1b135c638a5c011446f6aa9e7))
* **workspace:** 側欄拖曳改用指標事件 ([525fa1e](https://github.com/NickYCLin/lattice-term/commit/525fa1e8f9f9d32d936397f24a437de639c903de))


### 🧹 架構優化

* **remote:** 直連改回共用 SecureConnection::connect ([fd235c5](https://github.com/NickYCLin/lattice-term/commit/fd235c50b75d141629f3801f309ba67e2bff91e4))
* **workspace:** 移除專案列的加號按鈕 ([0525fad](https://github.com/NickYCLin/lattice-term/commit/0525fad68ed44c3151b09b427f4502411b5954d4))

## [0.26.1](https://github.com/NickYCLin/lattice-term/compare/v0.26.0...v0.26.1) (2026-08-27)


### 🛠️ 問題修正

* **remote:** 限制中繼登錄檔權限 ([#79](https://github.com/NickYCLin/lattice-term/issues/79)) ([61dd840](https://github.com/NickYCLin/lattice-term/commit/61dd840a62421c4fb74f356f3759f8b5b252d033))

## [0.26.0](https://github.com/NickYCLin/lattice-term/compare/v0.25.0...v0.26.0) (2026-08-27)


### 🚀 新增功能

* **remote:** 以裝置 ID 經自架中繼連線 ([7c12190](https://github.com/NickYCLin/lattice-term/commit/7c12190786291155201f82d02b092a13a79b2c8a))
* **remote:** 支援以 WSS 穿越 HTTPS 中繼入口 ([8157a4f](https://github.com/NickYCLin/lattice-term/commit/8157a4f5bd7cc183e7ef3772c5f941f954b96381))
* **remote:** 釘選裝置金鑰並限制中繼撥號頻率 ([403a5d8](https://github.com/NickYCLin/lattice-term/commit/403a5d898bf6ed6bdc3abff21b17610f09a6e611))


### 🛠️ 問題修正

* **remote:** 依 clippy 改用 is_multiple_of 檢查十六進位長度 ([d87484e](https://github.com/NickYCLin/lattice-term/commit/d87484e0ad2b12444ee80229a5013f4af014b0a5))
* **workspace:** 修正工作階段搬移與完成提示音 ([7593414](https://github.com/NickYCLin/lattice-term/commit/7593414473824f5c3cee1a2db1b0320305ec40d6))


### 🧹 架構優化

* **workspace:** 改以側欄為唯一的工作階段切換入口 ([e18a4b6](https://github.com/NickYCLin/lattice-term/commit/e18a4b6c8c1b89228aa97d1c372c3ff2bd74bdda))

## [0.25.0](https://github.com/NickYCLin/lattice-term/compare/v0.24.0...v0.25.0) (2026-08-27)


### 🚀 新增功能

* **workspace:** 加密還原 Agent 終端輸出 ([70372f0](https://github.com/NickYCLin/lattice-term/commit/70372f0da102f063c04b07b8cbf8c311904d4f19))


### 🛠️ 問題修正

* **workspace:** 修正工作階段整理與桌面互動 ([720f96d](https://github.com/NickYCLin/lattice-term/commit/720f96ddbf2011cb7e1af417246bc5ece7c025df))

## [0.24.0](https://github.com/NickYCLin/lattice-term/compare/v0.23.0...v0.24.0) (2026-08-26)


### 🚀 新增功能

* **workspace:** 完善工作階段整理與操作體驗 ([d42da3e](https://github.com/NickYCLin/lattice-term/commit/d42da3ef443dbd75ba3dfb2aee21a270bf8e0073))


### 🛠️ 問題修正

* **ci:** 在測試前建置桌面 sidecar ([ed88c41](https://github.com/NickYCLin/lattice-term/commit/ed88c415f1fe1ba5465338148b063fcbfc24249a))

## [0.23.0](https://github.com/NickYCLin/lattice-term/compare/v0.22.0...v0.23.0) (2026-08-26)


### 🚀 新增功能

* **agent:** 完善 CLI 安裝與模型偵測 ([36deedb](https://github.com/NickYCLin/lattice-term/commit/36deedb99c5063098ee0cc5966c363891b22f099))
* **workspace:** 支援選擇資料夾啟動 CLI ([9af2bb5](https://github.com/NickYCLin/lattice-term/commit/9af2bb55a189561b0e4a4963b70691672a304730))


### 🛠️ 問題修正

* **終端機:** 修正 Linux 注音重複輸入與字距 ([#73](https://github.com/NickYCLin/lattice-term/issues/73)) ([75691c2](https://github.com/NickYCLin/lattice-term/commit/75691c29c2438afee150a1cc79886b2d98817dc1))
* **終端機:** 避免輸入法組字重繪閃爍 ([fa44c14](https://github.com/NickYCLin/lattice-term/commit/fa44c14c4c37d39617caf0dec9f629b292046805))

## [0.22.0](https://github.com/NickYCLin/lattice-term/compare/v0.21.1...v0.22.0) (2026-08-26)


### 🚀 新增功能

* **workspace:** 還原並分組工作階段 ([fd57961](https://github.com/NickYCLin/lattice-term/commit/fd579610671dde6a5a161a8da3e818b36f7b03c9))

## [0.21.1](https://github.com/NickYCLin/lattice-term/compare/v0.21.0...v0.21.1) (2026-08-26)


### 🛠️ 問題修正

* **終端機:** 縮緊 Linux 字元欄距 ([b837bf9](https://github.com/NickYCLin/lattice-term/commit/b837bf995454bf216d1d377dd215dbc109a87564))

## [0.21.0](https://github.com/NickYCLin/lattice-term/compare/v0.20.0...v0.21.0) (2026-08-25)


### 🚀 新增功能

* **app:** 完善工作階段與桌面使用體驗 ([6afbcdd](https://github.com/NickYCLin/lattice-term/commit/6afbcdd7daff842ea58a7774cbdee3540cad6ae0))
* **遠端:** 支援主機檔案瀏覽與傳輸 ([#69](https://github.com/NickYCLin/lattice-term/issues/69)) ([87606ae](https://github.com/NickYCLin/lattice-term/commit/87606ae7ff29f3c06f8661c3bdc5b6504dce974f))


### 🛠️ 問題修正

* **終端機:** 修正 Linux 重複輸入與字距 ([8a41bf5](https://github.com/NickYCLin/lattice-term/commit/8a41bf58ce9e4f491d9c9f638a2950bef92c256b))

## [0.20.0](https://github.com/NickYCLin/lattice-term/compare/v0.19.0...v0.20.0) (2026-08-25)


### 🚀 新增功能

* **Agent Fleet:** 補上 CLI 安裝與模型資訊 ([0d7b72a](https://github.com/NickYCLin/lattice-term/commit/0d7b72aa55112264bb8a6f4aa2fdd25bf3094e55))
* **行動版:** 一個 QR 掃碼自動辨識手機下載，並建置發布 Android APK ([672db00](https://github.com/NickYCLin/lattice-term/commit/672db00f3c4e0203e712c9423fc46507878a1ddb))


### 🛠️ 問題修正

* **終端:** 修正底部遮擋與畫面閃跳 ([727a8ad](https://github.com/NickYCLin/lattice-term/commit/727a8adb7118be666c334402f29e6cc34c5cba82))


### 🎨 介面與視覺調整

* **Rust:** 補齊續接程式格式 ([d090e38](https://github.com/NickYCLin/lattice-term/commit/d090e38639b06cd3b677225f23ba050930f1d1cb))

## [0.19.0](https://github.com/NickYCLin/lattice-term/compare/v0.18.0...v0.19.0) (2026-08-25)


### 🚀 新增功能

* **Agent Fleet:** 加開 CLI 可帶入目前對話，讓新 CLI 接續脈絡 ([810d2a0](https://github.com/NickYCLin/lattice-term/commit/810d2a03ba68847ad6b0c4df3990b7622a5cb756))

## [0.18.0](https://github.com/NickYCLin/lattice-term/compare/v0.17.0...v0.18.0) (2026-08-25)


### 🚀 新增功能

* **Agent Fleet:** 同一分頁掛多個 CLI，一鍵切換、都保持在跑 ([2dfb1b0](https://github.com/NickYCLin/lattice-term/commit/2dfb1b0148e465597325f79255e0612fffc4be88))


### 🛠️ 問題修正

* **SSH:** 檔案總管改緊湊，日期不再折成三行、窄側欄自動精簡欄位 ([c4cbb28](https://github.com/NickYCLin/lattice-term/commit/c4cbb28fee49437daef9178b241749057bf5ba49))

## [0.17.0](https://github.com/NickYCLin/lattice-term/compare/v0.16.0...v0.17.0) (2026-08-25)


### 🚀 新增功能

* **SSH:** SSH 分頁旁邊直接開檔案總管，可拖曳上傳／下載 ([00dacd8](https://github.com/NickYCLin/lattice-term/commit/00dacd828bf0d53b3b61e8bbadc9e2a151c188e3))
* **更新:** 開啟程式時自動偵測新版本並跳出更新提示 ([83d6515](https://github.com/NickYCLin/lattice-term/commit/83d651523bc7a4a55a2ca69d2d62355905a2dad3))
* **終端機:** 支援 Ctrl+C 複製 / Ctrl+V 貼上，本機 CLI 可貼圖 ([672cba4](https://github.com/NickYCLin/lattice-term/commit/672cba4aad9feadee97a801a3bdb79c205b3180b))


### 🛠️ 問題修正

* **終端機:** 修好 CLI 黑字黑底看不清楚的問題 ([72a4837](https://github.com/NickYCLin/lattice-term/commit/72a4837aa05df50cdd4e51399be1df8a3b40ac9d))
* **終端機:** 修好 Windows 上打字偶爾重複送出的問題 ([b829577](https://github.com/NickYCLin/lattice-term/commit/b8295776c2581c92e0c9d0c853c8618bd41b884e))
* **終端機:** 終端機一律用深色底，不再跟著淺色主題走 ([75a7cb2](https://github.com/NickYCLin/lattice-term/commit/75a7cb2425bee5d41418072bdca773246af89258))


### 🎨 介面與視覺調整

* **Agent Fleet:** 把 rename 測試那行照 rustfmt 壓回單行 ([0b51eaa](https://github.com/NickYCLin/lattice-term/commit/0b51eaad46169ea901bbe3c246b66103a0e6df6b))

## [0.16.0](https://github.com/NickYCLin/lattice-term/compare/v0.15.0...v0.16.0) (2026-08-24)


### 🚀 新增功能

* **Agent Fleet:** 一般啟動的保存項目也能加備註 ([7580140](https://github.com/NickYCLin/lattice-term/commit/75801404a90c77b9120c7ecd3e9b48c403cdd557))
* **Agent Fleet:** 執行中的分頁可以就地改名 ([f28f546](https://github.com/NickYCLin/lattice-term/commit/f28f546b5da598d268bdaded4e9ee1759064d947))
* **SSH:** 從 SSH 分頁一鍵開啟 SFTP 檔案總管 ([3bc1aa8](https://github.com/NickYCLin/lattice-term/commit/3bc1aa886db6b17abaea52ea171a9345584fa670))

## [0.15.0](https://github.com/NickYCLin/lattice-term/compare/v0.14.0...v0.15.0) (2026-08-24)


### 🚀 新增功能

* **Agent Fleet:** 保存續接項目可以加備註 ([0291b26](https://github.com/NickYCLin/lattice-term/commit/0291b26b4f8528a470abc109dc0d7eea386fe440))

## [0.14.0](https://github.com/NickYCLin/lattice-term/compare/v0.13.8...v0.14.0) (2026-08-24)


### 🚀 新增功能

* **SFTP:** 檔案總管支援拖曳上傳 ([0828167](https://github.com/NickYCLin/lattice-term/commit/082816758c01d6eebf925092480e06a411877beb))
* **遠端:** Lattice Remote 加上遠端滑鼠鍵盤控制 ([20cb5cc](https://github.com/NickYCLin/lattice-term/commit/20cb5ccb2e76856c0c327dd1922e7e3ecbd22301))


### 🛠️ 問題修正

* **Agent Fleet:** 偵測得到 Windows 的 .cmd/.bat 版 CLI（例如 npm 裝的 Claude Code） ([aa70459](https://github.com/NickYCLin/lattice-term/commit/aa704592e3f75a38a88e58977591cc056c649a0a))
* **macOS:** 相容遠端控制 Insert 鍵 ([e7e4328](https://github.com/NickYCLin/lattice-term/commit/e7e4328c155c913a71dd2312b5641cee32178ea2))
* **SFTP:** 修正拖曳上傳完成狀態 ([e7f3a5f](https://github.com/NickYCLin/lattice-term/commit/e7f3a5ff9cb97021a588c2d97a8373ee2103cc1e))
* **SFTP:** 防止變動中的拖曳檔案被發布 ([b1e8484](https://github.com/NickYCLin/lattice-term/commit/b1e8484423d2dc99eb9c617a6cc205ca3efc765e))
* **介面:** 修正設定操作狀態與翻譯熱更新 ([9bae4c1](https://github.com/NickYCLin/lattice-term/commit/9bae4c1c5914cbdae69802470c67dd707d5cbf5d))
* **桌面:** 防止重複啟動造成空白視窗 ([f37c3a7](https://github.com/NickYCLin/lattice-term/commit/f37c3a70792e38522c15203985c550f3b3480acf))
* **測試:** 防止端到端測試殘留 Agent 程序 ([f0a2df4](https://github.com/NickYCLin/lattice-term/commit/f0a2df43b8878b9db0f96953e5347b8e20bccbce))

## [0.13.8](https://github.com/NickYCLin/lattice-term/compare/v0.13.7...v0.13.8) (2026-08-23)


### 🛠️ 問題修正

* **Linux:** 修正 NVIDIA X11 啟動黑畫面 ([8e1920c](https://github.com/NickYCLin/lattice-term/commit/8e1920c5048349e6e88a435331959519ef5b5d5a))
* **執行環境:** 阻止瀏覽器預覽誤觸桌面後端 ([7a8d0b8](https://github.com/NickYCLin/lattice-term/commit/7a8d0b81178830345a8b100bb5d886883c7a842c))
* **終端:** 補送 WebKit 遺失的中文輸入 ([23d2984](https://github.com/NickYCLin/lattice-term/commit/23d2984420de0269296a9bb0e6039527bed83fda))

## [0.13.7](https://github.com/NickYCLin/lattice-term/compare/v0.13.6...v0.13.7) (2026-08-23)


### 🛠️ 問題修正

* **代理:** 關閉工作階段時終止程序群組 ([d12e53d](https://github.com/NickYCLin/lattice-term/commit/d12e53d92e600d3ba841891cfa66581d4ee7a877))
* **連線:** 修改欄位時清除驗證錯誤 ([5c7c756](https://github.com/NickYCLin/lattice-term/commit/5c7c756875c2aac03d2a0a4a9585ae092d453b98))

## [0.13.6](https://github.com/NickYCLin/lattice-term/compare/v0.13.5...v0.13.6) (2026-08-23)


### 🛠️ 問題修正

* **終端:** 修正 Agent Fleet 中文輸入法 ([c861b2f](https://github.com/NickYCLin/lattice-term/commit/c861b2fe33adfbc27980eafa4135630a272f11b4))
* **開發:** 排除 Rust 產物監看 ([4dc83a2](https://github.com/NickYCLin/lattice-term/commit/4dc83a24613fad18c77b78c9b520dccc81198291))

## [0.13.5](https://github.com/NickYCLin/lattice-term/compare/v0.13.4...v0.13.5) (2026-08-22)


### 🛠️ 問題修正

* **分頁:** 避免背景工作階段關閉切換目前分頁 ([80e9905](https://github.com/NickYCLin/lattice-term/commit/80e9905b73658179c3a1d405eb497e14f384009a))

## [0.13.4](https://github.com/NickYCLin/lattice-term/compare/v0.13.3...v0.13.4) (2026-08-22)


### 🛠️ 問題修正

* **工作階段:** 保留 Agent 與 SSH 非預期中斷原因 ([a338099](https://github.com/NickYCLin/lattice-term/commit/a33809968f47977464d4afd8615ec3a072c8ac13))

## [0.13.3](https://github.com/NickYCLin/lattice-term/compare/v0.13.2...v0.13.3) (2026-08-22)


### 🛠️ 問題修正

* **SFTP:** 修正傳輸清除狀態同步 ([e4284c9](https://github.com/NickYCLin/lattice-term/commit/e4284c9baf6bbdb08f299d05390585f662953fd9))

## [0.13.2](https://github.com/NickYCLin/lattice-term/compare/v0.13.1...v0.13.2) (2026-08-22)


### 🛠️ 問題修正

* **遠端:** 修正分享狀態同步競態 ([2e2989b](https://github.com/NickYCLin/lattice-term/commit/2e2989bba2f65d3ebb0d0e6d1a1d525ab14fee53))

## [0.13.1](https://github.com/NickYCLin/lattice-term/compare/v0.13.0...v0.13.1) (2026-08-22)


### 🛠️ 問題修正

* **遠端:** 限制畫面協定資源使用 ([ab2f5e2](https://github.com/NickYCLin/lattice-term/commit/ab2f5e205834c50d5ffb9eaab38dbde12232cb76))

## [0.13.0](https://github.com/NickYCLin/lattice-term/compare/v0.12.1...v0.13.0) (2026-08-22)


### 🚀 新增功能

* **代理:** 支援同程序工作階段重新連接 ([76d0560](https://github.com/NickYCLin/lattice-term/commit/76d0560f9603bd2be11f061be6a41a313e1cf545))

## [0.12.1](https://github.com/NickYCLin/lattice-term/compare/v0.12.0...v0.12.1) (2026-08-22)


### ⚡ 效能與體驗優化

* **介面:** 拆分大型前端啟動模組 ([3ba7345](https://github.com/NickYCLin/lattice-term/commit/3ba7345dee3eceaf27fa760a4b0c46af1d6093df))

## [0.12.0](https://github.com/NickYCLin/lattice-term/compare/v0.11.0...v0.12.0) (2026-08-22)


### 🚀 新增功能

* **備份:** 加入完整工作區加密匯出與還原 ([fc36800](https://github.com/NickYCLin/lattice-term/commit/fc36800c2c97ee1004ddbfdb3ab58bc6a38dd035))


### 🛠️ 問題修正

* **介面:** 強化停用按鈕的視覺狀態 ([07f76ba](https://github.com/NickYCLin/lattice-term/commit/07f76ba06e7bd7611356153a6a38abe1b3df70ad))

## [0.11.0](https://github.com/NickYCLin/lattice-term/compare/v0.10.0...v0.11.0) (2026-08-22)


### 🚀 新增功能

* **安全性:** 加入敏感剪貼簿自動清除 ([3e8e185](https://github.com/NickYCLin/lattice-term/commit/3e8e185495e26648afe633e15bb02cf7db4f2222))

## [0.10.0](https://github.com/NickYCLin/lattice-term/compare/v0.9.9...v0.10.0) (2026-08-22)


### 🚀 新增功能

* **保管庫:** 加入閒置與背景自動鎖定 ([fd0375d](https://github.com/NickYCLin/lattice-term/commit/fd0375d0ea67e0029a52d7e8213239727717febe))

## [0.9.9](https://github.com/NickYCLin/lattice-term/compare/v0.9.8...v0.9.9) (2026-08-22)


### 🛠️ 問題修正

* **儲存:** 確保批次匯入採用原子寫入 ([842c8fe](https://github.com/NickYCLin/lattice-term/commit/842c8fe96193a8971a6f23db2937439dbb0c122d))
* **工作階段:** 重載後恢復現有連線 ([0b3cfcf](https://github.com/NickYCLin/lattice-term/commit/0b3cfcfdf4ec8668929b3df83167c09d8ca83676))
* **遠端:** 顯示非預期中斷原因 ([7f8d6b6](https://github.com/NickYCLin/lattice-term/commit/7f8d6b67f26ae9415685c16fb9bdfac212d5eab7))

## [0.9.8](https://github.com/NickYCLin/lattice-term/compare/v0.9.7...v0.9.8) (2026-08-22)


### 🛠️ 問題修正

* **發布:** 避免版本標題重複分類 ([0cb4296](https://github.com/NickYCLin/lattice-term/commit/0cb42969963fe16846326edd8a9a47c1fbf44831))

## [0.9.7](https://github.com/NickYCLin/lattice-term/compare/v0.9.6...v0.9.7) (2026-08-22)


### 🛠️ 問題修正

* **RDP:** 修正遠端畫面色彩通道 ([8a43683](https://github.com/NickYCLin/lattice-term/commit/8a436839e41b76cbf96d18bbd4a9b1e8c0682669))
* **RDP:** 區分憑證拒絕與連線失敗 ([740e75f](https://github.com/NickYCLin/lattice-term/commit/740e75f09e67ab7e5aac22722460043846fbf260))
* **VNC:** 防止畫面越界與遠端輸入卡住 ([253aeb4](https://github.com/NickYCLin/lattice-term/commit/253aeb4dba8d697e0394684877b5cf0b7306d37e))
* **發布:** 統一版本說明項目符號 ([d1497c0](https://github.com/NickYCLin/lattice-term/commit/d1497c0d0d1fd44b3c066c73c6b46e9f1d50e747))
* **通道:** 保留停止失敗的活躍設定 ([73cd7c7](https://github.com/NickYCLin/lattice-term/commit/73cd7c70e7a3abfc307559df3fd13eb2107a46ff))

## [0.9.6](https://github.com/NickYCLin/lattice-term/compare/v0.9.5...v0.9.6) (2026-08-21)


### 🛠️ 問題修正

* **SFTP:** 保護串流覆寫的原始檔案 ([835a4c5](https://github.com/NickYCLin/lattice-term/commit/835a4c5bf73ae67790eb95ed34b9811e2190d69d))

## [0.9.5](https://github.com/NickYCLin/lattice-term/compare/v0.9.4...v0.9.5) (2026-08-21)


### 🛠️ 問題修正

* **發布:** 排除版本標題參照連結 ([#39](https://github.com/NickYCLin/lattice-term/issues/39)) ([e2dda53](https://github.com/NickYCLin/lattice-term/commit/e2dda53ef6e41c96d6f16b79c8438ee569f015e8))

## [0.9.4](https://github.com/NickYCLin/lattice-term/compare/v0.9.3...v0.9.4) (2026-08-21)


### 🛠️ 問題修正

* **更新:** 安裝完成後自動重新啟動 ([#37](https://github.com/NickYCLin/lattice-term/issues/37)) ([33192e5](https://github.com/NickYCLin/lattice-term/commit/33192e53c8ab43833aabdc578c29047d9fa0c5c9))

## [0.9.3](https://github.com/NickYCLin/lattice-term/compare/v0.9.2...v0.9.3) (2026-08-21)


### 🛠️ 問題修正

* **發布:** 統一版本說明格式 ([57a49e6](https://github.com/NickYCLin/lattice-term/commit/57a49e691e37d5cbbb2665c2cd31a35bd6aa0885))

## [0.9.2](https://github.com/NickYCLin/lattice-term/compare/v0.9.1...v0.9.2) (2026-08-21)


### 🛠️ 問題修正

* **VNC:** 補發新版 Rust 像素分塊相容修正 ([73a3155](https://github.com/NickYCLin/lattice-term/commit/73a3155415c2109d315d9e1bab3ad554bb93607c))

## [0.9.1](https://github.com/NickYCLin/lattice-term/compare/v0.9.0...v0.9.1) (2026-08-21)


### 🛠️ 問題修正

* **更新:** 修好「有下載卻沒安裝」，更新改成全自動不跳安裝視窗 ([69f53c3](https://github.com/NickYCLin/lattice-term/commit/69f53c3faa0747310c3b350c36782f4ba928a428))

## [0.9.0](https://github.com/NickYCLin/lattice-term/compare/v0.8.0...v0.9.0) (2026-08-21)

### 🚀 新增功能
* **左側功能列圖示最佳化**：
  - 活動紀錄 (Activity)：替換為直觀的「條列日誌記事本 (Audit Logsheet)」，消除醫療心電圖感。
  - 設定 (Settings)：替換為標準的「一體連通式高精度機械齒輪 (Solid Mechanical Gear)」，徹底消除太陽放射感。
* **SFTP 大檔案串流佇列**：
  - SFTP 檔案傳輸升級為分塊串流佇列架構，正式解除 32MB 上傳與下載大小限制，支援大型檔案穩定傳輸。
* **VNC 遠端桌面協定支援**：
  - 新增 VNC 遠端連線模式，並修復切換視圖分頁時畫面偶發空白的問題。
* **獨立加密保管庫 (Encrypted Vault)**：
  - 新增本機加密保管庫功能，讓 SSH 與遠端主機認證資料多一個安全可靠的獨立儲存選擇。
* **AI Agent Session ID 智慧擷取**：
  - 自動從 CLI 輸出中識別並捕獲 Session ID，一鍵輕鬆續接歷史工作階段，無需手動複製貼上。
* **行動版支援架構**：
  - 完成 Android 行動裝置執行支援與跨端適配。

## [0.8.0](https://github.com/NickYCLin/lattice-term/compare/v0.7.0...v0.8.0) (2026-08-21)

### 🚀 新增功能

- **SSH 通道與連接埠轉送**：
  - 支援本機轉送（`-L`）、SOCKS5 動態代理（`-D`）與遠端轉送（`-R`）。
  - 提供即時狀態、連線數、傳輸流量與標準 OpenSSH 指令。
- **主機資源監控**：
  - 活躍 SSH 工作階段可讀取真實 CPU、記憶體、磁碟與開機時間。
- **SSH 私鑰登入**：
  - 可使用本機 OpenSSH 私鑰與密語登入，不再只支援密碼。

### 🛠️ 問題修正與優化

- **SSH 通道資料路徑**：修正轉送流量，確保資料真正經過 SSH 連線。
- **通道安全邊界**：強化無驗證 SOCKS5 綁定與遠端轉送的介面語意。

### 🎨 介面與視覺調整

- **主導覽圖示**：重新繪製七個主要功能的向量圖示。

## [0.7.0](https://github.com/NickYCLin/lattice-term/compare/v0.6.0...v0.7.0) (2026-08-21)

### 🚀 新增功能

- **AI Agent 工作階段原生續接**：
  - 新增 Codex、Claude Code、Gemini CLI 與 Hermes 的版本化續接 Adapter。
  - 續接識別值以單一參數直接傳遞，不經 shell，並拒絕控制字元、前導 `-` 與額外參數混用。
  - 介面可直接續接既有 CLI 脈絡，或由使用者明確選擇是否保存到安全啟動工作區。

---

## [0.6.0](https://github.com/NickYCLin/lattice-term/compare/v0.5.0...v0.6.0) (2026-08-20)

### 🚀 新增功能
* **工作區命名與拖曳排序**：
  - 支援為多個 AI Agent 工作區自訂名稱並自由拖曳調整排列順序。
  - 啟動偏好設定自動持久化儲存，重新開啟 App 後立即恢復上次佈局。

### 🛠️ 問題修正
* **工作區安全性檢驗**：增加本機磁碟儲存路徑的安全名稱過濾，防止非法字元或路徑穿越。
* **版本號精準同步**：介面版號與建置資訊直接連動，確保各處顯示的版本號完全一致。

---

## [0.5.0](https://github.com/NickYCLin/lattice-term/compare/v0.4.0...v0.5.0) (2026-08-20)

### 🚀 新增功能
* **工作區獨立儲存**：
  - 實作安全隔離的工作區設定儲存，保護個別工作區的命令參數與工作目錄。
  - 新增工作區快速切換面板，簡化多專案多任務之間的切換流程。

---

## [0.4.0](https://github.com/NickYCLin/lattice-term/compare/v0.3.0...v0.4.0) (2026-08-20)

### 🚀 新增功能
* **批次指令廣播 (Fleet Broadcast)**：
  - 支援同時勾選多個活躍工作階段並一鍵廣播傳送指令或提示詞。
  - 提供即時送達狀態回饋，方便多主機或多 Agent 同步操作。

---

## [0.3.0](https://github.com/NickYCLin/lattice-term/compare/v0.2.0...v0.3.0) (2026-08-20)

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
