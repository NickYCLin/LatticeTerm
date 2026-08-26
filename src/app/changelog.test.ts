import { describe, expect, it } from "vitest";
import { parseChangelog } from "./changelog";

describe("parseChangelog", () => {
  it("keeps releases, dates, sections and Traditional Chinese items", () => {
    const releases = parseChangelog(`
## [1.2.0](https://example.com/compare) (2026-08-26)

### 🚀 新增功能

* **工作階段:** 支援巢狀資料夾
* **CLI:** 啟動指示完整送出
`);

    expect(releases).toEqual([
      {
        version: "1.2.0",
        date: "2026-08-26",
        url: "https://example.com/compare",
        sections: [
          {
            title: "🚀 新增功能",
            items: [
              "**工作階段:** 支援巢狀資料夾",
              "**CLI:** 啟動指示完整送出",
            ],
          },
        ],
      },
    ]);
  });

  it("ignores introduction text and releases without entries", () => {
    expect(
      parseChangelog(`
# 更新日誌
說明文字
## [1.0.0](https://example.com/1) (2026-01-01)
## [0.9.0](https://example.com/0) (2025-12-01)
### 修正
- 修正啟動問題
`),
    ).toHaveLength(1);
  });
});
