# iOS 發布與驗證

本文件取代早期 Simulator 計畫中的企業 In-House 匯出步驟。Simulator 可啟動、已簽章的實機 App、TestFlight 可安裝與 App Store 已上架是不同狀態，須各自取得證據。

## 目前路徑

- Bundle ID：`io.github.nickyclin.latticeterm`。不要沿用舊企業版 `tw.nickyclin.latticeterm`。
- 行銷版本由 `package.json` 與 `src-tauri/tauri.conf.json` 決定；`ios:sync` 同步 XcodeGen／原生 plist。
- 每次送件指定新的建置號，例如同一版本先送 `1`，修正後送 `2`。使用 `bundle.iOS.bundleVersion`，避免把第四段數字附加到版本。
- TestFlight 與 App Store 都用 `app-store-connect` 匯出；`enterprise` 是其他分發管道，`release-testing` 也不作為這裡的 TestFlight 上傳設定。
- `ios:build` 只建立 IPA，不上傳、不加入測試者、不送出審核。

## 不需要 Apple 帳號的檢查

```sh
npm ci
npm run ios:check
npm run typecheck
npm run build
npm run ios:prepare -- --build-number 1
```

`ios:prepare` 會更新原生版本鏡像，並將不含帳號資料的合併設定寫入已忽略的 `src-tauri/gen/apple/.release/`。未加入 Apple Developer Program 也可以準備與檢查原始碼。

安裝 Rust iOS target 後，以符合 Mac 架構的目標建置模擬器：

```sh
# Apple silicon
rustup target add aarch64-apple-ios-sim
npm run ios:simulator

# Intel Mac
rustup target add x86_64-apple-ios
npm run ios:simulator
```

`ios:simulator` 自動選擇主機架構，並在暫存目錄建立只供該子程序使用的 Xcode 呼叫入口，明確傳入 Simulator SDK、destination 與單一主機架構；避免 Tauri 2.11.4 封存時誤用實機 SDK，或 Xcode Release 同時連結兩種架構但 Tauri 只產生主機架構的 `libapp.a`。它仍執行 `xcrun --find xcodebuild` 找到的真正 Xcode 工具，不修改 Xcode 安裝或正式實機專案。預設測試建置號為 `1`，可用 `--build-number` 覆寫。

使用 `npm run ios:simulator:release` 建置經最佳化的模擬器產物，再加上 `--require-declared-api` 執行下述 bundle 檢查，可及早發現 Release 仍保留的未宣告 C API。這個流程仍不需要 Apple 簽章；不能拿模擬器產物上傳商店。

對產生的 `.app` 執行 `python3 scripts/verify-ios-app.py /實際路徑/LatticeTerm.app --check-api-symbols`，檢查 Bundle ID、行銷版本、執行檔、隱私清單、區網說明與桌面 sidecar 邊界，並輸出 C API 匯入盤點。再用 `xcrun simctl install booted /實際路徑/LatticeTerm.app` 與 `xcrun simctl launch booted io.github.nickyclin.latticeterm` 安裝、啟動；產物檢查本身不代表啟動已成功。

`.github/workflows/ios-verify.yml` 會在相關變更推至 `main`、建立 PR 或手動觸發時，使用 macOS runner 上的 Xcode 26 以上版本編譯無簽章的 Release 模擬器 App，再建立實機 archive，分別檢查 bundle。模擬器另以新建的 iPhone／iPad 裝置安裝與啟動，確認程序仍在執行，並以本機 OCR 確認初始連線頁與新增按鈕皆已顯示；保留原始截圖供檢閱，完成後刪除這次測試建立的裝置。這不是完整互動或實機測試。實機產物另檢查 iOS 26 以上 SDK，未宣告的 C API 類別會讓工作失敗。CI 不需要 Apple 密鑰。

通過 bundle 檢查後，CI 會保留 `ios-unsigned-release-<commit>` artifact 七天，包含模擬器 App、無簽章實機 archive、兩份 JSON 檢查報告與 `provenance.json`。封裝使用 tar 保留執行權限；provenance 記錄來源 commit、執行編號、模擬器架構及 SHA-256。請先對照來源及雜湊，再將模擬器 App 安裝到相容架構的模擬器。實機 archive 不能直接安裝到手機或上傳商店。iPhone／iPad 的啟動截圖另外存於 `ios-simulator-launch-evidence`，保留十四天；下載到封裝 artifact 不代表後續啟動步驟已成功，仍須確認該次 workflow 結果。

本機可執行 `npm run ios:device:unsigned` 建立 `src-tauri/gen/apple/build/lattice-term_iOS.xcarchive`，再對其中 `Products/Applications/LatticeTerm.app` 執行 `--require-store-sdk` 檢查。這是無簽章的實機 Release archive，供提早檢查 SDK 與隱私資源；不能直接安裝到 iPhone 或上傳 App Store Connect。正式發行仍走下面的簽章封裝流程。

### 商店截圖候選素材

CI 加上 `--store-screenshots` 時，保留原本較窄 iPhone 的啟動檢查，另啟動符合 6.9 吋商店尺寸的 Pro Max，並選用 13 吋 iPad。只有主畫面就緒後，才直接由模擬器擷取 JPEG 至 `ios-simulator-launch-evidence/app-store/`；`launch-report.json` 會記錄機型、尺寸、格式及不含 Alpha 的檢查結果。缺少適合機型或尺寸不符會讓工作失敗。

一般 `simctl` PNG 截圖帶有 Alpha 通道，不能直接當成商店素材。這個流程直接擷取原生 JPEG，不縮放、拼接或重畫 App 介面；iPhone 使用 6.9 吋尺寸，iPad 使用 13 吋尺寸。依 [Apple 截圖規格](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications)，提供 6.9 吋截圖即可取代 6.5 吋必填尺寸，支援 iPad 的 App 另需 13 吋截圖。

這些素材只呈現初始連線頁，需先人工檢閱才能加入商店草稿；還應補拍 SSH、SFTP 等實際功能畫面。流程不會自動上傳圖片或送審，原始啟動 PNG 仍另外保留為驗證證據。

## iPhone／iPad 的檔案操作

- 連線頁的「匯出」會將連線 JSON 儲存至 App 的 Documents。
- 設定中的加密備份必須完成加密與檔案寫入，才會顯示匯出成功。同名檔案會自動加上編號，不會覆蓋舊備份。
- SFTP 與 Lattice 遠端檔案下載使用同一個 Documents 位置。
- 開啟 iOS「檔案」App →「瀏覽」→「我的 iPhone／iPad」→「LatticeTerm」，即可取得、分享或移動這些檔案。備份若要保留在移除 App 之後，請先移至 iCloud 雲碟或其他位置。
- 連線 JSON 或加密備份的匯入仍由 App 內的檔案選擇器操作。選取 JSON 後會先驗證內容；還原備份需輸入備份密碼並確認。

`UIFileSharingEnabled` 與 `LSSupportsOpeningDocumentsInPlace` 會合併進最終 Info.plist，bundle 檢查會拒絕缺少設定的產物。分享範圍為 Documents；連線資料庫、主機信任與 Vault 仍存於 Library/Application Support，Keychain 也不會因這個設定對外分享。參考 [Apple 檔案分享設定](https://developer.apple.com/documentation/bundleresources/information-property-list/uifilesharingenabled)。

送測前請在實機完成：匯出連線 → 在「檔案」找到 → 再匯入；加密備份 → 移至 iCloud → 還原；SFTP 上傳／下載與重複檔名測試。程式測試與模擬器啟動檢查不代表這些實機互動已驗證。

## 正式封裝

2026-09-05 查核：Apple 自 2026-04-28 起要求 App Store Connect 上傳版本使用 Xcode 26 以上及 iOS 26 SDK 以上。這是建置 SDK 要求，不是把 App 的最低支援系統改成 iOS 26。[官方要求](https://developer.apple.com/news/upcoming-requirements/)

準備條件：

1. 確認已加入有效的 Apple Developer Program，並擁有目標 App／Bundle ID 的權限。免費 Personal Team 只適用開發測試，不能取代商店分發資格。
2. 在 Xcode 登入帳號，確認開發／發行簽章與 provisioning 可用。帳號登入與 2FA 由本人完成，不放進 repository。
3. 在 App Store Connect 建立對應的 iOS App 記錄，Bundle ID 必須相同。
4. 安裝 `aarch64-apple-ios` target，設定實際團隊後執行：

```sh
export APPLE_DEVELOPMENT_TEAM=你的十碼團隊識別碼
npm run ios:preflight
npm run ios:build -- --build-number 1
```

`ios:preflight` 明確列出工具、SDK、Team ID 與本機簽章缺項；它不會查驗付費資格或代替 Apple 的 provisioning 檢查。`ios:build` 發現缺項便在封裝前停止。使用新建置號前，先查看 App Store Connect 已使用的值，避免重複。

用 `python3 scripts/verify-ios-app.py /解開IPA後/Payload/LatticeTerm.app --build-number 1 --require-store-sdk` 檢查正式產物；再由 Xcode Organizer／Transporter 驗證與上傳。Tauri CLI 的封裝方式可參考[官方 App Store 文件](https://v2.tauri.app/distribute/app-store/)。

### GitHub 的正式簽章封裝

`.github/workflows/ios-release.yml` 提供手動觸發的 `iOS signed release` 工作，只接受 `main`，以 Xcode 26 以上版本建置 IPA。它使用 `ios-app-store` environment；設定時將允許的部署分支限制為 `main`，不要將簽章 secrets 放在 PR 工作中。

在該 environment 設定：

- Variable `APPLE_DEVELOPMENT_TEAM`：付費個人或組織團隊的 Team ID。
- Secret `IOS_CERTIFICATE`：含私密金鑰的 Apple Distribution P12，轉成不含換行的 Base64。
- Secret `IOS_CERTIFICATE_PASSWORD`：匯出 P12 時使用的密碼。
- Secret `IOS_MOBILE_PROVISION`：對應同一 Team、Bundle ID 與憑證的 App Store Connect 描述檔，轉成不含換行的 Base64。

憑證、私密金鑰與描述檔只存於受保護的本機目錄或 GitHub 加密 secrets，不能提交 repo。Tauri 會在建置時載入手動簽章資料；前置檢查只確認輸入完整，憑證有效性及配對仍須由實際封装與簽章檢查驗證。[Tauri 簽章設定](https://v2.tauri.app/distribute/sign/ios/)

若使用 Tauri 的 API 自動簽章，前置檢查也接受完整的 `APPLE_API_KEY`、`APPLE_API_ISSUER`、`APPLE_API_KEY_PATH`，會檢查 Key ID、Issuer UUID 與 P-256 私密金鑰格式。這不代表金鑰已獲 Apple 授權；目前的 workflow 使用上面的手動簽章，不需要 API 金鑰來匯出 IPA。

執行工作時填入未使用的建置號。工作會解開匯出的 IPA，檢查 SDK、隱私宣告、簽章、Team、App ID、憑證與描述檔配對、到期日及禁止除錯，再保留 `ios-signed-release-<commit>-<build>` artifact 七天。產物包含 IPA、bundle 報告及 SHA-256／來源 commit；不含 P12 或私密金鑰。這個工作只完成封裝，不上傳 Apple、不寄送 TestFlight 邀請，也不提交 App Review。

## 隱私與加密

- `src-tauri/Info.ios.plist` 是區域網路用途說明的來源，Tauri 建置時會合併進 App。直接手改生成的 plist 不足以保證下次建置保留。
- `PrivacyInfo.xcprivacy` 列出本機檔案中繼資料（容器與使用者選取檔案）、計時／逾時用途；宣告不做追蹤。Xcode 專案的 Resources 階段必須包含它。
- 檔案 API 對應 `backup.rs`、`sftp_transfers.rs` 的 metadata 與安全寫入；計時對應 `tunnel.rs`、`remote.rs` 的 Tokio timeout。最終送件須再檢查 Xcode Privacy Report 與連結進入的 SDK，不能只檢查原始碼。批准理由見 [Apple Required Reason API 文件](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype)。
- 2026-09-05 的 x86_64 Debug 模擬器 bundle 含 `fstatfs`、`fstatvfs`、`statvfs` 匯入與 `nix` 檔案系統符號；[Release 模擬器 CI](https://github.com/NickYCLin/lattice-term/actions/runs/33957302485) 的最佳化產物已通過未宣告 API 檢查。實機 Release 仍須單獨驗證，不能直接填入與實際行為不符的 DiskSpace 理由。`--check-api-symbols` 會將未宣告類別列為 `needs_review`；`--require-store-sdk` 會自動盤點並拒絕含未宣告類別的產物。這是保守的 C API 檢查，未涵蓋所有 Objective-C／Swift API，也不取代 Apple 的報告。
- App Store Connect 的 App Privacy 表單與 bundle 的 privacy manifest 是兩份不同資料。依最終產品與第三方服務行為填寫；若之後加入遙測、雲端帳號或代管中繼，需重新盤點。
- App 含 SSH、`ring`、Argon2id 與 XChaCha20-Poly1305；不能因為有 HTTPS 就直接宣告「只用作業系統加密」。此變更刻意沒有填 `ITSAppUsesNonExemptEncryption=false`。由發行者完成 Apple 加密問卷，再依結果補上宣告／文件。[Apple 加密申報說明](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance/)

## 上架前尚須完成的實測與帳號資料

### OpenSSH 相容性回歸

Linux CI 會安裝 `openssh-sftp-server`，並額外執行：

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib openssh_ -- --ignored
```

這 8 項測試直接連接系統 OpenSSH SFTP 子程序的標準輸入／輸出，使用新的臨時目錄與測試資料，不啟動 SSH 服務、不開放連接埠、不需要帳密，也不操作私人主機。macOS 使用系統的 `/usr/libexec/sftp-server`；Linux 使用 `/usr/lib/openssh/sftp-server`。缺少程式會失敗，不能把未執行當成通過。一般 `cargo test` 將它們標示為略過，CI 另行強制執行。

測試涵蓋超過封包大小的大檔往返、上傳暫存與覆蓋權限、取消／未傳完時保留原檔、拒絕覆蓋後來出現的檔案與符號連結、伺服器拒絕權限修改時的清理，以及多批目錄列舉的 10,000 筆上限。測試使用與 App 相同的封包限制及傳輸函式，沒有將測試伺服器或示範帳密加入正式 App。

這只驗證 SFTP 子系統及本機檔案行為，不涵蓋 SSH 握手／登入、同一 SSH 連線的多子通道、網路中斷或 iOS 檔案／Keychain／背景生命週期；下列真機項目仍需完成。子系統參數見 [OpenSSH sftp-server 文件](https://man.openbsd.org/sftp-server)。

### 真機與送審資料

- 用實機驗證首次區域網路允許／拒絕、SSH 密碼與私鑰登入、主機金鑰異動警告、SFTP 上下載／取消、通道關閉、背景／前景切換與 Keychain／保管庫鎖定。
- 用同一 Bundle ID 做覆蓋更新，確認連線設定與保管庫仍可讀；刪除 App 後重裝不能當作資料保留測試。免費簽章與商店簽章的 Keychain 存取仍需實測。
- 依 [送審資料草稿](IOS_APP_STORE_METADATA.zh-TW.md) 補好公開隱私權／支援 URL、真實 iPhone／iPad 截圖、審核連線環境與聯絡人。
- 決定價格、上架地區、年齡分級與出口申報；不替帳號持有人簽署協議。
- 上傳後等待處理，先驗證 TestFlight 安裝與升級，再提交 App Review。此流程完成前不要在下載頁宣稱已可從商店安裝。
