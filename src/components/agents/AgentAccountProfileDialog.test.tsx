import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { AgentAccountProfileDialog } from "./AgentAccountProfileDialog";

describe("AgentAccountProfileDialog", () => {
  it("uses the app dialog with both account fields instead of a browser prompt", () => {
    const markup = renderToStaticMarkup(
      <I18nProvider locale="zh-TW">
        <AgentAccountProfileDialog
          agentLabel="OpenAI Codex"
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("新增另一個 OpenAI Codex 帳號");
    expect(markup).toContain("在開出來的終端機裡照助理的提示登入一次");
    expect(markup).toContain("帳號名稱");
    expect(markup).toContain("選擇設定目錄");
    expect(markup).not.toContain("JavaScript");
  });
});
