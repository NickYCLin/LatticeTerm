import type { AgentSessionSummary } from "./useAgentSessions";

export type SessionSidebarStatus =
  | "working"
  | "attention"
  | "idle"
  | "done"
  | "connected";

export function agentGroupSidebarStatus(
  members: readonly Pick<AgentSessionSummary, "state">[],
): SessionSidebarStatus {
  if (members.some((member) => member.state === "needsAttention")) return "attention";
  if (members.length > 0 && members.every((member) => member.state === "done")) {
    return "done";
  }
  if (members.some((member) => member.state === "working")) return "working";
  if (members.some((member) => member.state === "idle")) return "idle";
  return "connected";
}

export function anyAgentSessionJustCompleted(
  previous: ReadonlyMap<string, AgentSessionSummary["state"]> | null,
  current: readonly Pick<AgentSessionSummary, "sessionId" | "state">[],
): boolean {
  if (!previous) return false;
  return current.some(
    (session) =>
      session.state === "done" && previous.get(session.sessionId) !== "done",
  );
}
