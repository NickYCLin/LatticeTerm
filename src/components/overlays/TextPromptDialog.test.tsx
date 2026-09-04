import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TextPromptDialog } from "./TextPromptDialog";

describe("TextPromptDialog", () => {
  it("renders a labelled field with the initial value and a disabled submit when empty", () => {
    const markup = renderToStaticMarkup(
      <TextPromptDialog
        title="新的名稱"
        label="名稱"
        confirmLabel="重新命名"
        cancelLabel="取消"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("新的名稱");
    expect(markup).toContain('for="text-prompt-value"');
    expect(markup).toContain('type="submit"');
    expect(markup).toContain('disabled=""');
  });

  it("enables submit when a value is given", () => {
    const markup = renderToStaticMarkup(
      <TextPromptDialog
        title="新的名稱"
        label="名稱"
        initialValue="notes.txt"
        confirmLabel="重新命名"
        cancelLabel="取消"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(markup).toContain('value="notes.txt"');
    expect(markup).not.toContain('disabled=""');
  });
});
