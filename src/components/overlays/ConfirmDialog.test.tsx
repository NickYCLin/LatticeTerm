import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("locks every action and exposes the busy state while work is pending", () => {
    const markup = renderToStaticMarkup(
      <ConfirmDialog
        title="Delete session?"
        body="This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        busy
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-busy="true"');
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });

  it("keeps cancel available when only confirmation is unavailable", () => {
    const markup = renderToStaticMarkup(
      <ConfirmDialog
        title="Delete connection?"
        body="Checking credentials."
        confirmLabel="Checking"
        cancelLabel="Cancel"
        confirmDisabled
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(markup).not.toContain('aria-busy="true"');
    expect(markup.match(/disabled=""/g)).toHaveLength(1);
  });
});
