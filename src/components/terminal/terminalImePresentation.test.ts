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
    options: { cursorBlink: true },
  } as unknown as Pick<
    import("@xterm/xterm").Terminal,
    "element" | "options"
  >;
  const presentation = new TerminalImePresentation(terminal, textarea, true);
  return { textarea, element, presentation, terminal };
}

describe("TerminalImePresentation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("activates the opaque IME overlay while text is being composed", () => {
    const { textarea, element } = harness();

    textarea.dispatchEvent(new Event("compositionstart"));

    expect(element.classList.contains("is-ime-composing")).toBe(true);
  });

  it("stops a CLI-enabled cursor blink while candidates are being reviewed", () => {
    const { textarea, terminal } = harness();
    expect(terminal.options.cursorBlink).toBe(true);

    textarea.dispatchEvent(new Event("compositionstart"));

    expect(terminal.options.cursorBlink).toBe(false);
  });

  it("restores the cursor when composition finishes", () => {
    const { textarea, element } = harness();
    textarea.dispatchEvent(new Event("compositionstart"));

    textarea.dispatchEvent(new Event("compositionend"));

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

  it("clears the composition overlay when the terminal loses focus", () => {
    const { textarea, element, presentation } = harness();
    textarea.dispatchEvent(new Event("compositionstart"));

    textarea.dispatchEvent(new Event("blur"));

    expect(element.classList.contains("is-ime-composing")).toBe(false);
    expect(presentation.shouldProcessTerminalKeyEvent()).toBe(true);
  });

  it("removes listeners when disposed", () => {
    const { textarea, element, presentation } = harness();
    presentation.dispose();

    textarea.dispatchEvent(new Event("compositionstart"));

    expect(element.classList.contains("is-ime-composing")).toBe(false);
  });
});
