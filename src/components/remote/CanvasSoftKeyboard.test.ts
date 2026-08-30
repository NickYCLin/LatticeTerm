import { describe, expect, it } from "vitest";
import {
  CANVAS_INPUT_SENTINEL,
  CanvasCompositionFence,
  CanvasControlInputFence,
  CanvasInputSequence,
  canvasInputText,
  canvasSoftKeyboardAction,
  canvasTextTokens,
  isCanvasImeKey,
  isCanvasTextKey,
} from "./CanvasSoftKeyboard";

describe("canvasSoftKeyboardAction", () => {
  it("treats astral Unicode as one text key instead of a named key", () => {
    expect(isCanvasTextKey("😀")).toBe(true);
    expect(isCanvasTextKey("Enter")).toBe(false);
  });

  it("blocks browser IME placeholders before compositionstart", () => {
    expect(isCanvasImeKey("Process", false)).toBe(true);
    expect(isCanvasImeKey("Dead", false)).toBe(true);
    expect(isCanvasImeKey("Unidentified", false)).toBe(true);
    expect(isCanvasImeKey("a", true)).toBe(true);
    expect(isCanvasImeKey("a", false)).toBe(false);
  });

  it("keeps a deletion sentinel out of fallback text", () => {
    expect(canvasInputText(`${CANVAS_INPUT_SENTINEL}貼上`)).toBe("貼上");
    expect(canvasInputText("貼上")).toBe("貼上");
  });

  it("keeps interim IME composition out of the remote stream", () => {
    expect(
      canvasSoftKeyboardAction(
        "insertCompositionText",
        "輸",
        "輸",
        true,
      ),
    ).toBeNull();
    expect(
      canvasSoftKeyboardAction(
        "insertFromComposition",
        "輸入",
        "輸入",
        false,
      ),
    ).toEqual({ kind: "text", text: "輸入" });
  });

  it("maps software keyboard deletion and enter actions", () => {
    expect(
      canvasSoftKeyboardAction("deleteContentBackward", null, "", false),
    ).toEqual({ kind: "key", key: "Backspace", code: "Backspace" });
    expect(
      canvasSoftKeyboardAction("deleteContentForward", null, "", false),
    ).toEqual({ kind: "key", key: "Delete", code: "Delete" });
    expect(
      canvasSoftKeyboardAction("insertParagraph", null, "", false),
    ).toEqual({ kind: "key", key: "Enter", code: "Enter" });
  });

  it("falls back to the textarea value when InputEvent data is absent", () => {
    expect(canvasSoftKeyboardAction("insertText", null, "貼上", false)).toEqual(
      { kind: "text", text: "貼上" },
    );
  });
});

describe("CanvasControlInputFence", () => {
  it("sends one Backspace for keydown, beforeinput, and input", () => {
    const fence = new CanvasControlInputFence();
    fence.keyDown("Backspace");
    expect(fence.beforeInput("Backspace")).toBe(false);
    expect(fence.input("Backspace")).toBe(false);
  });

  it("sends from beforeinput when a software keyboard omits keydown", () => {
    const fence = new CanvasControlInputFence();
    expect(fence.beforeInput("Backspace")).toBe(true);
    expect(fence.input("Backspace")).toBe(false);
  });

  it("delivers every repeated beforeinput even within one task", () => {
    const fence = new CanvasControlInputFence();
    expect(fence.beforeInput("Backspace")).toBe(true);
    expect(fence.beforeInput("Backspace")).toBe(true);
  });

  it("falls back to input when beforeinput is unavailable", () => {
    const fence = new CanvasControlInputFence();
    expect(fence.input("Backspace")).toBe(true);
  });
});

describe("canvasTextTokens", () => {
  it("preserves Unicode scalars and normalises newlines and tabs", () => {
    expect(canvasTextTokens("A😀\r\n\t中")).toEqual([
      { kind: "character", character: "A" },
      { kind: "character", character: "😀" },
      { kind: "key", key: "Enter", code: "Enter" },
      { kind: "key", key: "Tab", code: "Tab" },
      { kind: "character", character: "中" },
    ]);
  });
});

describe("CanvasCompositionFence", () => {
  it("sends once when final input arrives after compositionend", () => {
    const fence = new CanvasCompositionFence();
    fence.begin();
    expect(fence.end("輸入").deferFallback).toBe(true);

    expect(fence.input("輸入", false)).toEqual({
      send: true,
      armSuppressionExpiry: true,
    });
    expect(fence.fallback("輸入").send).toBe(false);
    expect(fence.input("輸入", false).send).toBe(false);
  });

  it("sends once when final input arrives before compositionend", () => {
    const fence = new CanvasCompositionFence();
    fence.begin();
    expect(fence.input("入力", false).send).toBe(true);

    expect(fence.end("入力")).toEqual({
      deferFallback: false,
      armSuppressionExpiry: true,
    });
    expect(fence.input("入力", false).send).toBe(false);
  });

  it("forgets an unfinished composition when the keyboard closes", () => {
    const fence = new CanvasCompositionFence();
    fence.begin();
    fence.reset();

    expect(fence.input("a", false)).toEqual({
      send: true,
      armSuppressionExpiry: false,
    });
  });
});

describe("CanvasInputSequence", () => {
  it("keeps press and release operations in enqueue order", async () => {
    const sequence = new CanvasInputSequence();
    const delivered: string[] = [];
    let releaseFirst = () => {};
    const firstBarrier = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    sequence.enqueue(async () => {
      delivered.push("press-a");
      await firstBarrier;
    });
    sequence.enqueue(async () => {
      delivered.push("release-a");
    });
    sequence.enqueue(async () => {
      delivered.push("press-b");
    });

    await Promise.resolve();
    expect(delivered).toEqual(["press-a"]);
    releaseFirst();
    await sequence.settled();
    expect(delivered).toEqual(["press-a", "release-a", "press-b"]);
  });
});
