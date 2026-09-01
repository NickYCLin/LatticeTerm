# 更新日誌 (Changelog)

本專案遵循語意化版本（Semantic Versioning）發布，所有更新內容均以繁體中文條列說明。

---

## [0.30.1](https://github.com/NickYCLin/lattice-term/compare/v0.30.0...v0.30.1) (2026-09-01)


### 🛠️ 問題修正

* 修正工作階段狀態誤判與側邊欄隱藏 ([02b0943](https://github.com/NickYCLin/lattice-term/commit/02b09432f280af8c1a26cf64b27cc6dd307ab91f))


### 🎨 介面與視覺調整

* **agent:** 套用 Rust 格式 ([212f4b1](https://github.com/NickYCLin/lattice-term/commit/212f4b1619760c98d961c343568595438708e0e6))

## [0.30.0](https://github.com/NickYCLin/lattice-term/compare/v0.29.2...v0.30.0) (2026-09-01)


### 🚀 新增功能

* **workspace:** 支援收合專案工作階段 ([2cde682](https://github.com/NickYCLin/lattice-term/commit/2cde6829394dbbe6acaeb63b87b4d168c8281d42))


### 🛠️ 問題修正

* **terminal:** 修正右鍵貼上與路徑顯示 ([23c29ff](https://github.com/NickYCLin/lattice-term/commit/23c29ff5ddcd15733a3837cf07d961fb503f4429))

## [0.29.2](https://github.com/NickYCLin/lattice-term/compare/v0.29.1...v0.29.2) (2026-08-31)


### 🛠️ 問題修正

* **agents:** 移除 CLI 卡片警告徽章 ([9f33b0b](https://github.com/NickYCLin/lattice-term/commit/9f33b0bd6d8c09a05dd37fc4c857d0cebce165b7))
* **agent:** 修正工作中誤顯示待確認 ([7c9505a](https://github.com/NickYCLin/lattice-term/commit/7c9505ad3f24aaeda5e73f1fb08d924b2f3ae13a))

## [0.29.1](https://github.com/NickYCLin/lattice-term/compare/v0.29.0...v0.29.1) (2026-08-31)


### 🛠️ 問題修正

* **agent:** 修正 CLI 偵測與初始狀態 ([e1a54ef](https://github.com/NickYCLin/lattice-term/commit/e1a54efc745b74600d010ce8b03f9a3f941fcc94))
* **notifications:** 依序播放完成提示音 ([1bfdb72](https://github.com/NickYCLin/lattice-term/commit/1bfdb7212101ba4f28a7e3c6dae6215e05e756b3))
* **workspace:** 保留還原失敗的工作階段 ([5ecd397](https://github.com/NickYCLin/lattice-term/commit/5ecd397a4b60de23e68f542cb09931fa7c701553))
* **workspace:** 修正多 CLI 工作階段名稱顯示 ([749c295](https://github.com/NickYCLin/lattice-term/commit/749c295f75295e80c1bd9db85dce05b0024bea15))
* **workspace:** 在側邊欄展開多個 CLI ([180f1bc](https://github.com/NickYCLin/lattice-term/commit/180f1bcaec85d41b0bfb919e8df7a2f143bbc43b))
* **workspace:** 改善狀態提示與匯出位置 ([d0d332d](https://github.com/NickYCLin/lattice-term/commit/d0d332d1cc5100b3fcd5d73cec5cb87570a43ed6))

## [0.29.0](https://github.com/NickYCLin/lattice-term/compare/v0.28.0...v0.29.0) (2026-08-30)


### 🚀 新增功能

* **agents:** 以官方 hook 同步 Copilot 狀態 ([e4fad9b](https://github.com/NickYCLin/lattice-term/commit/e4fad9badb29b10b6b8bfae96d77134f30c6c066))
* **agents:** 以官方 hook 同步 Gemini 狀態 ([048fa43](https://github.com/NickYCLin/lattice-term/commit/048fa437ab476ed616c3714d4ffeae1d60d28ff3))
* **agents:** 以官方 hook 同步 Qwen 狀態 ([3005c39](https://github.com/NickYCLin/lattice-term/commit/3005c39b8c8100c9b65678b0d3e942e018520e43))
* **agents:** 以官方事件同步 OpenCode 狀態 ([6ab4931](https://github.com/NickYCLin/lattice-term/commit/6ab4931e0265f2dc887bb4e8690d19aaa5ef52d9))
* **agents:** 以官方生命週期同步 Hermes 狀態 ([2520999](https://github.com/NickYCLin/lattice-term/commit/2520999cb46000e04225aef7867f3757f488acd3))
* **agents:** 支援 Cursor 工作階段續接 ([34d7d1a](https://github.com/NickYCLin/lattice-term/commit/34d7d1ac08b6a4f34bf38596a15a65941bdf8de2))
* **agents:** 顯示 Hermes token 用量 ([defb732](https://github.com/NickYCLin/lattice-term/commit/defb7322363d39f4304ade8a47d8c855bbd9be24))


### 🛠️ 問題修正

* **a11y:** 保留手機側欄搜尋狀態 ([afb9005](https://github.com/NickYCLin/lattice-term/commit/afb9005a69284c12303c1993e30afcac3a62fb36))
* **a11y:** 修正彈出控制鍵盤行為 ([7887af2](https://github.com/NickYCLin/lattice-term/commit/7887af225eaa591b77554c0953ae1a54163208c2))
* **a11y:** 修正階層清單與命令面板語意 ([45c8405](https://github.com/NickYCLin/lattice-term/commit/45c8405fff62448073963c4e812026ee22ba11dd))
* **a11y:** 支援分頁鍵盤導覽 ([0cc8da1](https://github.com/NickYCLin/lattice-term/commit/0cc8da1908b044019c8ca42141b865388c124e57))
* **a11y:** 統一選項群組鍵盤操作 ([3c39008](https://github.com/NickYCLin/lattice-term/commit/3c39008ef22a3f53548a8f16292579c7044d183f))
* **a11y:** 補齊剩餘視窗焦點管理 ([8b0bb0a](https://github.com/NickYCLin/lattice-term/commit/8b0bb0a46f79fcc4894496a3f8f062980d6451ee))
* **a11y:** 鎖定執行中的確認視窗 ([ce839b0](https://github.com/NickYCLin/lattice-term/commit/ce839b0ce89df1c837db1b402d9574f664213712))
* **a11y:** 鎖定手機工作階段側欄焦點 ([5199956](https://github.com/NickYCLin/lattice-term/commit/51999568f9ca9456c834d7b84fd912ed81e8889e))
* **a11y:** 鎖定核心對話框焦點 ([705caef](https://github.com/NickYCLin/lattice-term/commit/705caefe05b5804d11e1b016d10571f467e112ed))
* **agents:** 以官方 hook 同步 Claude 狀態 ([924e1dd](https://github.com/NickYCLin/lattice-term/commit/924e1dd2c5a68ee7fab59130beab5e5f152704bb))
* **agents:** 保留啟動期間的狀態事件 ([a610694](https://github.com/NickYCLin/lattice-term/commit/a6106948885cd35ccfc4eb4e6ab4cec992454327))
* **agents:** 對話匯出失敗時保留原工作階段 ([3923d56](https://github.com/NickYCLin/lattice-term/commit/3923d56300945124a9767fa26277d3b3b58818e4))
* **agents:** 清除貼上的暫存圖片 ([4ebd09e](https://github.com/NickYCLin/lattice-term/commit/4ebd09e434f1a1ec6353c5e38f473239a1817208))
* **agents:** 禁止 Gemini hook 再用完成猜測 ([8f37267](https://github.com/NickYCLin/lattice-term/commit/8f37267168d14a2fc1462d238c7fe159ee8c7299))
* **agents:** 避免跨封包提示誤標完成 ([b997ee9](https://github.com/NickYCLin/lattice-term/commit/b997ee9cfa38a4084b90a6fa458f822a071344dc))
* **agents:** 防止快速退出的工作階段復活 ([0a313c5](https://github.com/NickYCLin/lattice-term/commit/0a313c5b5420a687d92757434f3c2c203091dc17))
* **agents:** 隔離跨 CLI 對話交接 ([78a89bb](https://github.com/NickYCLin/lattice-term/commit/78a89bbaf09e6d90420dd6ccb7231bdab5821eeb))
* **ci:** 鎖定 Actions 並限縮發版權限 ([0cb483f](https://github.com/NickYCLin/lattice-term/commit/0cb483f8eee3d7bca1c534898031f6e01e042363))
* **clipboard:** 完整支援 Linux 終端複製貼上 ([0309dfb](https://github.com/NickYCLin/lattice-term/commit/0309dfbff4d50ac9f654e810e4cf04d989c0b311))
* **mobile:** 依執行環境限制連線能力 ([639f8b8](https://github.com/NickYCLin/lattice-term/commit/639f8b8890f29ceb0456e256fe470c10f1b67523))
* **mobile:** 修復遠端入口與窄螢幕介面 ([fa889eb](https://github.com/NickYCLin/lattice-term/commit/fa889eb3209fa2be7f64bb1fae9c05195b73a04f))
* **mobile:** 加入可操作的連線篩選抽屜 ([359e424](https://github.com/NickYCLin/lattice-term/commit/359e424ecffe6e174837fed13487e1f6dbc1e881))
* **mobile:** 支援遠端檔案與軟體鍵盤 ([b658a43](https://github.com/NickYCLin/lattice-term/commit/b658a4322cc75a68acae67ef3a0a9fed004e6296))
* **remote:** 保留終端初始輸出 ([01a9a43](https://github.com/NickYCLin/lattice-term/commit/01a9a43aa17081a1aedd415db68606c33b36b8bf))
* **remote:** 修復遠端畫布鍵鼠與觸控操作 ([18c1f01](https://github.com/NickYCLin/lattice-term/commit/18c1f0106b27574b100709ec6f4997750015b7ab))
* **remote:** 回收遠端終端子程序 ([99ec77f](https://github.com/NickYCLin/lattice-term/commit/99ec77f5a8025087c50c41c6c891e16252255721))
* **remote:** 支援 Linux 終端剪貼簿 ([de803e9](https://github.com/NickYCLin/lattice-term/commit/de803e98d7dd6a802c053c3c92f460a4f52f0612))
* **remote:** 防止配對失敗污染裝置釘選 ([a4981cf](https://github.com/NickYCLin/lattice-term/commit/a4981cf9b46c1569849f2371b0da91fe4f3eaff9))
* **remote:** 限制並保護遠端檔案工作 ([c7ddc59](https://github.com/NickYCLin/lattice-term/commit/c7ddc59cf510f138dcc85044e5304587382e6eff))
* **remote:** 限制並回收檢視端連線 ([9eb5a90](https://github.com/NickYCLin/lattice-term/commit/9eb5a908570e3d9c08428a8ab38279efea6c04e7))
* **remote:** 限制中繼連線與待配對資源 ([5cbde09](https://github.com/NickYCLin/lattice-term/commit/5cbde0947dbc1d2d2e98c007666f90361fcc41d5))
* **remote:** 限制遠端輸入與終端資源 ([2d27990](https://github.com/NickYCLin/lattice-term/commit/2d27990f7eed9f996360288ddfd28d8292673a3f))
* **security:** 修補 Linux glib 迭代器未定義行為 ([0850946](https://github.com/NickYCLin/lattice-term/commit/08509460320f57fa4fb032ddd7e6f10e488b75d6))
* **security:** 將 RDP 憑證核准移出前端 ([a596246](https://github.com/NickYCLin/lattice-term/commit/a596246eb7415b7edfa429353a935533f17ee8e8))
* **security:** 綁定憑證與實際連線端點 ([50e8551](https://github.com/NickYCLin/lattice-term/commit/50e8551f012f0b1e5301f5a2f6b13edd4d823037))
* **sessions:** 封住遠端工作階段生命週期競態 ([edc7b6b](https://github.com/NickYCLin/lattice-term/commit/edc7b6ba87b3a032969eadd340767674b83164f4))
* **sftp:** 防止並行下載覆寫或誤刪檔案 ([f58b001](https://github.com/NickYCLin/lattice-term/commit/f58b001962a89f3e7fc70d3b5b9bce36d19ebb9a))
* **tunnel:** 修復斷線後無法重新啟動 ([0066cf8](https://github.com/NickYCLin/lattice-term/commit/0066cf8122cf930e6c2ead26404418f04fa4e998))
* **tunnel:** 避免啟停競態與遠端埠殘留 ([31b12b7](https://github.com/NickYCLin/lattice-term/commit/31b12b732d1580378bacba0a789f17c92ee3b18f))
* **tunnel:** 限制資源並完整回收連線 ([aa9be9d](https://github.com/NickYCLin/lattice-term/commit/aa9be9d00dc1f1dd0b0b545d4dbe6c432316cbcd))
* **workspace:** 避免工作中誤標為完成 ([a8d0bb5](https://github.com/NickYCLin/lattice-term/commit/a8d0bb5b4c1fcd91ebd6369395a4469ab836f116))
* **終端機:** 修復 Linux 文字複製貼上 ([d7c9b96](https://github.com/NickYCLin/lattice-term/commit/d7c9b961cec40633a6fd347d095509f92c84872e))
* **連線:** 支援選項鍵盤導覽 ([167e8a7](https://github.com/NickYCLin/lattice-term/commit/167e8a742b1c5193588ce4311f5a40ff9f4f2701))
* **連線:** 鎖定忙碌中的連線視窗 ([fbaab2f](https://github.com/NickYCLin/lattice-term/commit/fbaab2f6c75e43db5c683f9a69c5c9ef69ff622c))

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
