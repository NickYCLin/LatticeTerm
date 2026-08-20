import { describe, expect, it } from "vitest";
import {
  captureFilename,
  formatRecordingDuration,
  preferredRecordingMimeType,
  recordingExtension,
} from "./capture";

describe("canvas capture helpers", () => {
  it("selects the strongest recording format supported by the WebView", () => {
    expect(
      preferredRecordingMimeType((value) => value === "video/webm;codecs=vp8"),
    ).toBe("video/webm;codecs=vp8");
    expect(preferredRecordingMimeType(() => false)).toBeUndefined();
  });

  it("creates a safe deterministic local filename", () => {
    const when = new Date(2026, 7, 20, 19, 5, 9);
    expect(captureFilename("admin@host / production", "png", when)).toBe(
      "latticeterm-admin-host-production-20260820-190509.png",
    );
    expect(captureFilename("../", "webm", when)).toContain(
      "latticeterm-session-",
    );
  });

  it("matches the extension to the actual recorder MIME type", () => {
    expect(recordingExtension("video/webm;codecs=vp9")).toBe("webm");
    expect(recordingExtension("video/mp4")).toBe("mp4");
  });

  it("formats elapsed recording time without negative values", () => {
    expect(formatRecordingDuration(-1)).toBe("00:00");
    expect(formatRecordingDuration(65.9)).toBe("01:05");
  });
});
