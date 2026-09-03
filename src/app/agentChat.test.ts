import { describe, expect, it } from "vitest";
import {
  applyChatEvent,
  beginTurn,
  boundThreadsForStorage,
  createThread,
  failTurn,
  formatTokens,
  loadStoredThreads,
  MAX_STORED_TOOL_OUTPUT,
  saveStoredThreads,
  threadTitle,
  type ChatEventEnvelope,
  type ChatThread,
} from "./agentChat";

function thread(overrides: Partial<ChatThread> = {}): ChatThread {
  return {
    ...createThread(
      {
        definitionId: "claude",
        workingDirectory: "/work",
        permission: "readOnly",
        model: "",
      },
      "thread-1",
      1000,
    ),
    ...overrides,
  };
}

function envelope(
  event: ChatEventEnvelope["event"],
  turnId = "turn-1",
): ChatEventEnvelope {
  return { threadId: "thread-1", turnId, event };
}

describe("beginTurn", () => {
  it("records the prompt, names the thread and marks the turn running", () => {
    const next = beginTurn(thread(), "幫我看看 README\n第二行", "turn-1", 2000);

    expect(next.runningTurnId).toBe("turn-1");
    expect(next.title).toBe("幫我看看 README");
    expect(next.items).toEqual([
      { type: "user", id: "turn-1:prompt", text: "幫我看看 README\n第二行", at: 2000 },
    ]);
  });

  it("keeps the first title once set", () => {
    const first = beginTurn(thread(), "first", "turn-1");
    const second = beginTurn(first, "second", "turn-2");
    expect(second.title).toBe("first");
  });
});

describe("applyChatEvent", () => {
  const running = beginTurn(thread(), "hi", "turn-1", 2000);

  it("assembles streamed text and lets the full text replace it", () => {
    let next = applyChatEvent(
      running,
      envelope({ kind: "textDelta", itemId: "m#0", delta: "O" }),
    );
    next = applyChatEvent(
      next,
      envelope({ kind: "textDelta", itemId: "m#0", delta: "K" }),
    );
    expect(next.items[next.items.length - 1]).toEqual({
      type: "text",
      id: "turn-1:m#0",
      text: "OK",
    });

    next = applyChatEvent(
      next,
      envelope({ kind: "text", itemId: "m#0", text: "OK." }),
    );
    expect(next.items).toHaveLength(2);
    expect(next.items[next.items.length - 1]).toMatchObject({ text: "OK." });
  });

  it("finishes the tool card that was started, keeping its name", () => {
    let next = applyChatEvent(
      running,
      envelope({
        kind: "toolStarted",
        itemId: "toolu_1",
        name: "Bash",
        summary: "ls",
      }),
    );
    next = applyChatEvent(
      next,
      envelope({
        kind: "toolFinished",
        itemId: "toolu_1",
        name: null,
        summary: null,
        output: "total 0",
        isError: false,
      }),
    );

    expect(next.items[next.items.length - 1]).toEqual({
      type: "tool",
      id: "turn-1:toolu_1",
      name: "Bash",
      summary: "ls",
      output: "total 0",
      isError: false,
      done: true,
    });
  });

  it("closes the turn on finished and remembers the CLI's session", () => {
    const next = applyChatEvent(
      running,
      envelope({
        kind: "finished",
        nativeSessionId: "native-1",
        usage: {
          inputTokens: 1,
          outputTokens: 2,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
        },
        costUsd: 0.1,
        durationMs: 500,
        error: null,
      }),
    );

    expect(next.runningTurnId).toBeNull();
    expect(next.nativeSessionId).toBe("native-1");
    expect(next.items[next.items.length - 1]).toMatchObject({ type: "turnEnd", costUsd: 0.1 });
  });

  it("ignores events from a turn that is not the running one", () => {
    // A stopped turn's tail must not land in the next turn's transcript.
    const next = applyChatEvent(
      running,
      envelope({ kind: "text", itemId: "x", text: "late" }, "turn-0"),
    );
    expect(next).toBe(running);
  });

  it("ignores events addressed to another thread", () => {
    const next = applyChatEvent(running, {
      threadId: "other",
      turnId: "turn-1",
      event: { kind: "text", itemId: "x", text: "late" },
    });
    expect(next).toBe(running);
  });
});

describe("failTurn", () => {
  it("ends the running turn with the error", () => {
    const running = beginTurn(thread(), "hi", "turn-1");
    const next = failTurn(running, "turn-1", "not installed");
    expect(next.runningTurnId).toBeNull();
    expect(next.items[next.items.length - 1]).toMatchObject({ type: "turnEnd", error: "not installed" });
  });

  it("does nothing for a turn that is not running", () => {
    const idle = thread();
    expect(failTurn(idle, "turn-9", "late")).toBe(idle);
  });
});

describe("storage", () => {
  function memoryStorage() {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
      map,
    };
  }

  it("round-trips threads and forgets any running turn", () => {
    const storage = memoryStorage();
    const running = beginTurn(thread(), "hi", "turn-1", 2000);
    saveStoredThreads(storage, [running]);

    const loaded = loadStoredThreads(storage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].runningTurnId).toBeNull();
    expect(loaded[0].items).toHaveLength(1);
  });

  it("drops entries that are not threads", () => {
    const storage = memoryStorage();
    storage.setItem(
      "latticeterm.agentChat.v1",
      JSON.stringify([{ id: "x" }, "junk", null]),
    );
    expect(loadStoredThreads(storage)).toEqual([]);
  });

  it("survives unreadable storage", () => {
    const storage = memoryStorage();
    storage.setItem("latticeterm.agentChat.v1", "{not json");
    expect(loadStoredThreads(storage)).toEqual([]);
  });

  it("trims tool output before storing", () => {
    const big = beginTurn(thread(), "hi", "turn-1");
    const withTool = applyChatEvent(
      big,
      envelope({
        kind: "toolFinished",
        itemId: "t",
        name: "Bash",
        summary: "cat",
        output: "x".repeat(MAX_STORED_TOOL_OUTPUT * 3),
        isError: false,
      }),
    );

    const [bounded] = boundThreadsForStorage([withTool]);
    const tool = bounded.items.find((item) => item.type === "tool");
    expect(tool?.type === "tool" && tool.output?.length).toBe(
      MAX_STORED_TOOL_OUTPUT + 1,
    );
  });

  it("keeps the newest threads when the budget runs out", () => {
    const threads = [1, 2, 3].map((n) =>
      thread({ id: `t${n}`, updatedAt: n }),
    );
    const bounded = boundThreadsForStorage(threads);
    expect(bounded.map((entry) => entry.id)).toEqual(["t3", "t2", "t1"]);
  });
});

describe("helpers", () => {
  it("shortens long titles on the first line", () => {
    expect(threadTitle("a".repeat(100))).toHaveLength(60);
    expect(threadTitle("short\nmore")).toBe("short");
  });

  it("formats token counts compactly", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1234)).toBe("1.2k");
    expect(formatTokens(39633)).toBe("40k");
    expect(formatTokens(2_500_000)).toBe("2.5M");
  });
});
