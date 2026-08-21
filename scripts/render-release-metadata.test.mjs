import { describe, expect, it } from "vitest";

import { buildReleaseMetadata } from "./render-release-metadata.mjs";

describe("buildReleaseMetadata", () => {
  it("將指定版本更新日誌轉成既有 Release 的繁中格式", () => {
    const changelog = `# 更新日誌

## [0.9.2](https://example.test/compare) (2026-08-21)

### 🛠️ 問題修正

* **VNC:** 補發新版 Rust 像素分塊相容修正 ([73a3155](https://github.com/example/repo/commit/73a3155415c2109d315d9e1bab3ad554bb93607c))

## [0.9.1](https://example.test/compare) (2026-08-20)

### 🚀 新增功能

* **更新:** 舊版內容
`;

    expect(buildReleaseMetadata(changelog, "v0.9.2")).toEqual({
      name: "LatticeTerm v0.9.2 - VNC：補發新版 Rust 像素分塊相容修正",
      body: "## 🛠️ 問題修正與優化\n\n* **VNC**：補發新版 Rust 像素分塊相容修正",
    });
  });

  it("保留人工撰寫的多層功能說明", () => {
    const changelog = `## [1.0.0] (2026-08-21)

### 🚀 新增功能
* **遠端桌面**：
  - 支援完整主螢幕加密傳輸。
  - 支援使用者自行錄影與截圖。
`;

    const result = buildReleaseMetadata(changelog, "v1.0.0");

    expect(result.name).toBe("LatticeTerm v1.0.0 - 遠端桌面");
    expect(result.body).toContain("## 🚀 新增功能");
    expect(result.body).toContain("  - 支援使用者自行錄影與截圖。");
  });

  it("拒絕不存在的版本，避免發布空白說明", () => {
    expect(() => buildReleaseMetadata("# 更新日誌", "v9.9.9")).toThrow(
      "CHANGELOG.md 找不到 9.9.9 的版本段落",
    );
  });

  it("以前三個主要項目組成產品化版本標題", () => {
    const changelog = `## [2.0.0] (2026-08-21)

### 🚀 新增功能
* **SSH 通道**：安全轉送。
* **原創主題**：新增七套主題。
* **工作階段續接**：保留歷史上下文。
* **其他功能**：不應進入標題。
`;

    expect(buildReleaseMetadata(changelog, "v2.0.0").name).toBe(
      "LatticeTerm v2.0.0 - SSH 通道、原創主題與工作階段續接",
    );
  });

  it("連接英文縮寫前保留可讀空格", () => {
    const changelog = `## [2.1.0] (2026-08-21)

### 🚀 新增功能
* **大檔串流**：解除大小限制。
* **VNC 遠端桌面**：新增連線模式。
`;

    expect(buildReleaseMetadata(changelog, "v2.1.0").name).toBe(
      "LatticeTerm v2.1.0 - 大檔串流與 VNC 遠端桌面",
    );
  });
});
