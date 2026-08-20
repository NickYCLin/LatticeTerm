import { describe, expect, it } from "vitest";
import {
  applyAgentStateEvent,
  buildAgentBroadcastPayload,
  decodeAgentPayload,
  encodeAgentPayload,
  moveAgentLaunchPlan,
  splitAgentArguments,
} from "./useAgentSessions";

describe("agent session transport", () => {
  it("round-trips arbitrary PTY bytes", () => {
    const bytes = new Uint8Array([0, 10, 27, 128, 200, 255]);
    expect(decodeAgentPayload(encodeAgentPayload(bytes))).toEqual(bytes);
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
      workingDirectory: "/work",
    }));

    const moved = moveAgentLaunchPlan(plans, "two", -1);
    expect(moved.map((plan) => plan.id)).toEqual(["two", "one", "three"]);
    expect(plans.map((plan) => plan.id)).toEqual(["one", "two", "three"]);
    expect(moveAgentLaunchPlan(plans, "one", -1)).toBe(plans);
  });
});
