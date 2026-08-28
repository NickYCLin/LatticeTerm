import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { AgentSessionRelocationDialog } from "./AgentSessionRelocationDialog";

describe("Agent session relocation dialog", () => {
  it("shows both paths and how each CLI will continue", () => {
    const markup = renderToStaticMarkup(
      <I18nProvider locale="zh-TW">
        <AgentSessionRelocationDialog
          name="後端重構"
          sessionCount={2}
          fromDirectory={"D:\\project\\old"}
          toDirectory={"D:\\project\\new"}
          summary={{ native: 1, handoff: 1, restart: 0, unsupported: 0 }}
          busy={false}
          error={null}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(markup).toContain("更換「後端重構」的工作目錄？");
    expect(markup).toContain("D:\\project\\old");
    expect(markup).toContain("D:\\project\\new");
    expect(markup).toContain("直接續接 1 個、嘗試帶入近期對話 1 個");
    expect(markup).toContain("更換並重開");
  });

  it("blocks custom commands whose original arguments are unavailable", () => {
    const markup = renderToStaticMarkup(
      <I18nProvider locale="zh-TW">
        <AgentSessionRelocationDialog
          name="自訂命令"
          sessionCount={1}
          fromDirectory={"D:\\old"}
          toDirectory={"D:\\new"}
          summary={{ native: 0, handoff: 0, restart: 0, unsupported: 1 }}
          busy={false}
          error={null}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(markup).toContain("這個分頁目前不能安全更換路徑");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>更換並重開<\/button>/);
  });
});
