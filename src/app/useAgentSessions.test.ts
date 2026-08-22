import { describe, expect, it } from "vitest";
import {
  applyAgentStateEvent,
  buildAgentBroadcastPayload,
  decodeAgentPayload,
  encodeAgentPayload,
  moveAgentLaunchPlan,
  reconcileAgentOutputSnapshot,
  splitAgentArguments,
} from "./useAgentSessions";

describe("agent session transport", () => {
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
        definitionId: "codex",
        label: "Codex",
        executable: "/usr/bin/codex",
        workingDirectory: "/work",
        state: "working" as const,
        stateSource: "heuristic" as const,
        processId: 42,
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
  });

  it("moves saved launch plans by one position without mutating the source", () => {
    const plans = ["one", "two", "three"].map((id) => ({
      id,
      definitionId: "custom",
      label: id,
      executable: id,
      arguments: [],
      resumeSessionId: null,
      workingDirectory: "/work",
    }));

    const moved = moveAgentLaunchPlan(plans, "two", -1);
    expect(moved.map((plan) => plan.id)).toEqual(["two", "one", "three"]);
    expect(plans.map((plan) => plan.id)).toEqual(["one", "two", "three"]);
    expect(moveAgentLaunchPlan(plans, "one", -1)).toBe(plans);
  });
});
