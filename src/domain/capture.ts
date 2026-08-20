/** Pure helpers shared by the Canvas screenshot and recording controls. */

export const recordingMimeTypes = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4",
] as const;

export function preferredRecordingMimeType(
  isSupported: (mimeType: string) => boolean,
): string | undefined {
  return recordingMimeTypes.find(isSupported);
}

function twoDigits(value: number): string {
  return value.toString().padStart(2, "0");
}

export function captureFilename(
  label: string,
  extension: "png" | "webm" | "mp4",
  now: Date = new Date(),
): string {
  const safeLabel = label
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 64) || "session";
  const timestamp = [
    now.getFullYear(),
    twoDigits(now.getMonth() + 1),
    twoDigits(now.getDate()),
    "-",
    twoDigits(now.getHours()),
    twoDigits(now.getMinutes()),
    twoDigits(now.getSeconds()),
  ].join("");
  return `latticeterm-${safeLabel}-${timestamp}.${extension}`;
}

export function recordingExtension(mimeType: string): "webm" | "mp4" {
  return mimeType.toLowerCase().includes("mp4") ? "mp4" : "webm";
}

export function formatRecordingDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  return `${twoDigits(minutes)}:${twoDigits(safe % 60)}`;
}
