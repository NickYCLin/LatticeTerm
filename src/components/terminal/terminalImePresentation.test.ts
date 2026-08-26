import type { ITheme } from "@xterm/xterm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalImePresentation } from "./terminalImePresentation";

function harness() {
  const textarea = new EventTarget() as HTMLTextAreaElement;
  const classes = new Set<string>();
  const element = {
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
      contains: (name: string) => classes.has(name),
    },
  } as unknown as HTMLElement;
  const terminal = {
    element,
    options: {
      theme: {} as ITheme,
    },
  };
  const presentation = new TerminalImePresentation(
    terminal,
    textarea,
    {
      background: "#101820",
      foreground: "#f0f6fc",
      cursor: "#58a6ff",
      cursorAccent: "#101820",
    },
    true,
  );
  return { textarea, element, terminal, presentation };
}

describe("TerminalImePresentation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("hides the terminal cursor while IME text is being composed", () => {
    const { textarea, element, terminal } = harness();

    textarea.dispatchEvent(new Event("compositionstart"));

    expect(terminal.options.theme.cursor).toBe("#101820");
    expect(terminal.options.theme.cursorAccent).toBe("#101820");
    expect(element.classList.contains("is-ime-composing")).toBe(true);
  });

  it("restores the cursor when composition finishes", () => {
    const { textarea, element, terminal } = harness();
    textarea.dispatchEvent(new Event("compositionstart"));

    textarea.dispatchEvent(new Event("compositionend"));

    expect(terminal.options.theme.cursor).toBe("#58a6ff");
    expect(element.classList.contains("is-ime-composing")).toBe(false);
  });

  it("keeps terminal key handling paused until composition finishes", () => {
    const { textarea, presentation } = harness();
    expect(presentation.shouldProcessTerminalKeyEvent()).toBe(true);

    textarea.dispatchEvent(new Event("compositionstart"));
    expect(presentation.shouldProcessTerminalKeyEvent()).toBe(false);

    textarea.dispatchEvent(new Event("compositionend"));
    expect(presentation.shouldProcessTerminalKeyEvent()).toBe(true);
  });

  it("clears committed WebKit textarea text before the next composition", () => {
    vi.useFakeTimers();
    const { textarea } = harness();
    textarea.value = "測試 ";
    textarea.dispatchEvent(new Event("compositionstart"));
    textarea.dispatchEvent(new Event("compositionend"));

    expect(textarea.value).toBe("測試 ");
    vi.runAllTimers();

    expect(textarea.value).toBe("");
  });

  it("does not clear a new composition started before cleanup", () => {
    vi.useFakeTimers();
    const { textarea } = harness();
    textarea.value = "第一段";
    textarea.dispatchEvent(new Event("compositionstart"));
    textarea.dispatchEvent(new Event("compositionend"));
    textarea.value = "第二段";
    textarea.dispatchEvent(new Event("compositionstart"));

    vi.runAllTimers();

    expect(textarea.value).toBe("第二段");
  });

  it("removes WebKitGTK's trailing Chewing selection space", () => {
    const { textarea } = harness();
    textarea.value = "測試 ";
    const input = new Event("input");
    Object.defineProperties(input, {
      data: { value: "測試 " },
      inputType: { value: "insertFromComposition" },
      isComposing: { value: true },
    });

    textarea.dispatchEvent(input);

    expect(textarea.value).toBe("測試");
  });

  it("preserves ordinary and internal spaces", () => {
    const { textarea } = harness();
    textarea.value = "測 試";
    const input = new Event("input");
    Object.defineProperties(input, {
      data: { value: "測 試" },
      inputType: { value: "insertFromComposition" },
      isComposing: { value: true },
    });

    textarea.dispatchEvent(input);

    expect(textarea.value).toBe("測 試");
  });

  it("keeps a theme change made during composition and restores its cursor", () => {
    const { textarea, terminal, presentation } = harness();
    textarea.dispatchEvent(new Event("compositionstart"));

    presentation.setTheme({
      background: "#ffffff",
      foreground: "#111111",
      cursor: "#7c3aed",
    });
    expect(terminal.options.theme.cursor).toBe("#ffffff");

    textarea.dispatchEvent(new Event("compositionend"));
    expect(terminal.options.theme.cursor).toBe("#7c3aed");
  });

  it("removes listeners when disposed", () => {
    const { textarea, terminal, presentation } = harness();
    const initial = terminal.options.theme;
    presentation.dispose();

    textarea.dispatchEvent(new Event("compositionstart"));

    expect(terminal.options.theme).toBe(initial);
  });
});
