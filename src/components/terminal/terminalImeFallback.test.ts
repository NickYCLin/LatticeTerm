import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalImeFallback } from "./terminalImeFallback";

describe("TerminalImeFallback", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("delivers committed WebKit text when xterm emits no data", () => {
    vi.useFakeTimers();
    const delivered: string[] = [];
    // These cases exercise the WebKit-only repair path, so force it on
    // regardless of the UA the test runner reports.
    const fallback = new TerminalImeFallback(
      (data) => delivered.push(data),
      undefined,
      undefined,
      undefined,
      true,
    );

    fallback.recordInput("中文", "insertText");
    vi.advanceTimersByTime(31);
    expect(delivered).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(delivered).toEqual(["中文"]);
  });

  it("does not duplicate data xterm emitted before the input event", () => {
    vi.useFakeTimers();
    const delivered: string[] = [];
    // These cases exercise the WebKit-only repair path, so force it on
    // regardless of the UA the test runner reports.
    const fallback = new TerminalImeFallback(
      (data) => delivered.push(data),
      undefined,
      undefined,
      undefined,
      true,
    );

    expect(fallback.recordTerminalData("中")).toBe(true);
    fallback.recordInput("中", "insertText");
    vi.runAllTimers();

    expect(delivered).toEqual([]);
  });

  it("does not duplicate delayed composition data from xterm", () => {
    vi.useFakeTimers();
    const delivered: string[] = [];
    // These cases exercise the WebKit-only repair path, so force it on
    // regardless of the UA the test runner reports.
    const fallback = new TerminalImeFallback(
      (data) => delivered.push(data),
      undefined,
      undefined,
      undefined,
      true,
    );

    fallback.recordInput("中文", "insertFromComposition");
    expect(fallback.recordTerminalData("中文")).toBe(true);
    vi.runAllTimers();

    expect(delivered).toEqual([]);
  });

  it("suppresses xterm data that arrives after the WebKit fallback", () => {
    vi.useFakeTimers();
    const delivered: string[] = [];
    const fallback = new TerminalImeFallback(
      (data) => delivered.push(data),
      undefined,
      undefined,
      undefined,
      true,
    );

    fallback.recordInput("中文", "insertFromComposition");
    vi.advanceTimersByTime(32);

    expect(delivered).toEqual(["中文"]);
    expect(fallback.recordTerminalData("中文")).toBe(false);
    expect(delivered).toEqual(["中文"]);
  });

  it("keeps repeated identical WebKit input one-for-one", () => {
    vi.useFakeTimers();
    const delivered: string[] = [];
    const fallback = new TerminalImeFallback(
      (data) => delivered.push(data),
      undefined,
      undefined,
      undefined,
      true,
    );

    fallback.recordInput("a", "insertText");
    fallback.recordInput("a", "insertText");
    vi.advanceTimersByTime(32);

    expect(delivered).toEqual(["a", "a"]);
    expect(fallback.recordTerminalData("a")).toBe(false);
    expect(fallback.recordTerminalData("a")).toBe(false);
    expect(delivered).toEqual(["a", "a"]);
  });

  it("stops suppressing unmatched data after the late-event window", () => {
    vi.useFakeTimers();
    const delivered: string[] = [];
    const fallback = new TerminalImeFallback(
      (data) => delivered.push(data),
      undefined,
      undefined,
      undefined,
      true,
    );

    fallback.recordInput("a", "insertText");
    vi.advanceTimersByTime(32);
    vi.advanceTimersByTime(250);

    expect(fallback.recordTerminalData("a")).toBe(true);
  });

  it("ignores unfinished composition updates", () => {
    vi.useFakeTimers();
    const delivered: string[] = [];
    // These cases exercise the WebKit-only repair path, so force it on
    // regardless of the UA the test runner reports.
    const fallback = new TerminalImeFallback(
      (data) => delivered.push(data),
      undefined,
      undefined,
      undefined,
      true,
    );

    fallback.recordInput("ㄓ", "insertCompositionText");
    fallback.recordInput("zh", "insertText", true);
    vi.runAllTimers();

    expect(delivered).toEqual([]);
  });

  it("stays inert on engines that do not need the fallback", () => {
    vi.useFakeTimers();
    const delivered: string[] = [];
    const fallback = new TerminalImeFallback(
      (data) => delivered.push(data),
      undefined,
      undefined,
      undefined,
      false,
    );

    // A committed input with no matching onData would normally be repaired,
    // but a Chromium/Gecko onData is authoritative so the fallback must not
    // schedule a second send.
    fallback.recordInput("中文", "insertText");
    expect(fallback.recordTerminalData("中文")).toBe(true);
    vi.runAllTimers();

    expect(delivered).toEqual([]);
  });

  it("cancels pending fallbacks on dispose", () => {
    vi.useFakeTimers();
    const delivered: string[] = [];
    // These cases exercise the WebKit-only repair path, so force it on
    // regardless of the UA the test runner reports.
    const fallback = new TerminalImeFallback(
      (data) => delivered.push(data),
      undefined,
      undefined,
      undefined,
      true,
    );

    fallback.recordInput("中文", "insertText");
    fallback.dispose();
    vi.runAllTimers();

    expect(delivered).toEqual([]);
  });
});
