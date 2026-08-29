import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createConnectionProfile, emptyDraft } from "../../domain/connection";
import { I18nProvider } from "../../i18n";
import { ConnectionDrawer } from "./ConnectionDrawer";
import {
  radioNavigationIndex,
  radioNavigationTargetIndex,
} from "./radioNavigation";

function renderDrawer(
  profile: Parameters<typeof ConnectionDrawer>[0]["profile"] = null,
) {
  return renderToStaticMarkup(
    <I18nProvider locale="zh-TW">
      <ConnectionDrawer
        profile={profile}
        profiles={profile ? [profile] : []}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    </I18nProvider>,
  );
}

describe("connection drawer", () => {
  it("keeps the primary add flow compact and actionable", () => {
    const markup = renderDrawer();

    expect(
      markup.match(/class="protocol-option(?: is-selected)?"/g),
    ).toHaveLength(5);
    expect(markup).toContain("連線資料");
    expect(markup).toContain("使用者名稱");
    expect(markup).toContain("進階整理");
    expect(markup).toContain("儲存並連線");
    expect(markup).not.toContain("登入資訊");
    expect(markup).not.toContain("檢查設定");
    expect(markup.match(/role="radio"[^>]*tabindex="0"/g)).toHaveLength(2);
    expect(markup.match(/role="radio"[^>]*tabindex="-1"/g)).toHaveLength(7);
  });

  it("uses the expected wrapping keyboard navigation for radio groups", () => {
    expect(radioNavigationIndex("ArrowRight", 4, 5)).toBe(0);
    expect(radioNavigationIndex("ArrowDown", 1, 5)).toBe(2);
    expect(radioNavigationIndex("ArrowLeft", 0, 5)).toBe(4);
    expect(radioNavigationIndex("ArrowUp", 3, 5)).toBe(2);
    expect(radioNavigationIndex("Home", 3, 5)).toBe(0);
    expect(radioNavigationIndex("End", 1, 5)).toBe(4);
    expect(radioNavigationIndex("Tab", 1, 5)).toBeNull();
    expect(radioNavigationIndex("ArrowRight", -1, 5)).toBeNull();
    expect(
      radioNavigationTargetIndex("ArrowRight", 0, [false, true, false]),
    ).toBe(2);
    expect(
      radioNavigationTargetIndex("ArrowLeft", 0, [false, true, false]),
    ).toBe(2);
    expect(
      radioNavigationTargetIndex("ArrowRight", 0, [true, true, true]),
    ).toBeNull();
  });

  it("does not show an irrelevant username for VNC", () => {
    const draft = {
      ...emptyDraft("vnc"),
      name: "Shared screen",
      hostname: "screen.example.com",
      username: "stale-user",
    };
    const markup = renderDrawer(createConnectionProfile(draft, "vnc-test"));

    expect(markup).toContain("VNC");
    expect(markup).toContain("screen.example.com");
    expect(markup).not.toContain("使用者名稱");
    expect(markup).not.toContain("stale-user");
  });

  it("explains direct mode without asking for a Remote username", () => {
    const draft = {
      ...emptyDraft("lattice"),
      name: "Office Remote",
      hostname: "192.0.2.10",
      username: "stale-user",
    };
    const markup = renderDrawer(
      createConnectionProfile(draft, "remote-test"),
    );

    expect(markup).toContain("加密直連模式");
    expect(markup).toContain("以 ID 連線");
    expect(markup).not.toContain("使用者名稱");
    expect(markup).not.toContain("stale-user");
  });
});
