# iOS 模擬器版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 LatticeTerm 在 iOS Simulator 上可由 Tauri 與 Xcode 建置、安裝及啟動。

**Architecture:** 以 Tauri CLI 產生並追蹤 Apple/Xcode 殼層，將 iOS 視為既有 Android 行動版的同等目標。iOS 專用設定清除桌面 sidecar binary，既有平台感知介面與純 Rust 行動核心保持不變。

**Tech Stack:** Tauri 2、Rust stable、React 19、TypeScript、Xcode、iOS Simulator。

**Spec:** `docs/superpowers/specs/2026-09-03-ios-simulator-design.md`

## Global Constraints

- Bundle identifier 維持 `io.github.nickyclin.latticeterm`。
- iOS 不包含 `externalBin`，且不得讓 sidecar 功能在行動版顯示為可用。
- 使用既有 npm lockfile；不得新增未經需求支持的前端或原生相依。
- 使用繁體中文文件與 `<type>(<scope>): <subject>` 提交標題。
- 首階段只驗證 Simulator；不宣稱已完成實機簽章或 TestFlight 發布。

---

### Task 1: 建立 iOS 原生殼層與行動版設定

**Files:**

- Create: `src-tauri/gen/apple/**`（由 `npx tauri ios init` 產生）
- Create: `src-tauri/tauri.ios.conf.json`
- Create: `scripts/ios-config.test.mjs`
- Modify: `README.md`
- Modify: `docs/UI_IMPLEMENTATION.zh-TW.md`

**Interfaces:**

- Consumes: `src-tauri/tauri.conf.json` 的產品名稱、版本與 identifier；`src-tauri/tauri.android.conf.json` 的行動 sidecar 邊界。
- Produces: 可被 `npx tauri ios build` 與 Xcode 載入的 Apple project，並使 iOS 的 `bundle.externalBin` 為空陣列。

- [ ] **Step 1: 寫入失敗的設定測試**

新增 Node 測試，讀取 `src-tauri/tauri.ios.conf.json` 並斷言 `bundle.externalBin` 為空陣列。檔案不存在時測試必須失敗。

- [ ] **Step 2: 執行測試確認失敗**

Run: `node --test scripts/ios-config.test.mjs`

Expected: FAIL，因為 `tauri.ios.conf.json` 尚不存在。

- [ ] **Step 3: 產生原生專案與最小設定**

Run: `npx tauri ios init`

Create `src-tauri/tauri.ios.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "build": {
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build"
  },
  "bundle": {
    "externalBin": []
  }
}
```

同步 README 與 UI 實作文件的 iOS 狀態、建置指令與桌面功能限制。

- [ ] **Step 4: 執行設定測試確認通過**

Run: `node --test scripts/ios-config.test.mjs`

Expected: PASS。

- [ ] **Step 5: 提交**

```sh
git add src-tauri/gen/apple src-tauri/tauri.ios.conf.json scripts/ios-config.test.mjs README.md docs/UI_IMPLEMENTATION.zh-TW.md
git commit -m "feat(行動版): 初始化 iOS Simulator 建置"
```

### Task 2: 驗證 Tauri 與 Xcode 的 Simulator build

**Files:**

- Modify: 只有 Task 1 對建置失敗所需的最小修正檔案。

**Interfaces:**

- Consumes: Task 1 的 Apple project 與 iOS 設定。
- Produces: `aarch64-apple-ios-sim` debug build，並由 Xcode 成功編譯其 simulator scheme。

- [ ] **Step 1: 建立並觀察 build 基線**

Run: `npx tauri ios build --debug --target aarch64-apple-ios-sim`

Expected: 初次執行可能因 iOS target 或 desktop-only crate 失敗；完整保存錯誤訊息以決定最小修正。

- [ ] **Step 2: 以失敗訊息為基礎做最小平台隔離**

若 Rust 編譯指向桌面 sidecar 或 PTY，將該 module 或 command registration 以 `#[cfg(desktop)]` 隔離，並讓前端既有的 `runtime_summary` 行動協定清單維持 `ssh`、`sftp`、`lattice`。

- [ ] **Step 3: 執行相關 Rust/前端測試**

Run: `npm run typecheck && npm test -- --run src/app/platformCapabilities.test.ts`

Expected: PASS。

- [ ] **Step 4: 再建置 Simulator**

Run: `npx tauri ios build --debug --target aarch64-apple-ios-sim`

Expected: PASS，產生 Simulator app。

- [ ] **Step 5: 以 Xcode 編譯生成 scheme**

Run: `npx tauri ios dev --open`，再以產生 Apple project 的 simulator scheme 執行 `xcodebuild`。

Expected: Xcode project 成功開啟且 simulator build PASS。

- [ ] **Step 6: 提交修正**

```sh
git add src-tauri src scripts README.md docs
git commit -m "fix(行動版): 讓 iOS Simulator 可編譯"
```
