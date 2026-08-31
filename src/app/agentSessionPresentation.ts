import type {
  AgentDefinition,
  AgentSessionSummary,
} from "./useAgentSessions";
import { sessionSidebarSessionNodeId } from "./sessionSidebarLayout";

export interface AgentSessionGroupPresentation {
  /** Group name shown in the project sidebar. */
  groupLabel: string;
  /** Primary name shown in the active-session breadcrumb. */
  headerLabel: string;
  /** Optional active CLI name shown after a custom group name. */
  headerMemberLabel: string | null;
  /** Current visible group name used to seed the rename editor. */
  renameLabel: string;
  /** Whether the persisted group name was authored by the user. */
  hasCustomGroupLabel: boolean;
}

function normalizedLabel(label: string): string {
  return label.trim().toLowerCase();
}

/**
 * Distinguishes an automatic provider label from a user-authored group name.
 * Automatic groups describe their current members; custom groups retain the
 * user's name and identify the active CLI separately in the breadcrumb.
 */
export function presentAgentSessionGroup(
  members: readonly AgentSessionSummary[],
  definitions: readonly Pick<AgentDefinition, "id" | "label">[],
  activeSessionId: string,
): AgentSessionGroupPresentation {
  const activeMember =
    members.find((member) => member.sessionId === activeSessionId) ?? members[0];
  const definitionLabels = new Map(
    definitions.map((definition) => [definition.id, definition.label.trim()]),
  );
  const memberLabels = members
    .map(
      (member) =>
        member.label.trim() || definitionLabels.get(member.definitionId) || "",
    )
    .filter((label, index, labels) => {
      const normalized = normalizedLabel(label);
      const firstIndex = labels.findIndex(
        (candidate) => normalizedLabel(candidate) === normalized,
      );
      return (
        normalized.length > 0 && firstIndex === index
      );
    });
  const activeMemberLabel = activeMember
    ? activeMember.label.trim() ||
      definitionLabels.get(activeMember.definitionId) ||
      ""
    : "";
  const persistedGroupLabel =
    activeMember?.groupLabel.trim() || members[0]?.groupLabel.trim() || "";
  const automaticLabels = new Set(
    [...definitions.map((definition) => definition.label), ...memberLabels]
      .map(normalizedLabel)
      .filter(Boolean),
  );
  const hasCustomGroupLabel =
    persistedGroupLabel.length > 0 &&
    !automaticLabels.has(normalizedLabel(persistedGroupLabel));
  const automaticGroupLabel =
    memberLabels.join(" + ") || activeMemberLabel || persistedGroupLabel;
  const groupLabel = hasCustomGroupLabel
    ? persistedGroupLabel
    : automaticGroupLabel;
  const headerLabel = hasCustomGroupLabel
    ? persistedGroupLabel
    : activeMemberLabel || automaticGroupLabel;
  const headerMemberLabel =
    hasCustomGroupLabel &&
    activeMemberLabel.length > 0 &&
    normalizedLabel(activeMemberLabel) !== normalizedLabel(headerLabel)
      ? activeMemberLabel
      : null;

  return {
    groupLabel,
    headerLabel,
    headerMemberLabel,
    renameLabel: groupLabel || headerLabel,
    hasCustomGroupLabel,
  };
}

type AgentSidebarIdentity = Pick<
  AgentSessionSummary,
  "definitionId" | "executable" | "label" | "launchArguments" | "sessionId"
>;

function sidebarIdentity(member: AgentSidebarIdentity): string {
  return JSON.stringify([
    member.definitionId,
    member.label,
    member.executable,
    member.launchArguments,
  ]);
}

function stableSidebarHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Keeps each CLI member independently addressable in the sidebar while using
 * launch identity instead of the runtime process id across application restarts.
 */
export function agentSessionSidebarMemberNodeId(
  groupId: string,
  members: readonly AgentSidebarIdentity[],
  memberIndex: number,
): string {
  const member = members[memberIndex];
  if (!member) throw new RangeError("Agent sidebar member index is out of range.");
  const identity = sidebarIdentity(member);
  const occurrence = members
    .slice(0, memberIndex)
    .filter((candidate) => sidebarIdentity(candidate) === identity).length;
  const persistentId = `${groupId}:member:${stableSidebarHash(
    `${identity}:${occurrence}`,
  )}`;
  return sessionSidebarSessionNodeId("agent", member.sessionId, persistentId);
}
