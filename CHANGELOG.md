# Changelog

## [0.5.0](https://github.com/NickYCLin/LatticeTerm/compare/v0.4.0...v0.5.0) (2026-08-20)


### 新功能

* **agent:** 加入安全啟動工作區儲存 ([68a6afe](https://github.com/NickYCLin/LatticeTerm/commit/68a6afe60d5325b8b381fd39d5e26babfae8d93a))
* **agent:** 加入啟動工作區操作介面 ([1302bf8](https://github.com/NickYCLin/LatticeTerm/commit/1302bf8169115a2b17c9c946d3d24dd7889e0d77))
* **agent:** 合併跨重啟安全啟動工作區 ([#20](https://github.com/NickYCLin/LatticeTerm/issues/20)) ([b3a32c0](https://github.com/NickYCLin/LatticeTerm/commit/b3a32c06540ea651a30beabd770f4f1a673ebd1e))

## [0.4.0](https://github.com/NickYCLin/LatticeTerm/compare/v0.3.0...v0.4.0) (2026-08-20)


### 新功能

* **agent:** 加入安全批次提示傳輸 ([fcaaf4c](https://github.com/NickYCLin/LatticeTerm/commit/fcaaf4cfbe317be74a9a5f5bb47102fe466175e6))
* **agent:** 加入批次提示操作介面 ([7d9c714](https://github.com/NickYCLin/LatticeTerm/commit/7d9c7143e74328063a8901b7b6cd5b880e6ff6c1))

## [0.3.0](https://github.com/NickYCLin/LatticeTerm/compare/v0.2.0...v0.3.0) (2026-08-20)


### 新功能

* **agent:** 加入 AI Agent Fleet 操作介面 ([ca7969b](https://github.com/NickYCLin/LatticeTerm/commit/ca7969b73d7025a53598edad797dd89ef469da04))
* **agent:** 加入安全語意狀態回報器 ([523f54b](https://github.com/NickYCLin/LatticeTerm/commit/523f54b4249798c03c6dea6f640a4d5a064aaf25))
* **agent:** 建立本機多 CLI PTY 執行核心 ([5bdcfb8](https://github.com/NickYCLin/LatticeTerm/commit/5bdcfb8477d6018606dacbe59e7b4eb21e32e81b))
* **agent:** 顯示 Adapter 語意狀態來源 ([f75ac4f](https://github.com/NickYCLin/LatticeTerm/commit/f75ac4fb9e58061c1b744160a2fd081fb05e934f))
* **sftp:** 加入檔案瀏覽與傳輸工作區 ([5ae0472](https://github.com/NickYCLin/LatticeTerm/commit/5ae0472cefbb8b36a9b616c294d696dbe563d163))
* **sftp:** 合併安全檔案傳輸工作區 ([#13](https://github.com/NickYCLin/LatticeTerm/issues/13)) ([e5426e4](https://github.com/NickYCLin/LatticeTerm/commit/e5426e4fbfe955d0daa4b96db4779ba6af667b5b))
* **sftp:** 建立安全檔案傳輸後端 ([d23394c](https://github.com/NickYCLin/LatticeTerm/commit/d23394c1cba1408cd6dcdf40074e218e12475386))
* **安全:** 使用系統認證儲存保存 SSH 與 RDP 密碼 ([bdc11a1](https://github.com/NickYCLin/LatticeTerm/commit/bdc11a141f895bcfd81544e1909ac9a0ebe5f960))
* **安全:** 使用系統認證儲存保存 SSH 與 RDP 密碼 ([950d225](https://github.com/NickYCLin/LatticeTerm/commit/950d225cb83565a38fc55b9d30d80b0377fbf4ae))
* 整合 Lattice Remote 主機分享模式 ([2a5d9bb](https://github.com/NickYCLin/LatticeTerm/commit/2a5d9bb9ebce9bf157c9c70ee313d005cf9b8691))
* 新增遠端桌面與主機信任管理 ([0bc8cf0](https://github.com/NickYCLin/LatticeTerm/commit/0bc8cf0df10ce19231d4548dde676af0e6868645))
* 新增遠端畫面截圖與錄影 ([4859158](https://github.com/NickYCLin/LatticeTerm/commit/4859158838afc9a06795afdc7ddabe009711d269))
* **更新:** 啟用已簽章的自動更新流程 ([7e13001](https://github.com/NickYCLin/LatticeTerm/commit/7e13001a8e7f9048060a87dfae3ce4a76ab708be))
* **發布:** 自動判定版本並產生跨平台發行版 ([c9aaac0](https://github.com/NickYCLin/LatticeTerm/commit/c9aaac03d61f99cb162a4c99cdfc701723d30d0f))
* **遠端:** 整合 Lattice Remote 主機分享與 Web RDP 擷取 ([8ad3eb3](https://github.com/NickYCLin/LatticeTerm/commit/8ad3eb3e8cf261c9442e85b57bbae9702cc71f09))


### 問題修正

* **agent:** 結束應用程式時停止所有 CLI ([088ff8a](https://github.com/NickYCLin/LatticeTerm/commit/088ff8a98217abb8588ab677458fbf9cd4ddb487))
* **ci:** 在 Rust 驗證前建置遠端 sidecar ([7f837bc](https://github.com/NickYCLin/LatticeTerm/commit/7f837bc8949fbcb0d2d26c1b83e2b252256befcb))
* **sftp:** 阻擋未確認的同名檔案覆寫 ([0ddf961](https://github.com/NickYCLin/LatticeTerm/commit/0ddf961a93939eabaf4360b7da9242269d0b0908))
* **介面:** 修正停用確認動作時的對話框焦點 ([cd95138](https://github.com/NickYCLin/LatticeTerm/commit/cd9513826d4d3b65ec37d5559a6ba5f87baf78d5))
* **安全:** 允許瀏覽器預覽刪除連線設定 ([c10e86b](https://github.com/NickYCLin/LatticeTerm/commit/c10e86bd29480a6f896e928bf6810e906ed924b5))
* 明確解參考 RDP 子程序輸入鎖 ([acd5899](https://github.com/NickYCLin/LatticeTerm/commit/acd5899e861117ce54f233a253180041e3ad38ed))
* **版本:** 防止多來源版本號漂移 ([a5a5864](https://github.com/NickYCLin/LatticeTerm/commit/a5a58643526d28f3f86ba78f08b337507378c548))
* **發布:** 以確定性腳本同步 Cargo 鎖定檔 ([de70270](https://github.com/NickYCLin/LatticeTerm/commit/de70270530fd769cf42413fe27f482583749bc5b))
* **發布:** 精準同步 Cargo 鎖定檔版本 ([36d3d16](https://github.com/NickYCLin/LatticeTerm/commit/36d3d16207f6e71a2a3e1d90ac6ed2c659fba94a))
* **監控:** 容量格式化改用算術運算避免測試逾時 ([e78690c](https://github.com/NickYCLin/LatticeTerm/commit/e78690cd513cb1f76d9707d58fc4766f5e315e29))
* 移除 Linux Agent 的不相容 PipeWire 依賴 ([dc980e4](https://github.com/NickYCLin/LatticeTerm/commit/dc980e486bb96c7c1f86e631b1abd37fada4f6cd))
* 符合 RDP 輸入鎖的 Clippy 規範 ([32d0c97](https://github.com/NickYCLin/LatticeTerm/commit/32d0c9726bdb001547ee82c897cc939b30f30a2d))
* 統一遠端協定可用性狀態 ([0af4f75](https://github.com/NickYCLin/LatticeTerm/commit/0af4f75f758663355683243b76cbccbbd490f4e9))
* 維持 Linux Agent 的 PipeWire 相容性 ([fcccafb](https://github.com/NickYCLin/LatticeTerm/commit/fcccafb72beadcfbccfe54f2dc45a57242990857))
* **連線:** 修正工作階段代號傳到介面時的欄位命名 ([905684c](https://github.com/NickYCLin/LatticeTerm/commit/905684c71f317f28a10a7c183d129eabc9308714))
