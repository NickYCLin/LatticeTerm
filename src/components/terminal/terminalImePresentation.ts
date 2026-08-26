import type { ITheme, Terminal } from "@xterm/xterm";

/**
 * Keeps xterm's block cursor from flashing through the operating system's IME
 * composition text. The terminal stays focused; only its cursor colour is
 * temporarily matched to the terminal background until the composition is
 * committed or cancelled.
 */
export class TerminalImePresentation {
  private composing = false;
  private baseTheme: ITheme;
  private readonly onCompositionStart = () => {
    this.composing = true;
    this.apply();
    this.terminal.element?.classList.add("is-ime-composing");
  };
  private readonly onCompositionEnd = () => {
    this.finish();
  };
  private readonly onBlur = () => {
    this.finish();
  };

  constructor(
    private readonly terminal: Pick<Terminal, "element" | "options">,
    private readonly textarea: HTMLTextAreaElement | undefined,
    theme: ITheme,
  ) {
    this.baseTheme = theme;
    textarea?.addEventListener("compositionstart", this.onCompositionStart);
    textarea?.addEventListener("compositionend", this.onCompositionEnd);
    textarea?.addEventListener("blur", this.onBlur);
  }

  setTheme(theme: ITheme) {
    this.baseTheme = theme;
    this.apply();
  }

  dispose() {
    this.textarea?.removeEventListener(
      "compositionstart",
      this.onCompositionStart,
    );
    this.textarea?.removeEventListener("compositionend", this.onCompositionEnd);
    this.textarea?.removeEventListener("blur", this.onBlur);
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
