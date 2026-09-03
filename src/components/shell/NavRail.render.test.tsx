import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { navigationItems } from "../../app/navigation";
import { I18nProvider } from "../../i18n";
import { NavRail } from "./NavRail";

describe("navigation activity badge", () => {
  it("shows an accessible unread count on the Activity bell", () => {
    const markup = renderToStaticMarkup(
      <I18nProvider locale="zh-TW">
        <NavRail
          current="connections"
          onSelect={vi.fn()}
          items={navigationItems}
          activityUnreadCount={3}
        />
      </I18nProvider>,
    );

    expect(markup).toContain('aria-label="活動，3 個未讀"');
    expect(markup).toContain('class="rail__badge"');
    expect(markup).toContain(">3</span>");
  });

  it("caps the visual badge while retaining the full accessible count", () => {
    const markup = renderToStaticMarkup(
      <I18nProvider locale="en">
        <NavRail
          current="activity"
          onSelect={vi.fn()}
          items={navigationItems}
          activityUnreadCount={120}
        />
      </I18nProvider>,
    );

    expect(markup).toContain('aria-label="Activity, 120 unread"');
    expect(markup).toContain(">99+</span>");
  });
});
