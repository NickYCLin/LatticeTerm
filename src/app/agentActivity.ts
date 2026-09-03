/**
 * Persisted, content-free activity for local AI CLI work.
 *
 * This intentionally stores only presentation metadata and lifecycle state.
 * Prompts, terminal output, credentials, process ids and provider tokens never
 * enter the activity store.
 */

import type {
  AgentLifecycle,
  AgentSessionSummary,
} from "./useAgentSessions";

export const AGENT_ACTIVITY_STORAGE_KEY = "latticeterm.agent-activity.v1";
export const MAX_AGENT_ACTIVITY_ITEMS = 100;

export type AgentActivityStatus = "running" | "waiting" | "ready" | "idle";
export type AgentActivityFilter = "all" | "unread" | "running" | "waiting";

export interface AgentActivityItem {
  groupId: string;
  /** Current process-local destination; never written to persistent storage. */
  sessionId: string | null;
  groupLabel: string;
  agentLabels: string[];
  workingDirectory: string;
  status: AgentActivityStatus;
  unread: boolean;
  updatedAt: number;
}

interface StoredAgentActivityItem extends Omit<AgentActivityItem, "sessionId"> {}

interface StoredAgentActivity {
  version: 1;
  items: StoredAgentActivityItem[];
}

export interface StorageReader {
  getItem(key: string): string | null;
}

export interface StorageWriter {
  setItem(key: string, value: string): void;
}

function isStatus(value: unknown): value is AgentActivityStatus {
  return (
    value === "running" ||
    value === "waiting" ||
    value === "ready" ||
    value === "idle"
  );
}

function boundedString(
  value: unknown,
  maximum: number,
  allowEmpty = false,
): string | null {
  if (typeof value !== "string") return null;
  if ((!allowEmpty && value.length === 0) || value.length > maximum) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}

function parseStoredItem(value: unknown): AgentActivityItem | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const groupId = boundedString(record.groupId, 512);
  const groupLabel = boundedString(record.groupLabel, 256);
  const workingDirectory = boundedString(record.workingDirectory, 4096, true);
  if (
    !groupId ||
    !groupLabel ||
    workingDirectory === null ||
    !isStatus(record.status) ||
    typeof record.unread !== "boolean" ||
    typeof record.updatedAt !== "number" ||
    !Number.isFinite(record.updatedAt) ||
    record.updatedAt <= 0 ||
    !Array.isArray(record.agentLabels)
  ) {
    return null;
  }

  const agentLabels = record.agentLabels
    .slice(0, 16)
    .map((label) => boundedString(label, 256))
    .filter((label): label is string => label !== null);
  if (agentLabels.length === 0) return null;

  return {
    groupId,
    sessionId: null,
    groupLabel,
    agentLabels,
    workingDirectory,
    status: record.status,
    unread: record.unread,
    updatedAt: record.updatedAt,
  };
}

export function loadAgentActivity(storage: StorageReader): AgentActivityItem[] {
  try {
    const raw = storage.getItem(AGENT_ACTIVITY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<StoredAgentActivity>;
    if (parsed.version !== 1 || !Array.isArray(parsed.items)) return [];
    const seen = new Set<string>();
    return parsed.items
      .map(parseStoredItem)
      .filter((item): item is AgentActivityItem => item !== null)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .filter((item) => {
        if (seen.has(item.groupId)) return false;
        seen.add(item.groupId);
        return true;
      })
      .slice(0, MAX_AGENT_ACTIVITY_ITEMS);
  } catch {
    return [];
  }
}

export function saveAgentActivity(
  storage: StorageWriter,
  items: readonly AgentActivityItem[],
): void {
  const stored: StoredAgentActivity = {
    version: 1,
    items: items.slice(0, MAX_AGENT_ACTIVITY_ITEMS).map((item) => ({
      groupId: item.groupId,
      groupLabel: item.groupLabel,
      agentLabels: item.agentLabels,
      workingDirectory: item.workingDirectory,
      status: item.status,
      unread: item.unread,
      updatedAt: item.updatedAt,
    })),
  };
  storage.setItem(AGENT_ACTIVITY_STORAGE_KEY, JSON.stringify(stored));
}

function groupStatus(
  members: readonly Pick<AgentSessionSummary, "state">[],
): AgentActivityStatus {
  if (members.some((member) => member.state === "needsAttention")) {
    return "waiting";
  }
  if (members.some((member) => member.state === "working")) return "running";
  if (members.some((member) => member.state === "done")) return "ready";
  return "idle";
}

function focusMember(
  members: readonly AgentSessionSummary[],
  status: AgentActivityStatus,
): AgentSessionSummary {
  const targetState: AgentLifecycle =
    status === "waiting"
      ? "needsAttention"
      : status === "running"
        ? "working"
        : status === "ready"
          ? "done"
          : "idle";
  return members.find((member) => member.state === targetState) ?? members[0];
}

function itemEquals(left: AgentActivityItem, right: AgentActivityItem): boolean {
  return (
    left.groupId === right.groupId &&
    left.sessionId === right.sessionId &&
    left.groupLabel === right.groupLabel &&
    left.workingDirectory === right.workingDirectory &&
    left.status === right.status &&
    left.unread === right.unread &&
    left.updatedAt === right.updatedAt &&
    left.agentLabels.length === right.agentLabels.length &&
    left.agentLabels.every((label, index) => label === right.agentLabels[index])
  );
}

/**
 * Reconciles persisted activity with the live CLI registry. A transition to
 * `needsAttention` or `done` becomes unread only after initial hydration, so
 * restarting the UI cannot manufacture notifications for old state.
 */
export function reconcileAgentActivity(
  current: readonly AgentActivityItem[],
  sessions: readonly AgentSessionSummary[],
  previousStates: ReadonlyMap<string, AgentLifecycle> | null,
  now = Date.now(),
): AgentActivityItem[] {
  const groups = new Map<string, AgentSessionSummary[]>();
  for (const session of sessions) {
    const groupId = session.groupId || session.sessionId;
    const members = groups.get(groupId) ?? [];
    members.push(session);
    groups.set(groupId, members);
  }

  const existing = new Map(current.map((item) => [item.groupId, item]));
  const next: AgentActivityItem[] = [];

  for (const [groupId, members] of groups) {
    const old = existing.get(groupId);
    existing.delete(groupId);
    const status = groupStatus(members);
    const becameUnread =
      previousStates !== null &&
      members.some(
        (member) =>
          (member.state === "needsAttention" || member.state === "done") &&
          previousStates.get(member.sessionId) !== member.state,
      );

    // A quiet idle CLI is not actionable and should not create feed noise.
    if (status === "idle" && !old && !becameUnread) continue;
    if (status === "idle" && old && !old.unread && !becameUnread) continue;

    const focused = focusMember(members, status);
    const metadata = {
      groupId,
      sessionId: focused.sessionId,
      groupLabel: focused.groupLabel,
      agentLabels: [...new Set(members.map((member) => member.label))],
      workingDirectory: focused.workingDirectory,
      status,
      unread: (old?.unread ?? false) || becameUnread,
      updatedAt:
        !old || old.status !== status || becameUnread ? now : old.updatedAt,
    } satisfies AgentActivityItem;
    next.push(metadata);
  }

  // A completed or unread item remains useful after its PTY is closed. Active
  // rows that vanished were explicitly closed or interrupted, so remove them.
  for (const item of existing.values()) {
    if (item.unread || item.status === "ready") {
      next.push({ ...item, sessionId: null });
    }
  }

  next.sort((left, right) => right.updatedAt - left.updatedAt);
  const bounded = next.slice(0, MAX_AGENT_ACTIVITY_ITEMS);
  if (
    bounded.length === current.length &&
    bounded.every((item, index) => itemEquals(item, current[index]))
  ) {
    return current as AgentActivityItem[];
  }
  return bounded;
}

export function snapshotAgentStates(
  sessions: readonly Pick<AgentSessionSummary, "sessionId" | "state">[],
): Map<string, AgentLifecycle> {
  return new Map(sessions.map((session) => [session.sessionId, session.state]));
}

export function markAgentActivityRead(
  items: readonly AgentActivityItem[],
  groupId?: string,
): AgentActivityItem[] {
  let changed = false;
  const next = items.map((item) => {
    if (!item.unread || (groupId && item.groupId !== groupId)) return item;
    changed = true;
    return { ...item, unread: false };
  });
  return changed ? next : (items as AgentActivityItem[]);
}

export function filterAgentActivity(
  items: readonly AgentActivityItem[],
  filter: AgentActivityFilter,
): AgentActivityItem[] {
  if (filter === "all") return [...items];
  if (filter === "unread") return items.filter((item) => item.unread);
  return items.filter((item) => item.status === filter);
}
