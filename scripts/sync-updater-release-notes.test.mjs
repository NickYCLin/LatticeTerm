import { describe, expect, it } from "vitest";

import { syncUpdaterReleaseNotes } from "./sync-updater-release-notes.mjs";

describe("syncUpdaterReleaseNotes", () => {
  it("把正式 Release 說明同步進 updater manifest 並保留平台資料", () => {
    const manifest = {
      version: "0.9.6",
      notes: "",
      pub_date: "2026-08-21T20:09:42.678Z",
      platforms: {
        "windows-x86_64": {
          signature: "signed",
          url: "https://api.github.com/releases/assets/1",
        },
      },
    };

    expect(
      syncUpdaterReleaseNotes(manifest, {
        body: "  ## 問題修正\n\n- 修正版本說明  ",
      }),
    ).toEqual({
      ...manifest,
      notes: "## 問題修正\n\n- 修正版本說明",
    });
    expect(manifest.notes).toBe("");
  });

  it("拒絕空白版本說明，避免覆蓋 updater manifest", () => {
    expect(() =>
      syncUpdaterReleaseNotes(
        { version: "0.9.6", platforms: { linux: {} } },
        { body: "  " },
      ),
    ).toThrow("版本說明不可為空白");
  });

  it("拒絕缺少版本或平台資料的 manifest", () => {
    expect(() =>
      syncUpdaterReleaseNotes({ version: "0.9.6" }, { body: "版本說明" }),
    ).toThrow("latest.json 缺少版本或平台資料");
  });
});
