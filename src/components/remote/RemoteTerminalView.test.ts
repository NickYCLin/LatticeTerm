import { describe, expect, it, vi } from "vitest";
import { nativeTerminalClipboard } from "../terminal/nativeTerminalClipboard";
import { remoteTerminalClipboardOptions } from "./RemoteTerminalView";

describe("Lattice Remote terminal clipboard", () => {
  it("uses the native clipboard bridge when WebKitGTK blocks browser access", () => {
    const shouldProcessKeyEvent = vi.fn(() => true);

    expect(remoteTerminalClipboardOptions(shouldProcessKeyEvent)).toEqual({
      ...nativeTerminalClipboard,
      shouldProcessKeyEvent,
    });
  });
});
