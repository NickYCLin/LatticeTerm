import { describe, expect, it } from "vitest";
import {
  applyAgentStateEvent,
  buildAgentBroadcastPayload,
  decodeAgentPayload,
  encodeAgentPayload,
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
});
