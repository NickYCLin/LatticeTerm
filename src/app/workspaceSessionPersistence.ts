import type { AgentSessionSummary } from "./useAgentSessions";
import type { SessionSummary as SshSessionSummary } from "./useSshSessions";

export const WORKSPACE_SESSIONS_KEY = "latticeterm.workspaceSessions.v1";
const MAX_RESTORABLE_SESSIONS = 64;

export interface SavedAgentSession {
  kind: "agent";
  groupKey: string;
  groupLabel: string;
  definitionId: string;
  label: string;
  executable: string;
  workingDirectory: string;
  resumeSessionId: string | null;
}

export interface SavedSshSession {
  kind: "ssh";
  profileId: string;
}

export type SavedWorkspaceSession = SavedAgentSession | SavedSshSession;

export type SavedActiveSession =
  | { kind: "agent"; groupKey: string; definitionId: string }
  | { kind: "ssh"; profileId: string }
  | null;

export interface WorkspaceSessionSnapshot {
  version: 1;
  sessions: SavedWorkspaceSession[];
  active: SavedActiveSession;
}

export interface StorageReaderWriter {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

function safeText(value: unknown, maxBytes: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    new TextEncoder().encode(trimmed).length > maxBytes ||
    Array.from(trimmed).some((character) => /[\u0000-\u001f\u007f]/.test(character))
  ) {
    return null;
  }
  return trimmed;
}

function optionalResumeId(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  return safeText(value, 512) ?? undefined;
}

export function sanitizeWorkspaceSessionSnapshot(
  value: unknown,
): WorkspaceSessionSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.sessions)) return null;
  if (record.sessions.length > MAX_RESTORABLE_SESSIONS) return null;

  const sessions: SavedWorkspaceSession[] = [];
  for (const candidate of record.sessions) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return null;
    }
    const entry = candidate as Record<string, unknown>;
    if (entry.kind === "ssh") {
      const profileId = safeText(entry.profileId, 256);
      if (!profileId) return null;
      sessions.push({ kind: "ssh", profileId });
      continue;
    }
    if (entry.kind !== "agent") return null;
    const groupKey = safeText(entry.groupKey, 256);
    const groupLabel = safeText(entry.groupLabel, 80);
    const definitionId = safeText(entry.definitionId, 64);
    const label = safeText(entry.label, 80);
    const executable = safeText(entry.executable, 4096);
    const workingDirectory = safeText(entry.workingDirectory, 4096);
    const resumeSessionId = optionalResumeId(entry.resumeSessionId);
    if (
      !groupKey ||
      !groupLabel ||
      !definitionId ||
      !label ||
      !executable ||
      !workingDirectory ||
      resumeSessionId === undefined
    ) {
      return null;
    }
    sessions.push({
      kind: "agent",
      groupKey,
      groupLabel,
      definitionId,
      label,
      executable,
      workingDirectory,
      resumeSessionId,
    });
  }

  let active: SavedActiveSession = null;
  if (record.active !== null && record.active !== undefined) {
    if (
      typeof record.active !== "object" ||
      Array.isArray(record.active)
    ) {
      return null;
    }
    const candidate = record.active as Record<string, unknown>;
    if (candidate.kind === "ssh") {
      const profileId = safeText(candidate.profileId, 256);
      if (!profileId) return null;
      active = { kind: "ssh", profileId };
    } else if (candidate.kind === "agent") {
      const groupKey = safeText(candidate.groupKey, 256);
      const definitionId = safeText(candidate.definitionId, 64);
      if (!groupKey || !definitionId) return null;
      active = { kind: "agent", groupKey, definitionId };
    } else {
      return null;
    }
  }

  return { version: 1, sessions, active };
}

export function loadWorkspaceSessionSnapshot(
  storage: StorageReaderWriter,
): WorkspaceSessionSnapshot | null {
  try {
    const raw = storage.getItem(WORKSPACE_SESSIONS_KEY);
    if (!raw) return null;
    return sanitizeWorkspaceSessionSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveWorkspaceSessionSnapshot(
  storage: StorageReaderWriter,
  snapshot: WorkspaceSessionSnapshot,
) {
  storage.setItem(WORKSPACE_SESSIONS_KEY, JSON.stringify(snapshot));
}

export function snapshotLiveWorkspaceSessions(
  agents: readonly AgentSessionSummary[],
  ssh: readonly SshSessionSummary[],
  activeSessionId: string | null,
): WorkspaceSessionSnapshot {
  const activeAgent = agents.find((session) => session.sessionId === activeSessionId);
  const activeSsh = ssh.find((session) => session.sessionId === activeSessionId);
  const sessions: SavedWorkspaceSession[] = agents.map((session) => ({
    kind: "agent",
    groupKey: session.groupId || session.sessionId,
    groupLabel: session.groupLabel,
    definitionId: session.definitionId,
    label: session.label,
    executable: session.executable,
    workingDirectory: session.workingDirectory,
    resumeSessionId: session.capturedSessionId,
  }));
  const seenProfiles = new Set<string>();
  for (const session of ssh) {
    // Reconnecting the same saved profile more than once only creates
    // indistinguishable duplicate tabs and can multiply login prompts.
    if (seenProfiles.has(session.profileId)) continue;
    seenProfiles.add(session.profileId);
    sessions.push({ kind: "ssh", profileId: session.profileId });
  }
  const active: SavedActiveSession = activeAgent
    ? {
        kind: "agent",
        groupKey: activeAgent.groupId || activeAgent.sessionId,
        definitionId: activeAgent.definitionId,
      }
    : activeSsh
      ? { kind: "ssh", profileId: activeSsh.profileId }
      : null;
  return { version: 1, sessions, active };
}

export function agentRestoreArguments(session: SavedAgentSession): string[] {
  if (session.resumeSessionId) return [];
  if (session.definitionId === "codex") return ["resume", "--last"];
  if (session.definitionId === "antigravity") return ["--continue"];
  return [];
}
