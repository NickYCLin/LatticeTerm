import { describe, expect, it } from "vitest";
import { agentGroupSidebarStatus } from "./sessionStatus";

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
});
