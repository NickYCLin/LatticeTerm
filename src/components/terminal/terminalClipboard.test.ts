import { afterEach, describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { attachTerminalClipboard } from "./terminalClipboard";

function fakeTerminal(selection: string | null) {
  const listeners: Record<string, (event: Event) => void> = {};
  let keyEventHandler: ((event: KeyboardEvent) => boolean) | undefined;
  const terminal = {
    attachCustomKeyEventHandler: (
      handler: (event: KeyboardEvent) => boolean,
    ) => {
      keyEventHandler = handler;
    },
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
  return {
    terminal: terminal as unknown as Terminal,
    mock: terminal,
    listeners,
    keyEventHandler: () => keyEventHandler,
  };
}

function fakeContextMenuEvent(): Event {
  return { preventDefault: vi.fn() } as unknown as Event;
}

function fakePasteKeyEvent(): KeyboardEvent {
  return {
    type: "keydown",
    key: "v",
    ctrlKey: true,
    altKey: false,
    metaKey: false,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent;
}

function fakeCopyKeyEvent(): KeyboardEvent {
  return {
    type: "keydown",
    key: "C",
    ctrlKey: true,
    shiftKey: true,
    altKey: false,
    metaKey: false,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent;
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

  it("uses the native writer when WebKitGTK denies clipboard writes", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    const writeTextFallback = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { terminal, listeners } = fakeTerminal("native copy");
    attachTerminalClipboard(terminal, { writeTextFallback });

    listeners.contextmenu(fakeContextMenuEvent());

    await vi.waitFor(() =>
      expect(writeTextFallback).toHaveBeenCalledWith("native copy"),
    );
  });

  it("asks for a clipboard image when the webview exposes text only", async () => {
    // WebKitGTK (Linux) has no navigator.clipboard.read, so an image-only
    // clipboard reads back as empty text — the backend has to be asked.
    const readText = vi.fn().mockResolvedValue("");
    vi.stubGlobal("navigator", { clipboard: { readText } });
    const onImagePaste = vi.fn();
    const { terminal, mock, listeners } = fakeTerminal(null);
    attachTerminalClipboard(terminal, { onImagePaste });

    listeners.contextmenu(fakeContextMenuEvent());
    await vi.waitFor(() => expect(onImagePaste).toHaveBeenCalled());
    expect(mock.paste).not.toHaveBeenCalled();
  });

  it("pastes clipboard text when nothing is selected", async () => {
    const readText = vi.fn().mockResolvedValue("pasted text");
    vi.stubGlobal("navigator", { clipboard: { readText } });
    const onImagePaste = vi.fn();
    const { terminal, mock, listeners } = fakeTerminal(null);
    attachTerminalClipboard(terminal, { onImagePaste });

    listeners.contextmenu(fakeContextMenuEvent());
    await vi.waitFor(() => expect(mock.paste).toHaveBeenCalledWith("pasted text"));
    expect(onImagePaste).not.toHaveBeenCalled();
  });

  it("uses native text when WebKitGTK reports an empty clipboard", async () => {
    const readText = vi.fn().mockResolvedValue("");
    const readTextFallback = vi.fn().mockResolvedValue("native pasted text");
    vi.stubGlobal("navigator", { clipboard: { readText } });
    const onImagePaste = vi.fn();
    const { terminal, mock, listeners } = fakeTerminal(null);
    attachTerminalClipboard(terminal, { readTextFallback, onImagePaste });

    listeners.contextmenu(fakeContextMenuEvent());

    await vi.waitFor(() =>
      expect(mock.paste).toHaveBeenCalledWith("native pasted text"),
    );
    expect(onImagePaste).not.toHaveBeenCalled();
  });
});

describe("terminal Ctrl+V", () => {
  it("asks the backend for an image when WebKitGTK reports empty text", async () => {
    const readText = vi.fn().mockResolvedValue("");
    vi.stubGlobal("navigator", { clipboard: { readText } });
    const onImagePaste = vi.fn();
    const { terminal, mock, keyEventHandler } = fakeTerminal(null);
    attachTerminalClipboard(terminal, { onImagePaste });

    const event = fakePasteKeyEvent();
    expect(keyEventHandler()?.(event)).toBe(false);
    expect(event.preventDefault).toHaveBeenCalled();
    await vi.waitFor(() => expect(onImagePaste).toHaveBeenCalledOnce());
    expect(mock.paste).not.toHaveBeenCalled();
  });

  it("supports the conventional Linux Ctrl+Shift+C shortcut", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    const writeTextFallback = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { terminal, keyEventHandler } = fakeTerminal("selected output");
    attachTerminalClipboard(terminal, { writeTextFallback });

    const event = fakeCopyKeyEvent();
    expect(keyEventHandler()?.(event)).toBe(false);
    expect(event.preventDefault).toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(writeTextFallback).toHaveBeenCalledWith("selected output"),
    );
  });
});
