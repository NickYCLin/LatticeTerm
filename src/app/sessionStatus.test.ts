import { describe, expect, it } from "vitest";
import {
  agentGroupSidebarStatus,
  anyAgentSessionJustCompleted,
} from "./sessionStatus";

describe("agent group sidebar status", () => {
  it("prioritizes attention and only marks the whole group done when all members finish", () => {
    expect(agentGroupSidebarStatus([{ state: "working" }, { state: "done" }])).toBe(
      "working",
    );
    expect(
      agentGroupSidebarStatus([{ state: "needsAttention" }, { state: "done" }]),
    ).toBe("attention");
    expect(agentGroupSidebarStatus([{ state: "done" }, { state: "done" }])).toBe(
      "done",
    );
  });

  it("notifies when any CLI in a grouped tab finishes", () => {
    const previous = new Map([
      ["codex", "working" as const],
      ["gemini", "working" as const],
    ]);

    expect(
      anyAgentSessionJustCompleted(previous, [
        { sessionId: "codex", state: "done" },
        { sessionId: "gemini", state: "working" },
      ]),
    ).toBe(true);
    expect(
      anyAgentSessionJustCompleted(null, [
        { sessionId: "codex", state: "done" },
      ]),
    ).toBe(false);
  });
});
