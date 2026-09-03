# iOS 模擬器版設計

## 目標

讓 LatticeTerm 在 macOS 的 Xcode iOS Simulator 上可以建置、安裝與啟動，並維持既有 Android 行動版的功能邊界。

## 範圍與邊界

- 以 Tauri 2 產生並納入版本控制的 iOS 原生專案為唯一原生殼層；不手寫或替換 Tauri 產生的 bridge。
- iOS 套用行動版設定：不打包 `externalBin`，因此 RDP、VNC、Lattice Remote 分享和本機 Agent Fleet 等桌面 sidecar 功能不會進入 iOS App。
- 既有 React 行動介面與 Rust 的 SSH、SFTP、Tunnel、保管庫、主機信任核心維持共用；`runtime_summary` 的 `ios` 平台值驅動既有的行動版導覽與協定過濾。
- 本階段的交付是已驗證的 Simulator build 與 Xcode 專案。實機 code signing、App Store Connect、TestFlight、隱私權宣告與上架素材是後續獨立發布階段。

## 實作方式

1. 以 npm lockfile 安裝既有 Tauri CLI，安裝 Rust stable 與 Tauri 官方所列的 iOS targets。
2. 執行 `npx tauri ios init` 產生 Tauri 的 Apple/Xcode 專案，保留既有 bundle identifier `io.github.nickyclin.latticeterm`。
3. 新增 `tauri.ios.conf.json`，與 Android 設定一樣將 `bundle.externalBin` 清空，保證 iOS build 不納入或嘗試執行桌面 sidecar。
4. 以 simulator target 完成 Tauri iOS build；再由 Tauri 開啟 Xcode，並以 Xcode build 驗證產生的 scheme。

## 驗證

- `npm ci` 後執行既有 TypeScript 型別檢查與相關行動版測試。
- `npx tauri ios build --debug --target aarch64-sim` 必須成功。
- Xcode project 的 simulator scheme 必須以 Tauri 叫用的 `xcodebuild` 成功編譯；完成後將 app 安裝並啟動於 iPhone Simulator。
- 檢查 iOS 設定不含 `externalBin`，並確認 Git diff 僅包含 iOS 原生檔、設定、文件和必要測試。

## 風險處理

- Rust crate 或桌面專用程式碼若無法編譯到 iOS，先以現有 Android 的平台 gate 為範本做最小 `cfg` 隔離，並以測試固定行動功能清單；不以移除核心功能換取編譯成功。
- 模擬器無法證明實機簽章、網路權限或 Keychain 行為。這些會明確記為未驗證項目，不宣稱已可 TestFlight 發布。
