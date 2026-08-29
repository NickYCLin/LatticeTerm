import { invoke } from "@tauri-apps/api/core";

/**
 * Narrow native bridge for WebViews that deny navigator.clipboard.
 *
 * The callbacks are only reached from explicit terminal copy/paste gestures;
 * browser preview mode simply rejects the invoke and keeps the web fallback.
 */
export const nativeTerminalClipboard = {
  readTextFallback: () =>
    invoke<string | null>("terminal_clipboard_read_text"),
  writeTextFallback: (text: string) =>
    invoke<void>("terminal_clipboard_write_text", { text }),
};
