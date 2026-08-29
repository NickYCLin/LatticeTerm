import { describe, expect, it } from "vitest";
import {
  applyAgentStateEvent,
  applyAgentUsageEvent,
  agentCatalogForDisplay,
  buildAgentBroadcastPayload,
  decodeAgentPayload,
  encodeAgentPayload,
  moveAgentLaunchPlan,
  reconcileAgentOutputSnapshot,
  splitAgentArguments,
  type AgentDefinition,
} from "./useAgentSessions";

describe("agent session transport", () => {
  it("shows Antigravity as Google's single consumer item with Gemini login data", () => {
    const base = {
      adapterVersion: 1,
      resumeSupported: false,
      resumeLatestSupported: false,
      transcriptSupported: false,
      installed: true,
      installedPath: "C:\\bin\\agent.exe",
      consumerOauthDeprecated: false,
      account: { state: "unsupported" as const, label: null, method: null },
      install: {
        executable: null,
        arguments: [],
        displayCommand: "",
        sourceUrl: "",
        available: false,
      },
    };
    const catalog: AgentDefinition[] = [
      {
        ...base,
        id: "gemini",
        label: "Gemini CLI",
        executable: "gemini",
        consumerOauthDeprecated: true,
        account: {
          state: "signedIn",
          label: "user@example.com",
          method: "Google",
        },
      },
      {
        ...base,
        id: "antigravity",
        label: "Google Antigravity CLI",
        executable: "agy",
      },
    ];

    const displayed = agentCatalogForDisplay(catalog);

    expect(displayed.map((definition) => definition.id)).toEqual([
      "antigravity",
    ]);
    expect(displayed[0]).toMatchObject({
      label: "Google Antigravity CLI",
      account: {
        state: "signedIn",
        label: "user@example.com",
        method: "Google · Gemini CLI",
      },
      consumerOauthDeprecated: true,
    });

    const apiKeyCatalog = catalog.map((definition) =>
      definition.id === "gemini"
        ? { ...definition, consumerOauthDeprecated: false }
        : definition,
    );
    expect(
      agentCatalogForDisplay(apiKeyCatalog).map((definition) => definition.id),
    ).toEqual(["gemini", "antigravity"]);
  });

  it("round-trips arbitrary PTY bytes", () => {
    const bytes = new Uint8Array([0, 10, 27, 128, 200, 255]);
    expect(decodeAgentPayload(encodeAgentPayload(bytes))).toEqual(bytes);
  });

  it("replays a snapshot once and trims overlapping live events by offset", () => {
    const bytes = (value: string) =>
      encodeAgentPayload(new TextEncoder().encode(value));
    const chunks = reconcileAgentOutputSnapshot(
      {
        sessionId: "agent-session-1",
        startOffset: 0,
        endOffset: 4,
        base64: bytes("abcd"),
      },
      [
        {
          sessionId: "agent-session-1",
          offset: 2,
          base64: bytes("cdef"),
        },
        {
          sessionId: "agent-session-1",
          offset: 6,
          base64: bytes("gh"),
        },
      ],
    );

    expect(chunks.map((chunk) => chunk.offset)).toEqual([0, 4, 6]);
    const replay = new Uint8Array(
      chunks.reduce((total, chunk) => total + chunk.bytes.length, 0),
    );
    let offset = 0;
    for (const chunk of chunks) {
      replay.set(chunk.bytes, offset);
      offset += chunk.bytes.length;
    }
    expect(new TextDecoder().decode(replay)).toBe("abcdefgh");
  });

  it("rejects inconsistent output snapshot offsets", () => {
    expect(() =>
      reconcileAgentOutputSnapshot(
        {
          sessionId: "agent-session-1",
          startOffset: 10,
          endOffset: 20,
          base64: encodeAgentPayload(new TextEncoder().encode("short")),
        },
        [],
      ),
    ).toThrow("offsets are inconsistent");
  });

  it("treats each non-empty line as one direct argument", () => {
    expect(splitAgentArguments("--model\ngpt-5\n\n--full-auto")).toEqual([
      "--model",
      "gpt-5",
      "--full-auto",
    ]);
  });

  it("submits one normalized broadcast payload without saving shell syntax", () => {
    expect(buildAgentBroadcastPayload("Review this change\nReturn risks\n")).toBe(
      "Review this change\rReturn risks\r",
    );
    expect(buildAgentBroadcastPayload("   ")).toBe("");
  });

  it("updates both semantic state and its trusted source", () => {
    const sessions = [
      {
        sessionId: "agent-session-1",
        groupId: "agent-session-1",
        groupLabel: "Payments",
        definitionId: "codex",
        label: "Codex",
        model: "gpt-5",
        executable: "/usr/bin/codex",
        launchArguments: [],
        workingDirectory: "/work",
        state: "working" as const,
        stateSource: "heuristic" as const,
        processId: 42,
        tokenUsage: null,
        capturedSessionId: null,
      },
    ];

    expect(
      applyAgentStateEvent(sessions, {
        sessionId: "agent-session-1",
        state: "done",
        source: "integration",
      })[0],
    ).toMatchObject({ state: "done", stateSource: "integration" });

    const tokenUsage = {
      inputTokens: 120,
      outputTokens: 30,
      cacheReadTokens: 40,
      cacheWriteTokens: 5,
      reasoningTokens: 12,
      totalTokens: 195,
      apiCalls: 1,
    };
    expect(
      applyAgentUsageEvent(sessions, {
        sessionId: "agent-session-1",
        tokenUsage,
      })[0].tokenUsage,
    ).toEqual(tokenUsage);
  });

  it("moves saved launch plans by one position without mutating the source", () => {
    const plans = ["one", "two", "three"].map((id) => ({
      id,
      definitionId: "custom",
      label: id,
      executable: id,
      arguments: [],
      resumeSessionId: null,
      note: "",
      workingDirectory: "/work",
    }));

    const moved = moveAgentLaunchPlan(plans, "two", -1);
    expect(moved.map((plan) => plan.id)).toEqual(["two", "one", "three"]);
    expect(plans.map((plan) => plan.id)).toEqual(["one", "two", "three"]);
    expect(moveAgentLaunchPlan(plans, "one", -1)).toBe(plans);
  });
});
