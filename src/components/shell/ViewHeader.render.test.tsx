import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../../i18n";
import { ViewHeader } from "./ViewHeader";

function renderHeader(sidebarCollapsed: boolean, sidebarIsDialog: boolean) {
  return renderToStaticMarkup(
    <I18nProvider locale="zh-TW">
      <ViewHeader
        title="我的連線"
        description="測試"
        sidebarCollapsed={sidebarCollapsed}
        sidebarIsDialog={sidebarIsDialog}
        onToggleSidebar={vi.fn()}
      />
    </I18nProvider>,
  );
}

describe("view header sidebar disclosure", () => {
  it("announces the expanded desktop sidebar and its controlled region", () => {
    const markup = renderHeader(false, false);

    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('aria-controls="resource-sidebar"');
    expect(markup).not.toContain("aria-haspopup");
    expect(markup).not.toContain("aria-pressed");
  });

  it("announces a collapsed mobile dialog", () => {
    const markup = renderHeader(true, true);

    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-controls="resource-sidebar"');
    expect(markup).toContain('aria-haspopup="dialog"');
  });
});
