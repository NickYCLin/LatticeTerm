import { invoke } from "@tauri-apps/api/core";

function errorDetail(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * Writes non-sensitive text to the clipboard.
 *
 * Browser clipboard access is preferred because it also works in the web
 * preview. WebKitGTK can deny or omit that API, so desktop builds fall back to
 * the native Tauri command. Sensitive values must keep using
 * `copySensitiveText`, which also manages automatic clearing.
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  let browserFailure: unknown = null;
  const clipboard =
    typeof navigator === "undefined" ? undefined : navigator.clipboard;

  if (typeof clipboard?.writeText === "function") {
    try {
      await clipboard.writeText(text);
      return;
    } catch (reason) {
      browserFailure = reason;
    }
  }

  try {
    await invoke<void>("terminal_clipboard_write_text", { text });
  } catch (nativeFailure) {
    const browserDetail = browserFailure
      ? ` Browser clipboard: ${errorDetail(browserFailure)}.`
      : " Browser clipboard API is unavailable.";
    throw new Error(
      `No clipboard backend accepted the write.${browserDetail} Native clipboard: ${errorDetail(nativeFailure)}.`,
    );
  }
}
