import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalImeFallback } from "./terminalImeFallback";

describe("TerminalImeFallback", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("delivers committed WebKit text when xterm emits no data", () => {
    vi.useFakeTimers();
    const delivered: string[] = [];
    const fallback = new TerminalImeFallback((data) => delivered.push(data));

    fallback.recordInput("中文", "insertText");
    vi.advanceTimersByTime(31);
    expect(delivered).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(delivered).toEqual(["中文"]);
  });

  it("does not duplicate data xterm emitted before the input event", () => {
    vi.useFakeTimers();
    const delivered: string[] = [];
    const fallback = new TerminalImeFallback((data) => delivered.push(data));

    fallback.recordTerminalData("中");
    fallback.recordInput("中", "insertText");
    vi.runAllTimers();

    expect(delivered).toEqual([]);
  });

  it("does not duplicate delayed composition data from xterm", () => {
    vi.useFakeTimers();
    const delivered: string[] = [];
    const fallback = new TerminalImeFallback((data) => delivered.push(data));

    fallback.recordInput("中文", "insertFromComposition");
    fallback.recordTerminalData("中文");
    vi.runAllTimers();

    expect(delivered).toEqual([]);
  });

  it("ignores unfinished composition updates", () => {
    vi.useFakeTimers();
    const delivered: string[] = [];
    const fallback = new TerminalImeFallback((data) => delivered.push(data));

    fallback.recordInput("ㄓ", "insertCompositionText");
    fallback.recordInput("zh", "insertText", true);
    vi.runAllTimers();

    expect(delivered).toEqual([]);
  });

  it("cancels pending fallbacks on dispose", () => {
    vi.useFakeTimers();
    const delivered: string[] = [];
    const fallback = new TerminalImeFallback((data) => delivered.push(data));

    fallback.recordInput("中文", "insertText");
    fallback.dispose();
    vi.runAllTimers();

    expect(delivered).toEqual([]);
  });
});
