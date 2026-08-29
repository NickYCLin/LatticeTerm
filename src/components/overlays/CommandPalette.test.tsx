import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../../i18n";
import { CommandPalette } from "./CommandPalette";

describe("command palette accessibility", () => {
  it("connects the search combobox to its active listbox option", () => {
    const markup = renderToStaticMarkup(
      <I18nProvider locale="zh-TW">
        <CommandPalette
          commands={[
            {
              id: "settings",
              label: "設定",
              group: "導覽",
              run: vi.fn(),
            },
          ]}
          profiles={[]}
          onSelectProfile={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('aria-controls="palette-list"');
    expect(markup).toContain('aria-activedescendant="palette-option-0"');
    expect(markup).toContain(
      'id="palette-option-0" role="option" tabindex="-1"',
    );
    expect(markup).toContain('<li role="presentation">');
  });
});
