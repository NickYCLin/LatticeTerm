# iOS App Store 資料草稿

供帳號持有人檢閱後填入 App Store Connect；本文件不是已發布的商店資料。先以繁體中文上架內容為主，審核備註另提供英文。

## 可直接使用的文案

| 欄位 | 草稿 |
| --- | --- |
| 名稱 | LatticeTerm |
| 副標題 | SSH 終端機與 SFTP 檔案管理 |
| 主要類別建議 | 開發者工具 |
| 關鍵字 | SSH,SFTP,終端機,遠端連線,伺服器,檔案傳輸,通道,保管庫 |
| Bundle ID | io.github.nickyclin.latticeterm |

### 描述

LatticeTerm 讓你從 iPhone 與 iPad 連接自己的伺服器，使用 SSH 終端機、SFTP 檔案傳輸與 SSH 通道，集中整理日常遠端工作需要的連線設定。

- 依群組、標籤與搜尋管理主機，快速找到需要的連線。
- 使用互動式 SSH 終端機與觸控輔助鍵列，操作 Esc、Tab、方向鍵及 Ctrl。
- 以 SFTP 瀏覽與傳輸檔案，查看傳輸進度。
- 確認 SSH 主機金鑰，透過本機加密保管庫或 iOS Keychain 管理選擇保存的認證資料。
- 支援繁體中文與英文介面。

使用遠端功能需要你有權存取的主機與登入資料。iOS 不執行本機 AI CLI、RDP／VNC 桌面引擎或桌面分享程序。iOS 進入背景後，連線可能被系統暫停或中斷。

### 首版更新說明

首次提供 iOS 版本，包含 SSH、SFTP、連線管理、觸控輔助鍵列及本機保管庫。

## 已備妥網址與尚需資料

| 欄位 | 內容／狀態 |
| --- | --- |
| 版權／銷售者 | 帳號持有人確認的真實姓名或公司名稱 |
| 隱私權網址 | [公開隱私權政策](https://nickyclin.github.io/lattice-term/privacy.html)（2026-09-05 已部署並確認可公開存取） |
| 支援網址 | [公開使用支援](https://nickyclin.github.io/lattice-term/support.html)（2026-09-05 已部署並確認可公開存取） |
| 審核聯絡資訊 | 姓名、電話、電子郵件；只放 App Store Connect，不提交到公開 repo |
| 價格與地區 | 帳號持有人決定 |
| 年齡分級／加密問卷 | 依最終功能及 Apple 問卷回答，不能從 repo 推定 |
| 審核示範 | 可公開連線的隔離 SSH 測試主機、受限帳號與驗證步驟；憑證只交付 Apple 審核欄位 |
| 螢幕截圖 | 實際 App 的 iPhone 與 iPad 畫面，依 App Store Connect 當時列出的尺寸匯出 |

截圖建議依序呈現連線清單、SSH 終端機、SFTP 檔案傳輸與保管庫設定。只使用自有測試主機、示範帳號與無敏感內容的資料。模擬器啟動畫面可作為工作證據，但不等於完整商店截圖組。

## App Review Notes（英文草稿）

LatticeTerm is an SSH/SFTP client for connecting to servers controlled by the user. It does not require a LatticeTerm account. Commands entered in the terminal run on the remote SSH server; the iOS app does not download or execute local CLI tools. The iOS package does not contain the desktop RDP/VNC sidecar engines and does not offer local AI CLI sessions.

To review the connection flow, add a connection using the dedicated review server and credentials supplied in the private App Review Information fields, select SSH, verify the host key against the supplied fingerprint, and connect. The same review account can be used for SFTP with a test directory. Local Network access is needed only when connecting to a host on the local network.

Before submitting these notes, the publisher must provision and verify the dedicated review server, supply its expected fingerprint and private credentials, and document the permitted commands and test directory. These details are not included in this public repository.

## 隱私表單盤點

目前 iOS 程式未加入廣告、分析或跨 App 追蹤。連線設定、操作紀錄與保管庫資料在裝置端保存；執行連線／檔案傳輸時，資料會傳往使用者指定的主機或中繼。TestFlight 診斷與使用者主動提交的支援資訊另依 Apple／GitHub 的機制處理。

發行者需以最終 bundle、SDK Privacy Report 與實際提供的服務再次確認 App Privacy 答案。若加入自有雲端或遙測，不能照抄目前的不收集／不追蹤宣告。
