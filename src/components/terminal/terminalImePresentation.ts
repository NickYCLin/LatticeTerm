import type { ITheme, Terminal } from "@xterm/xterm";

function linuxWebKitCompositionQuirks(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return (
    /Linux/.test(ua) &&
    !/Android/.test(ua) &&
    /AppleWebKit/.test(ua) &&
    !/(Chrome|Chromium|Edg)\//.test(ua)
  );
}

/**
 * Keeps xterm's block cursor from flashing through the operating system's IME
 * composition text. The terminal stays focused; only its cursor colour is
 * temporarily matched to the terminal background until the composition is
 * committed or cancelled.
 */
export class TerminalImePresentation {
  private composing = false;
  private textareaCleanupTimer?: ReturnType<typeof globalThis.setTimeout>;
  private readonly trimTrailingCompositionSpace: boolean;
  private baseTheme: ITheme;
  private readonly onCompositionStart = () => {
    if (this.textareaCleanupTimer !== undefined) {
      globalThis.clearTimeout(this.textareaCleanupTimer);
      this.textareaCleanupTimer = undefined;
    }
    this.composing = true;
    this.apply();
    this.terminal.element?.classList.add("is-ime-composing");
  };
  private readonly onCompositionEnd = () => {
    this.finish();
    // xterm reads the committed composition from this hidden textarea in its
    // own zero-delay callback. Clear it in the following callback so WebKitGTK
    // cannot prepend an earlier composition to the next one.
    this.textareaCleanupTimer = globalThis.setTimeout(() => {
      this.textareaCleanupTimer = undefined;
      if (!this.composing && this.textarea) this.textarea.value = "";
    }, 0);
  };
  private readonly onBlur = () => {
    this.finish();
  };
  private readonly onInput = (event: Event) => {
    const input = event as InputEvent;
    if (
      !this.trimTrailingCompositionSpace ||
      input.inputType !== "insertFromComposition" ||
      !input.isComposing ||
      !input.data?.endsWith(" ") ||
      !this.textarea?.value.endsWith(" ")
    ) {
      return;
    }

    // IBus Chewing uses Space to select a candidate. WebKitGTK leaves that
    // selection key in xterm's hidden textarea even though ordinary inputs do
    // not include it in the committed value.
    this.textarea.value = this.textarea.value.slice(0, -1);
  };

  constructor(
    private readonly terminal: Pick<Terminal, "element" | "options">,
    private readonly textarea: HTMLTextAreaElement | undefined,
    theme: ITheme,
    trimTrailingCompositionSpace = linuxWebKitCompositionQuirks(),
  ) {
    this.baseTheme = theme;
    this.trimTrailingCompositionSpace = trimTrailingCompositionSpace;
    textarea?.addEventListener("compositionstart", this.onCompositionStart);
    textarea?.addEventListener("compositionend", this.onCompositionEnd);
    textarea?.addEventListener("blur", this.onBlur);
    textarea?.addEventListener("input", this.onInput);
  }

  setTheme(theme: ITheme) {
    this.baseTheme = theme;
    this.apply();
  }

  /**
   * xterm's composition helper finalizes on ordinary key codes. WebKitGTK can
   * report IME candidate keys such as Space as ordinary keys, so xterm must
   * stay out of the way until the operating system ends the composition.
   */
  shouldProcessTerminalKeyEvent(): boolean {
    return !this.composing;
  }

  dispose() {
    if (this.textareaCleanupTimer !== undefined) {
      globalThis.clearTimeout(this.textareaCleanupTimer);
      this.textareaCleanupTimer = undefined;
    }
    this.textarea?.removeEventListener(
      "compositionstart",
      this.onCompositionStart,
    );
    this.textarea?.removeEventListener("compositionend", this.onCompositionEnd);
    this.textarea?.removeEventListener("blur", this.onBlur);
    this.textarea?.removeEventListener("input", this.onInput);
    this.terminal.element?.classList.remove("is-ime-composing");
  }

  private finish() {
    if (!this.composing) return;
    this.composing = false;
    this.terminal.element?.classList.remove("is-ime-composing");
    this.apply();
  }

  private apply() {
    if (!this.composing) {
      this.terminal.options.theme = this.baseTheme;
      return;
    }

    const background = this.baseTheme.background ?? "#0d1117";
    this.terminal.options.theme = {
      ...this.baseTheme,
      cursor: background,
      cursorAccent: background,
    };
  }
}
