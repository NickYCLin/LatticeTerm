import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyFilter } from "../../domain/query";
import { I18nProvider } from "../../i18n";
import { ResourceSidebar } from "./ResourceSidebar";

function renderSidebar(mobileOpen: boolean) {
  return renderToStaticMarkup(
    <I18nProvider locale="zh-TW">
      <ResourceSidebar
        filter={emptyFilter}
        onFilterChange={vi.fn()}
        onReset={vi.fn()}
        filterActive={false}
        groups={[]}
        tags={[]}
        totalCount={0}
        favoriteCount={0}
        visibleCount={0}
        mobileOpen={mobileOpen}
        onMobileClose={vi.fn()}
      />
    </I18nProvider>,
  );
}

describe("resource sidebar mobile drawer", () => {
  it("renders a labelled modal drawer and scrim on mobile", () => {
    const markup = renderSidebar(true);

    expect(markup).toContain('class="scrim resource-sidebar-scrim"');
    expect(markup).toContain('id="resource-sidebar"');
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain(
      'aria-labelledby="resource-sidebar-title" tabindex="-1"',
    );
    expect(markup).toContain('id="resource-sidebar-title"');
    expect(markup).toContain("連線篩選");
    expect(markup).toContain('aria-label="關閉"');
  });

  it("keeps the desktop sidebar non-modal", () => {
    const markup = renderSidebar(false);

    expect(markup).toContain('id="resource-sidebar"');
    expect(markup).not.toContain("resource-sidebar-scrim");
    expect(markup).not.toContain('role="dialog"');
    expect(markup).not.toContain('aria-modal="true"');
    expect(markup).not.toContain("連線篩選");
  });
});
