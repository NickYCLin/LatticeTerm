import { afterEach, describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { attachTerminalClipboard } from "./terminalClipboard";

function fakeTerminal(selection: string | null) {
  const listeners: Record<string, (event: Event) => void> = {};
  const terminal = {
    attachCustomKeyEventHandler: () => {},
    element: {
      addEventListener: (type: string, handler: (event: Event) => void) => {
        listeners[type] = handler;
      },
    },
    hasSelection: () => selection !== null,
    getSelection: () => selection ?? "",
    clearSelection: vi.fn(),
    paste: vi.fn(),
  };
  return { terminal: terminal as unknown as Terminal, mock: terminal, listeners };
}

function fakeContextMenuEvent(): Event {
  return { preventDefault: vi.fn() } as unknown as Event;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("terminal right-click", () => {
  it("copies and drops the selection when one exists", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { terminal, mock, listeners } = fakeTerminal("cli answer");
    attachTerminalClipboard(terminal);

    const event = fakeContextMenuEvent();
    listeners.contextmenu(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith("cli answer");
    expect(mock.clearSelection).toHaveBeenCalled();
    expect(mock.paste).not.toHaveBeenCalled();
  });

  it("pastes clipboard text when nothing is selected", async () => {
    const readText = vi.fn().mockResolvedValue("pasted text");
    vi.stubGlobal("navigator", { clipboard: { readText } });
    const { terminal, mock, listeners } = fakeTerminal(null);
    attachTerminalClipboard(terminal);

    listeners.contextmenu(fakeContextMenuEvent());
    await vi.waitFor(() => expect(mock.paste).toHaveBeenCalledWith("pasted text"));
  });
});
