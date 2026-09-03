import { describe, expect, it } from "vitest";
import {
  AGENT_ACTIVITY_STORAGE_KEY,
  filterAgentActivity,
  loadAgentActivity,
  markAgentActivityRead,
  reconcileAgentActivity,
  saveAgentActivity,
  snapshotAgentStates,
  type AgentActivityItem,
} from "./agentActivity";
import type { AgentSessionSummary } from "./useAgentSessions";

function session(
  sessionId: string,
  state: AgentSessionSummary["state"],
  overrides: Partial<AgentSessionSummary> = {},
): AgentSessionSummary {
  return {
    sessionId,
    groupId: "project-1",
    groupLabel: "網站改版",
    definitionId: "codex",
    label: "OpenAI Codex",
    model: "gpt-5.6-terra",
    executable: "codex",
    launchArguments: [],
    workingDirectory: "D:\\project\\site",
    state,
    stateSource: "integration",
    processId: 123,
    tokenUsage: null,
    capturedSessionId: null,
    ...overrides,
  };
}

const storedReady: AgentActivityItem = {
  groupId: "old-project",
  sessionId: null,
  groupLabel: "舊工作",
  agentLabels: ["Claude Code"],
  workingDirectory: "D:\\project\\old",
  status: "ready",
  unread: true,
  updatedAt: 100,
};

describe("agent activity reconciliation", () => {
  it("hydrates current status without manufacturing unread notifications", () => {
    const items = reconcileAgentActivity(
      [],
      [session("done", "done"), session("working", "working")],
      null,
      200,
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      groupId: "project-1",
      status: "running",
      unread: false,
      updatedAt: 200,
    });
  });

  it("marks completion and attention transitions unread at group level", () => {
    const before = [
      session("codex", "working"),
      session("claude", "working", { label: "Claude Code" }),
    ];
    const initial = reconcileAgentActivity([], before, null, 200);
    const after = [
      session("codex", "done"),
      session("claude", "working", { label: "Claude Code" }),
    ];
    const completed = reconcileAgentActivity(
      initial,
      after,
      snapshotAgentStates(before),
      300,
    );

    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ status: "running", unread: true });
    expect(completed[0].agentLabels).toEqual(["OpenAI Codex", "Claude Code"]);

    const waiting = reconcileAgentActivity(
      completed,
      [session("codex", "needsAttention")],
      snapshotAgentStates(after),
      400,
    );
    expect(waiting[0]).toMatchObject({
      sessionId: "codex",
      status: "waiting",
      unread: true,
      updatedAt: 400,
    });
  });

  it("keeps completed history but drops vanished running work", () => {
    const running = reconcileAgentActivity(
      [],
      [session("codex", "working")],
      null,
      200,
    );
    expect(reconcileAgentActivity(running, [], new Map(), 300)).toEqual([]);

    expect(
      reconcileAgentActivity([storedReady], [], new Map(), 300),
    ).toEqual([storedReady]);
  });

  it("marks one group or all groups read without touching live sessions", () => {
    const second = { ...storedReady, groupId: "second", unread: true };
    expect(markAgentActivityRead([storedReady, second], "old-project")).toEqual([
      { ...storedReady, unread: false },
      second,
    ]);
    expect(markAgentActivityRead([storedReady, second]).every((item) => !item.unread)).toBe(
      true,
    );
  });
});

describe("agent activity storage and filtering", () => {
  it("persists bounded metadata but never the process-local session id", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    saveAgentActivity(storage, [{ ...storedReady, sessionId: "secret-runtime-id" }]);

    const raw = values.get(AGENT_ACTIVITY_STORAGE_KEY) ?? "";
    expect(raw).not.toContain("secret-runtime-id");
    expect(loadAgentActivity(storage)).toEqual([storedReady]);
  });

  it("rejects malformed storage and filters actionable states", () => {
    expect(loadAgentActivity({ getItem: () => "not json" })).toEqual([]);
    const running = { ...storedReady, groupId: "run", status: "running" as const };
    const waiting = { ...storedReady, groupId: "wait", status: "waiting" as const };
    const items = [running, waiting, storedReady];

    expect(filterAgentActivity(items, "running")).toEqual([running]);
    expect(filterAgentActivity(items, "waiting")).toEqual([waiting]);
    expect(filterAgentActivity(items, "unread")).toHaveLength(3);
  });

  it("drops duplicate or unsafe persisted rows", () => {
    const duplicate = {
      version: 1,
      items: [
        { ...storedReady, sessionId: undefined },
        { ...storedReady, groupLabel: "重複資料", updatedAt: 50 },
        { ...storedReady, groupId: "unsafe", groupLabel: "bad\nlabel" },
      ],
    };
    const loaded = loadAgentActivity({
      getItem: () => JSON.stringify(duplicate),
    });

    expect(loaded).toHaveLength(1);
    expect(loaded[0].groupLabel).toBe("舊工作");
  });
});
