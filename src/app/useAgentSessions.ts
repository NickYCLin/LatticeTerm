import { useCallback, useEffect, useRef, useState } from "react";

export type AgentLifecycle = "working" | "needsAttention" | "idle" | "done";
export type AgentStateSource = "heuristic" | "integration";
export type AgentBackendMode = "loading" | "ready" | "unavailable";

export interface AgentDefinition {
  id: string;
  label: string;
  executable: string;
  adapterVersion: number;
  resumeSupported: boolean;
  installed: boolean;
  installedPath: string | null;
}

export interface AgentSessionSummary {
  sessionId: string;
  definitionId: string;
  label: string;
  executable: string;
  workingDirectory: string;
  state: AgentLifecycle;
  stateSource: AgentStateSource;
  processId: number | null;
}

export interface AgentLaunchRequest {
  definitionId: string;
  label: string;
  executable: string;
  arguments: string[];
  resumeSessionId: string | null;
  workingDirectory: string;
  cols: number;
  rows: number;
}

export type AgentLaunchPlanDraft = Omit<AgentLaunchRequest, "cols" | "rows">;

export interface AgentLaunchPlan extends AgentLaunchPlanDraft {
  id: string;
}

export interface AgentPlanRecovery {
  reason: string;
  backupPath: string;
}

interface AgentPlanSnapshot {
  workspaceName: string;
  plans: AgentLaunchPlan[];
  recovery: AgentPlanRecovery | null;
}

export interface AgentStateEvent {
  sessionId: string;
  state: AgentLifecycle;
  source: AgentStateSource;
}

export interface AgentBroadcastOutcome {
  sessionId: string;
  delivered: boolean;
  error: string | null;
}

export interface AgentRestoreOutcome {
  planId: string;
  label: string;
  session: AgentSessionSummary | null;
  error: string | null;
}

export function applyAgentStateEvent(
  sessions: AgentSessionSummary[],
  event: AgentStateEvent,
): AgentSessionSummary[] {
  return sessions.map((session) =>
    session.sessionId === event.sessionId
      ? { ...session, state: event.state, stateSource: event.source }
      : session,
  );
}

const FALLBACK_CATALOG_SOURCE: [string, string, string, boolean][] = [
  ["codex", "OpenAI Codex", "codex", true],
  ["claude", "Claude Code", "claude", true],
  ["gemini", "Gemini CLI", "gemini", true],
  ["opencode", "OpenCode", "opencode", false],
  ["copilot", "GitHub Copilot CLI", "copilot", false],
  ["hermes", "Hermes Agent", "hermes", true],
  ["cursor", "Cursor Agent", "cursor-agent", false],
  ["aider", "Aider", "aider", false],
  ["qwen", "Qwen Code", "qwen", false],
  ["kimi", "Kimi Code CLI", "kimi", false],
  ["droid", "Factory Droid", "droid", false],
  ["grok", "Grok CLI", "grok", false],
];

const FALLBACK_CATALOG: AgentDefinition[] = FALLBACK_CATALOG_SOURCE.map(
  ([id, label, executable, resumeSupported]) => ({
  id,
  label,
  executable,
  adapterVersion: 1,
  resumeSupported,
  installed: false,
  installedPath: null,
  }),
);

const MAX_PENDING_OUTPUT = 256 * 1024;
export const MAX_AGENT_BROADCAST_TARGETS = 32;
export const MAX_SAVED_AGENT_PLANS = 32;

async function core() {
  return import("@tauri-apps/api/core");
}

async function events() {
  return import("@tauri-apps/api/event");
}

export function encodeAgentPayload(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function decodeAgentPayload(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function splitAgentArguments(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((argument) => argument.trim())
    .filter(Boolean);
}

export function buildAgentBroadcastPayload(value: string): string {
  if (!value.trim()) return "";
  const normalized = value.replace(/\r?\n/g, "\r").replace(/\r+$/, "");
  return `${normalized}\r`;
}

export function moveAgentLaunchPlan(
  plans: AgentLaunchPlan[],
  id: string,
  offset: -1 | 1,
): AgentLaunchPlan[] {
  const index = plans.findIndex((plan) => plan.id === id);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= plans.length) return plans;
  const next = [...plans];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export interface AgentApi {
  mode: AgentBackendMode;
  error: string | null;
  catalog: AgentDefinition[];
  defaultWorkingDirectory: string;
  sessions: AgentSessionSummary[];
  workspaceName: string;
  plans: AgentLaunchPlan[];
  planRecovery: AgentPlanRecovery | null;
  refreshCatalog: () => Promise<void>;
  launch: (request: AgentLaunchRequest) => Promise<AgentSessionSummary>;
  savePlan: (draft: AgentLaunchPlanDraft) => Promise<AgentLaunchPlan>;
  renameWorkspace: (name: string) => Promise<string>;
  reorderPlans: (orderedIds: string[]) => Promise<AgentLaunchPlan[]>;
  deletePlan: (id: string) => Promise<boolean>;
  restorePlans: (planIds: string[]) => Promise<AgentRestoreOutcome[]>;
  send: (sessionId: string, data: string) => Promise<void>;
  broadcast: (
    sessionIds: string[],
    prompt: string,
  ) => Promise<AgentBroadcastOutcome[]>;
  resize: (sessionId: string, cols: number, rows: number) => Promise<void>;
  disconnect: (sessionId: string) => Promise<void>;
  onData: (
    sessionId: string,
    handler: (bytes: Uint8Array) => void,
  ) => () => void;
  onClosed: (
    sessionId: string,
    handler: (reason: string) => void,
  ) => () => void;
}

export function useAgentSessions(): AgentApi {
  const [mode, setMode] = useState<AgentBackendMode>("loading");
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<AgentDefinition[]>(FALLBACK_CATALOG);
  const [defaultWorkingDirectory, setDefaultWorkingDirectory] = useState("");
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [workspaceName, setWorkspaceName] = useState("");
  const [plans, setPlans] = useState<AgentLaunchPlan[]>([]);
  const [planRecovery, setPlanRecovery] = useState<AgentPlanRecovery | null>(
    null,
  );
  const dataHandlers = useRef(
    new Map<string, Set<(bytes: Uint8Array) => void>>(),
  );
  const closeHandlers = useRef(
    new Map<string, Set<(reason: string) => void>>(),
  );
  const pendingOutput = useRef(new Map<string, Uint8Array[]>());
  const pendingBytes = useRef(new Map<string, number>());

  const load = useCallback(async () => {
    try {
      const { invoke } = await core();
      const [definitions, directory, currentSessions, planSnapshot] =
        await Promise.all([
        invoke<AgentDefinition[]>("agent_catalog"),
        invoke<string>("agent_default_working_directory"),
        invoke<AgentSessionSummary[]>("agent_sessions"),
        invoke<AgentPlanSnapshot>("agent_plan_snapshot"),
      ]);
      setCatalog(definitions);
      setDefaultWorkingDirectory(directory);
      setSessions(currentSessions);
      setWorkspaceName(planSnapshot.workspaceName);
      setPlans(planSnapshot.plans);
      setPlanRecovery(planSnapshot.recovery);
      setError(null);
      setMode("ready");
    } catch (reason) {
      setCatalog(FALLBACK_CATALOG);
      setError(reason instanceof Error ? reason.message : String(reason));
      setMode("unavailable");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let disposed = false;
    const cleanups: (() => void)[] = [];

    void events()
      .then(async ({ listen }) => {
        if (disposed) return;
        const stopData = await listen<{ sessionId: string; base64: string }>(
          "agent://data",
          (event) => {
            const bytes = decodeAgentPayload(event.payload.base64);
            const handlers = dataHandlers.current.get(event.payload.sessionId);
            if (handlers?.size) {
              handlers.forEach((handler) => handler(bytes));
              return;
            }

            const current = pendingOutput.current.get(event.payload.sessionId) ?? [];
            const currentBytes = pendingBytes.current.get(event.payload.sessionId) ?? 0;
            current.push(bytes);
            let total = currentBytes + bytes.length;
            while (total > MAX_PENDING_OUTPUT && current.length > 1) {
              total -= current.shift()?.length ?? 0;
            }
            pendingOutput.current.set(event.payload.sessionId, current);
            pendingBytes.current.set(event.payload.sessionId, total);
          },
        );
        if (disposed) {
          stopData();
          return;
        }
        cleanups.push(stopData);

        const stopState = await listen<AgentStateEvent>(
          "agent://state",
          (event) => {
            setSessions((current) => applyAgentStateEvent(current, event.payload));
          },
        );
        if (disposed) {
          stopState();
          return;
        }
        cleanups.push(stopState);

        const stopClosed = await listen<{
          sessionId: string;
          reason: string;
        }>("agent://closed", (event) => {
          setSessions((current) =>
            current.filter(
              (session) => session.sessionId !== event.payload.sessionId,
            ),
          );
          pendingOutput.current.delete(event.payload.sessionId);
          pendingBytes.current.delete(event.payload.sessionId);
          closeHandlers.current
            .get(event.payload.sessionId)
            ?.forEach((handler) => handler(event.payload.reason));
        });
        if (disposed) stopClosed();
        else cleanups.push(stopClosed);
      })
      .catch(() => {
        // Browser previews have no Tauri event bus; the catalog explains this.
      });

    return () => {
      disposed = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);

  const launch = useCallback(async (request: AgentLaunchRequest) => {
    const { invoke } = await core();
    const session = await invoke<AgentSessionSummary>("agent_launch", {
      request,
    });
    setSessions((current) => [
      ...current.filter((entry) => entry.sessionId !== session.sessionId),
      session,
    ]);
    return session;
  }, []);

  const savePlan = useCallback(async (draft: AgentLaunchPlanDraft) => {
    const { invoke } = await core();
    const plan = await invoke<AgentLaunchPlan>("agent_plan_save", { draft });
    setPlans((current) => [...current, plan]);
    return plan;
  }, []);

  const renameWorkspace = useCallback(async (name: string) => {
    const { invoke } = await core();
    const saved = await invoke<string>("agent_workspace_rename", { name });
    setWorkspaceName(saved);
    return saved;
  }, []);

  const reorderPlans = useCallback(async (orderedIds: string[]) => {
    const { invoke } = await core();
    const reordered = await invoke<AgentLaunchPlan[]>("agent_plan_reorder", {
      orderedIds,
    });
    setPlans(reordered);
    return reordered;
  }, []);

  const deletePlan = useCallback(async (id: string) => {
    const { invoke } = await core();
    const deleted = await invoke<boolean>("agent_plan_delete", { id });
    if (deleted) {
      setPlans((current) => current.filter((plan) => plan.id !== id));
    }
    return deleted;
  }, []);

  const restorePlans = useCallback(async (planIds: string[]) => {
    const { invoke } = await core();
    const outcomes = await invoke<AgentRestoreOutcome[]>("agent_plan_restore", {
      planIds,
    });
    const currentSessions =
      await invoke<AgentSessionSummary[]>("agent_sessions");
    setSessions(currentSessions);
    return outcomes;
  }, []);

  const send = useCallback(async (sessionId: string, data: string) => {
    const { invoke } = await core();
    await invoke("agent_send", {
      sessionId,
      data: encodeAgentPayload(new TextEncoder().encode(data)),
    });
  }, []);

  const broadcast = useCallback(async (sessionIds: string[], prompt: string) => {
    const payload = buildAgentBroadcastPayload(prompt);
    if (!payload) throw new Error("A broadcast prompt is required.");
    const { invoke } = await core();
    return invoke<AgentBroadcastOutcome[]>("agent_broadcast", {
      sessionIds,
      data: encodeAgentPayload(new TextEncoder().encode(payload)),
    });
  }, []);

  const resize = useCallback(
    async (sessionId: string, cols: number, rows: number) => {
      const { invoke } = await core();
      await invoke("agent_resize", { sessionId, cols, rows });
    },
    [],
  );

  const disconnect = useCallback(async (sessionId: string) => {
    const { invoke } = await core();
    try {
      await invoke("agent_disconnect", { sessionId });
    } finally {
      setSessions((current) =>
        current.filter((session) => session.sessionId !== sessionId),
      );
    }
  }, []);

  const onData = useCallback(
    (sessionId: string, handler: (bytes: Uint8Array) => void) => {
      const handlers = dataHandlers.current.get(sessionId) ?? new Set();
      handlers.add(handler);
      dataHandlers.current.set(sessionId, handlers);

      const pending = pendingOutput.current.get(sessionId);
      if (pending) {
        pending.forEach(handler);
        pendingOutput.current.delete(sessionId);
        pendingBytes.current.delete(sessionId);
      }

      return () => {
        handlers.delete(handler);
        if (handlers.size === 0) dataHandlers.current.delete(sessionId);
      };
    },
    [],
  );

  const onClosed = useCallback(
    (sessionId: string, handler: (reason: string) => void) => {
      const handlers = closeHandlers.current.get(sessionId) ?? new Set();
      handlers.add(handler);
      closeHandlers.current.set(sessionId, handlers);
      return () => {
        handlers.delete(handler);
        if (handlers.size === 0) closeHandlers.current.delete(sessionId);
      };
    },
    [],
  );

  return {
    mode,
    error,
    catalog,
    defaultWorkingDirectory,
    sessions,
    workspaceName,
    plans,
    planRecovery,
    refreshCatalog: load,
    launch,
    savePlan,
    renameWorkspace,
    reorderPlans,
    deletePlan,
    restorePlans,
    send,
    broadcast,
    resize,
    disconnect,
    onData,
    onClosed,
  };
}
