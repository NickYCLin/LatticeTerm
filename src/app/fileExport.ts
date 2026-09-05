export type FileExportResult =
  | { destination: "ios-documents"; filename: string }
  | { destination: "download" };

/** iOS exports must reach a user-visible location, outside private app data. */
export async function exportTextFile(
  contents: string,
  filename: string,
  platform?: string,
): Promise<FileExportResult> {
  if (platform === "ios") {
    const { invoke } = await import("@tauri-apps/api/core");
    const saved = await invoke<string>("ios_export_document", { filename, contents });
    return { destination: "ios-documents", filename: saved };
  }

  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const anchor = document.createElement("a");
  try {
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    // Give the WebView time to start consuming the URL before revoking it.
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
  return { destination: "download" };
}
