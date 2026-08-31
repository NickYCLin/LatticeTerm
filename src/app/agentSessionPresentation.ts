import type {
  AgentDefinition,
  AgentSessionSummary,
} from "./useAgentSessions";

export interface AgentSessionGroupPresentation {
  /** Group name shown in the project sidebar. */
  groupLabel: string;
  /** Primary name shown in the active-session breadcrumb. */
  headerLabel: string;
  /** Optional active CLI name shown after a custom group name. */
  headerMemberLabel: string | null;
  /** Current visible group name used to seed the rename editor. */
  renameLabel: string;
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
  };
}
