import { describe, expect, it, vi } from "vitest";
import { disconnectAgentSessionMembers } from "./agentSessionRemoval";

describe("Agent Fleet session removal", () => {
  it("attempts every member even when one disconnect fails", async () => {
    const disconnect = vi.fn(async (sessionId: string) => {
      if (sessionId === "agent-one") throw new Error("still running");
    });

    await expect(
      disconnectAgentSessionMembers(
        ["agent-one", "agent-two", "agent-three"],
        disconnect,
      ),
    ).rejects.toThrow("still running");
    expect(disconnect).toHaveBeenCalledTimes(3);
    expect(disconnect).toHaveBeenCalledWith("agent-one");
    expect(disconnect).toHaveBeenCalledWith("agent-two");
    expect(disconnect).toHaveBeenCalledWith("agent-three");
  });

  it("succeeds only after every member disconnects", async () => {
    const disconnect = vi.fn().mockResolvedValue(undefined);

    await expect(
      disconnectAgentSessionMembers(["agent-one", "agent-two"], disconnect),
    ).resolves.toBeUndefined();
    expect(disconnect).toHaveBeenCalledTimes(2);
  });
});
