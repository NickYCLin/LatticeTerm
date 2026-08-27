import type { Terminal } from "@xterm/xterm";

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
 * composition text. The terminal stays focused and the opaque composition
 * overlay covers the cursor without changing xterm's theme. Changing the
 * theme here forces a full terminal repaint at the start and end of every IME
 * composition, which is itself visible as a flash while typing.
 */
export class TerminalImePresentation {
  private composing = false;
  private positionFrozen = false;
  private textareaCleanupTimer?: ReturnType<typeof globalThis.setTimeout>;
  private readonly trimTrailingCompositionSpace: boolean;
  private readonly onCompositionStart = () => {
    if (this.textareaCleanupTimer !== undefined) {
      globalThis.clearTimeout(this.textareaCleanupTimer);
      this.textareaCleanupTimer = undefined;
    }
    this.composing = true;
    this.clearFrozenPosition();
    // Full-screen CLIs can enable DEC private cursor blinking after the
    // terminal was created. Freeze it again while the user is reviewing and
    // selecting IME candidates so the caret does not flash through preedit.
    this.terminal.options.cursorBlink = false;
    this.terminal.element?.classList.add("is-ime-composing");
  };
  private readonly onCompositionUpdate = () => {
    if (!this.composing || this.positionFrozen) return;
    const root = this.terminal.element;
    const compositionView = root?.querySelector<HTMLElement>(
      ".composition-view.active",
    );
    if (!root || !compositionView) return;
    const left = compositionView.style.left || this.textarea?.style.left;
    const top = compositionView.style.top || this.textarea?.style.top;
    if (!left || !top) return;

    // xterm recalculates the preedit overlay and hidden textarea from its live
    // buffer cursor after every composition update. Terminal output can move
    // that cursor while Windows TSF is still composing, making unfinished
    // Chinese text jump and flash. Lock both elements to the first preedit
    // position until Windows commits or cancels the composition.
    root.style.setProperty("--latticeterm-ime-left", left);
    root.style.setProperty("--latticeterm-ime-top", top);
    root.classList.add("is-ime-position-frozen");
    this.positionFrozen = true;
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
    trimTrailingCompositionSpace = linuxWebKitCompositionQuirks(),
  ) {
    this.trimTrailingCompositionSpace = trimTrailingCompositionSpace;
    textarea?.addEventListener("compositionstart", this.onCompositionStart);
    textarea?.addEventListener("compositionupdate", this.onCompositionUpdate);
    textarea?.addEventListener("compositionend", this.onCompositionEnd);
    textarea?.addEventListener("blur", this.onBlur);
    textarea?.addEventListener("input", this.onInput);
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
    this.textarea?.removeEventListener(
      "compositionupdate",
      this.onCompositionUpdate,
    );
    this.textarea?.removeEventListener("compositionend", this.onCompositionEnd);
    this.textarea?.removeEventListener("blur", this.onBlur);
    this.textarea?.removeEventListener("input", this.onInput);
    this.terminal.element?.classList.remove("is-ime-composing");
    this.clearFrozenPosition();
  }

  private finish() {
    this.composing = false;
    this.terminal.element?.classList.remove("is-ime-composing");
    this.clearFrozenPosition();
  }

  private clearFrozenPosition() {
    const root = this.terminal.element;
    root?.classList.remove("is-ime-position-frozen");
    root?.style.removeProperty("--latticeterm-ime-left");
    root?.style.removeProperty("--latticeterm-ime-top");
    this.positionFrozen = false;
  }
}
