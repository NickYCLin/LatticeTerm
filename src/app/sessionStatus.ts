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
