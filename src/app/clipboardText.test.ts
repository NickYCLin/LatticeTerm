import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyTextToClipboard } from "./clipboardText";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("copyTextToClipboard", () => {
  it("finishes with the browser clipboard without invoking the desktop fallback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(copyTextToClipboard("plain text")).resolves.toBeUndefined();

    expect(writeText).toHaveBeenCalledWith("plain text");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("uses the native writer when the browser rejects clipboard access", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.mocked(invoke).mockResolvedValue(undefined);

    await expect(copyTextToClipboard("native text")).resolves.toBeUndefined();

    expect(invoke).toHaveBeenCalledWith("terminal_clipboard_write_text", {
      text: "native text",
    });
  });

  it("uses the native writer when the browser clipboard API is absent", async () => {
    vi.stubGlobal("navigator", {});
    vi.mocked(invoke).mockResolvedValue(undefined);

    await expect(copyTextToClipboard("desktop text")).resolves.toBeUndefined();

    expect(invoke).toHaveBeenCalledWith("terminal_clipboard_write_text", {
      text: "desktop text",
    });
  });

  it("rejects when neither clipboard backend accepts the write", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("browser denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.mocked(invoke).mockRejectedValue(new Error("native unavailable"));

    await expect(copyTextToClipboard("uncopied text")).rejects.toThrow(
      /browser denied.*native unavailable/i,
    );
  });
});
