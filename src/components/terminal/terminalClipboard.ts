/**
 * Ctrl+C / Ctrl+V clipboard support for the terminal panes.
 *
 * xterm.js leaves Ctrl+C as an interrupt and has no Ctrl+V binding, which trips
 * up anyone used to a desktop terminal. This mirrors the Windows Terminal rule:
 * Ctrl+C copies when there is a selection and otherwise falls through to ^C, and
 * Ctrl+V pastes. Text is pasted straight in; an image on the clipboard is handed
 * to the optional image handler (agent terminals turn it into a file the CLI can
 * read — SSH panes have no local target, so they simply ignore it).
 */

import type { Terminal } from "@xterm/xterm";

export interface TerminalClipboardOptions {
  /**
   * Called on Ctrl+V when the clipboard holds an image and no usable text.
   * Return value is ignored; the handler decides how to deliver the image.
   */
  onImagePaste?: () => void;
  /**
   * Gives an active IME first refusal over keyboard events. Returning false
   * keeps xterm from finalizing and forwarding unfinished composition text.
   */
  shouldProcessKeyEvent?: (event: KeyboardEvent) => boolean;
}

export function attachTerminalClipboard(
  terminal: Terminal,
  options: TerminalClipboardOptions = {},
): void {
  terminal.attachCustomKeyEventHandler((event) => {
    if (options.shouldProcessKeyEvent?.(event) === false) return false;
    if (event.type !== "keydown") return true;
    // Leave anything with Alt/Meta, or plain keys, to xterm and the shell.
    if (!event.ctrlKey || event.altKey || event.metaKey) return true;

    const key = event.key.toLowerCase();

    if (key === "c" && terminal.hasSelection()) {
      const selection = terminal.getSelection();
      if (selection) {
        void navigator.clipboard.writeText(selection).catch(() => {});
      }
      event.preventDefault();
      return false;
    }

    if (key === "v") {
      event.preventDefault();
      void pasteFromClipboard(terminal, options.onImagePaste);
      return false;
    }

    return true;
  });
}

async function pasteFromClipboard(
  terminal: Terminal,
  onImagePaste?: () => void,
): Promise<void> {
  // Prefer text. Reading structured items lets us tell an image-only clipboard
  // apart from a text one, so the image handler only fires when it should.
  try {
    if (typeof navigator.clipboard.read === "function") {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes("text/plain")) {
          const blob = await item.getType("text/plain");
          const text = await blob.text();
          if (text) terminal.paste(text);
          return;
        }
      }
      const hasImage = items.some((item) =>
        item.types.some((type) => type.startsWith("image/")),
      );
      if (hasImage) {
        onImagePaste?.();
        return;
      }
    }
  } catch {
    // Structured read can be unavailable or blocked; fall back to text below.
  }

  try {
    const text = await navigator.clipboard.readText();
    if (text) terminal.paste(text);
  } catch {
    // Nothing usable on the clipboard.
  }
}
