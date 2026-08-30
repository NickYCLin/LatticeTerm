import { describe, expect, it, vi } from "vitest";
import { nativeTerminalClipboard } from "../terminal/nativeTerminalClipboard";
import {
  attachRemoteTerminalOutput,
  remoteTerminalClipboardOptions,
} from "./RemoteTerminalView";

describe("Lattice Remote terminal clipboard", () => {
  it("uses the native clipboard bridge when WebKitGTK blocks browser access", () => {
    const shouldProcessKeyEvent = vi.fn(() => true);

    expect(remoteTerminalClipboardOptions(shouldProcessKeyEvent)).toEqual({
      ...nativeTerminalClipboard,
      shouldProcessKeyEvent,
    });
  });
});

describe("Lattice Remote terminal output", () => {
  it("writes replayed bytes through the app-wide stream and unsubscribes", () => {
    const unsubscribe = vi.fn();
    let handler: ((bytes: Uint8Array) => void) | undefined;
    const onTerminalData = vi.fn(
      (_sessionId: string, next: (bytes: Uint8Array) => void) => {
        handler = next;
        return unsubscribe;
      },
    );
    const terminal = { write: vi.fn() };

    const stop = attachRemoteTerminalOutput(
      { onTerminalData },
      "remote-terminal-1",
      terminal,
    );
    const bytes = new Uint8Array([0xe4, 0xb8, 0xad]);
    handler?.(bytes);

    expect(onTerminalData).toHaveBeenCalledWith(
      "remote-terminal-1",
      expect.any(Function),
    );
    expect(terminal.write).toHaveBeenCalledWith(bytes);
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
