import { useCallback, useEffect, useRef, useState } from "react";
import {
  createSessionClosedNotice,
  reconcileSessionSnapshot,
  type SessionClosedNotice,
} from "./sessionSnapshot";

export type AgentLifecycle = "working" | "needsAttention" | "idle" | "done";
export type AgentStateSource = "heuristic" | "integration";
export type AgentBackendMode = "loading" | "ready" | "unavailable";

export interface AgentDefinition {
  id: string;
  label: string;
  executable: string;
  adapterVersion: number;
  resumeSupported: boolean;
  /** Saved launch items can continue the latest context without storing an id. */
  resumeLatestSupported: boolean;
  /** Whether this CLI's conversation can be read for a handoff to another CLI. */
  transcriptSupported: boolean;
  installed: boolean;
  installedPath: string | null;
  /** Google consumer OAuth moved from Gemini CLI to Antigravity CLI. */
  consumerOauthDeprecated: boolean;
  account: AgentAccountInfo;
  install: AgentInstallDefinition;
}

/**
 * Presents Google's personal-account CLI as one Antigravity item while
 * keeping Gemini visible for API-key, Vertex, and enterprise setups.
 */
export function agentCatalogForDisplay(
  catalog: readonly AgentDefinition[],
): AgentDefinition[] {
  const antigravity = catalog.find((definition) => definition.id === "antigravity");
  const gemini = catalog.find((definition) => definition.id === "gemini");
  if (!antigravity || !gemini || !gemini.consumerOauthDeprecated) {
    return [...catalog];
  }

  return catalog
    .filter((definition) => definition.id !== "gemini")
    .map((definition) => {
      if (definition.id !== "antigravity") return definition;
      const detectedGeminiAccount =
        definition.account.state !== "signedIn" &&
        gemini.account.state === "signedIn"
          ? {
              ...gemini.account,
              method: `${gemini.account.method ?? "Google"} · Gemini CLI`,
            }
          : definition.account;
      return {
        ...definition,
        account: detectedGeminiAccount,
        consumerOauthDeprecated: true,
      };
    });
}

export interface AgentAccountInfo {
  state: "signedIn" | "signedOut" | "unknown" | "unsupported";
  /** Email/account label only. Authentication tokens never enter the WebView. */
  label: string | null;
  method: string | null;
}

export interface AgentInstallDefinition {
  executable: string | null;
  arguments: string[];
  displayCommand: string;
  sourceUrl: string;
  available: boolean;
}

export interface AgentSessionSummary {
  sessionId: string;
  /** CLIs sharing one tab carry the same groupId; defaults to sessionId. */
  groupId: string;
  /** User-facing tab name shared by every CLI in this group. */
  groupLabel: string;
  definitionId: string;
  /** CLI name; independent from the user-facing tab name. */
  label: string;
  /** Model announced by the CLI or explicitly supplied through --model. */
  model: string | null;
  executable: string;
  /** Original CLI arguments, retained so a safe relaunch can preserve options. */
  launchArguments: string[];
  workingDirectory: string;
  state: AgentLifecycle;
  stateSource: AgentStateSource;
  processId: number | null;
  /** The CLI's own session id, once its output announced one. */
  capturedSessionId: string | null;
}

export interface AgentLaunchRequest {
  definitionId: string;
  label: string;
  executable: string;
  arguments: string[];
  resumeSessionId: string | null;
  /** Join an existing tab's CLI group; omit to start a new tab. */
  groupId?: string | null;
  /** A handoff brief pasted in once the CLI is interactive; omit for none. */
  seedInput?: string | null;
  /** Relaunches saved work and must not inject the new-session instructions. */
  restoreExistingSession?: boolean;
  workingDirectory: string;
  cols: number;
  rows: number;
}

export type AgentLaunchPlanDraft = Omit<
  AgentLaunchRequest,
  "cols" | "rows" | "restoreExistingSession"
> & {
  /** Free-text memo, e.g. which project this plan is for. "" means none. */
  note: string;
};

export interface AgentLaunchPlan extends AgentLaunchPlanDraft {
  id: string;
}

export interface AgentPlanRecovery {
  reason: string;
  backupPath: string;
}

interface AgentPlanSnapshot {
  workspaceName: string;
  startupInstructions: string;
  plans: AgentLaunchPlan[];
  recovery: AgentPlanRecovery | null;
}

export interface AgentStateEvent {
  sessionId: string;
  state: AgentLifecycle;
  source: AgentStateSource;
}

export interface AgentModelEvent {
  sessionId: string;
  model: string;
}

export interface AgentOutputEvent {
  sessionId: string;
  offset: number;
  base64: string;
}

export interface AgentOutputSnapshot {
  sessionId: string;
  startOffset: number;
  endOffset: number;
  base64: string;
}

export interface AgentOutputChunk {
  offset: number;
  bytes: Uint8Array;
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
  ["antigravity", "Google Antigravity CLI", "agy", false],
  ["opencode", "OpenCode", "opencode", false],
  ["copilot", "GitHub Copilot CLI", "copilot", false],
  ["hermes", "Hermes Agent", "hermes", true],
  ["cursor", "Cursor Agent", "agent", false],
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
    resumeLatestSupported: id === "codex" || id === "antigravity",
    transcriptSupported: id === "codex" || id === "claude",
    installed: false,
    installedPath: null,
    consumerOauthDeprecated: id === "gemini",
    account: { state: "unsupported", label: null, method: null },
    install: {
      executable: null,
      arguments: [],
      displayCommand: "",
      sourceUrl: "",
      available: false,
    },
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

export function reconcileAgentOutputSnapshot(
  snapshot: AgentOutputSnapshot | null,
  events: AgentOutputEvent[],
): AgentOutputChunk[] {
  const chunks: AgentOutputChunk[] = [];
  let cursor = 0;
  if (snapshot) {
    const bytes = decodeAgentPayload(snapshot.base64);
    if (bytes.length !== snapshot.endOffset - snapshot.startOffset) {
      throw new Error("Agent output snapshot offsets are inconsistent.");
    }
    if (bytes.length > 0) {
      chunks.push({ offset: snapshot.startOffset, bytes });
    }
    cursor = snapshot.endOffset;
  }

  const ordered = [...events].sort((left, right) => left.offset - right.offset);
  for (const event of ordered) {
    const bytes = decodeAgentPayload(event.base64);
    const endOffset = event.offset + bytes.length;
    if (endOffset <= cursor) continue;
    const freshOffset = Math.max(cursor, event.offset);
    const fresh = bytes.subarray(freshOffset - event.offset);
    if (fresh.length > 0) chunks.push({ offset: freshOffset, bytes: fresh });
    cursor = endOffset;
  }
  return chunks;
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
  lastClosed: SessionClosedNotice | null;
  workspaceName: string;
  startupInstructions: string;
  plans: AgentLaunchPlan[];
  planRecovery: AgentPlanRecovery | null;
  refreshCatalog: () => Promise<void>;
  launch: (request: AgentLaunchRequest) => Promise<AgentSessionSummary>;
  /** Renames a CLI group's tab label; persists so a reload keeps it. */
  rename: (sessionId: string, label: string) => Promise<AgentSessionSummary>;
  savePlan: (draft: AgentLaunchPlanDraft) => Promise<AgentLaunchPlan>;
  renameWorkspace: (name: string) => Promise<string>;
  updateStartupInstructions: (instructions: string) => Promise<string>;
  reorderPlans: (orderedIds: string[]) => Promise<AgentLaunchPlan[]>;
  deletePlan: (id: string) => Promise<boolean>;
  restorePlans: (planIds: string[]) => Promise<AgentRestoreOutcome[]>;
  send: (sessionId: string, data: string) => Promise<void>;
  /** Writes a clipboard image to a temp file and returns its path, or null. */
  pasteClipboardImage: (sessionId: string) => Promise<string | null>;
  /** Reads a CLI's conversation as text for a handoff, or null if unavailable. */
  exportTranscript: (sessionId: string) => Promise<string | null>;
  broadcast: (
    sessionIds: string[],
    prompt: string,
  ) => Promise<AgentBroadcastOutcome[]>;
  resize: (sessionId: string, cols: number, rows: number) => Promise<void>;
  disconnect: (sessionId: string) => Promise<void>;
  clearLastClosed: () => void;
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
  const [lastClosed, setLastClosed] = useState<SessionClosedNotice | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [startupInstructions, setStartupInstructions] = useState("");
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
  const outputOffsets = useRef(new Map<string, number>());
  const sessionsRef = useRef(sessions);
  const intentionalDisconnects = useRef(new Set<string>());
  sessionsRef.current = sessions;

  const refreshCatalog = useCallback(async () => {
    try {
      const { invoke } = await core();
      const [definitions, directory, planSnapshot] = await Promise.all([
        invoke<AgentDefinition[]>("agent_catalog"),
        invoke<string>("agent_default_working_directory"),
        invoke<AgentPlanSnapshot>("agent_plan_snapshot"),
      ]);
      setCatalog(definitions);
      setDefaultWorkingDirectory(directory);
      setWorkspaceName(planSnapshot.workspaceName);
      setStartupInstructions(planSnapshot.startupInstructions);
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
    let disposed = false;
    let hydrating = true;
    const cleanups: (() => void)[] = [];
    const closedDuringHydration = new Set<string>();
    const outputDuringHydration = new Map<string, AgentOutputEvent[]>();
    const stateDuringHydration = new Map<string, AgentStateEvent>();
    const captureDuringHydration = new Map<string, string>();
    const modelDuringHydration = new Map<string, string>();

    function keep(cleanup: () => void): boolean {
      if (disposed) {
        cleanup();
        return false;
      }
      cleanups.push(cleanup);
      return true;
    }

    function deliverOutput(
      sessionId: string,
      offset: number,
      bytes: Uint8Array,
    ) {
      const endOffset = offset + bytes.length;
      const cursor = outputOffsets.current.get(sessionId) ?? offset;
      if (endOffset <= cursor) return;
      const fresh = bytes.subarray(Math.max(0, cursor - offset));
      if (fresh.length === 0) return;
      outputOffsets.current.set(sessionId, endOffset);

      const handlers = dataHandlers.current.get(sessionId);
      if (handlers?.size) {
        handlers.forEach((handler) => handler(fresh));
        return;
      }

      const chunks = pendingOutput.current.get(sessionId) ?? [];
      let total = pendingBytes.current.get(sessionId) ?? 0;
      chunks.push(fresh);
      total += fresh.length;
      while (total > MAX_PENDING_OUTPUT && chunks.length > 0) {
        const overflow = total - MAX_PENDING_OUTPUT;
        const first = chunks[0];
        if (first.length <= overflow) {
          chunks.shift();
          total -= first.length;
        } else {
          chunks[0] = first.subarray(overflow);
          total -= overflow;
        }
      }
      pendingOutput.current.set(sessionId, chunks);
      pendingBytes.current.set(sessionId, total);
    }

    async function subscribeAndHydrate() {
      try {
        const [{ invoke }, { listen }] = await Promise.all([core(), events()]);

        const stopClosed = await listen<{
          sessionId: string;
          reason: string;
        }>("agent://closed", (event) => {
          const sessionId = event.payload.sessionId;
          if (hydrating) closedDuringHydration.add(sessionId);
          const intentional = intentionalDisconnects.current.delete(sessionId);
          if (!intentional) {
            setLastClosed(
              createSessionClosedNotice(
                sessionsRef.current,
                sessionId,
                event.payload.reason,
                (session) => session.label,
              ),
            );
          }
          setSessions((current) =>
            current.filter((session) => session.sessionId !== sessionId),
          );
          outputDuringHydration.delete(sessionId);
          pendingOutput.current.delete(sessionId);
          pendingBytes.current.delete(sessionId);
          outputOffsets.current.delete(sessionId);
          closeHandlers.current
            .get(sessionId)
            ?.forEach((handler) => handler(event.payload.reason));
        });
        if (!keep(stopClosed)) return;

        const stopData = await listen<AgentOutputEvent>(
          "agent://data",
          (event) => {
            const payload = event.payload;
            if (hydrating) {
              const queued = outputDuringHydration.get(payload.sessionId) ?? [];
              queued.push(payload);
              outputDuringHydration.set(payload.sessionId, queued);
              return;
            }
            deliverOutput(
              payload.sessionId,
              payload.offset,
              decodeAgentPayload(payload.base64),
            );
          },
        );
        if (!keep(stopData)) return;

        const stopState = await listen<AgentStateEvent>(
          "agent://state",
          (event) => {
            if (hydrating) {
              stateDuringHydration.set(event.payload.sessionId, event.payload);
              return;
            }
            setSessions((current) =>
              applyAgentStateEvent(current, event.payload),
            );
          },
        );
        if (!keep(stopState)) return;

        const stopCapture = await listen<{
          sessionId: string;
          nativeSessionId: string;
        }>("agent://capture", (event) => {
          if (hydrating) {
            captureDuringHydration.set(
              event.payload.sessionId,
              event.payload.nativeSessionId,
            );
            return;
          }
          setSessions((current) =>
            current.map((session) =>
              session.sessionId === event.payload.sessionId
                ? {
                    ...session,
                    capturedSessionId: event.payload.nativeSessionId,
                  }
                : session,
            ),
          );
        });
        if (!keep(stopCapture)) return;

        const stopModel = await listen<AgentModelEvent>(
          "agent://model",
          (event) => {
            if (hydrating) {
              modelDuringHydration.set(event.payload.sessionId, event.payload.model);
              return;
            }
            setSessions((current) =>
              current.map((session) =>
                session.sessionId === event.payload.sessionId
                  ? { ...session, model: event.payload.model }
                  : session,
              ),
            );
          },
        );
        if (!keep(stopModel)) return;

        const [
          definitions,
          directory,
          existingSessions,
          planSnapshot,
          outputSnapshots,
        ] = await Promise.all([
          invoke<AgentDefinition[]>("agent_catalog"),
          invoke<string>("agent_default_working_directory"),
          invoke<AgentSessionSummary[]>("agent_sessions"),
          invoke<AgentPlanSnapshot>("agent_plan_snapshot"),
          invoke<AgentOutputSnapshot[]>("agent_output_snapshots"),
        ]);
        if (disposed) return;

        setSessions((current) => {
          let restored = reconcileSessionSnapshot(
            current,
            existingSessions,
            closedDuringHydration,
          );
          for (const event of stateDuringHydration.values()) {
            restored = applyAgentStateEvent(restored, event);
          }
          return restored.map((session) => {
            const capturedSessionId = captureDuringHydration.get(
              session.sessionId,
            );
            const model = modelDuringHydration.get(session.sessionId);
            return {
              ...session,
              ...(capturedSessionId ? { capturedSessionId } : {}),
              ...(model ? { model } : {}),
            };
          });
        });

        const snapshotsBySession = new Map(
          outputSnapshots.map((snapshot) => [snapshot.sessionId, snapshot]),
        );
        for (const snapshot of outputSnapshots) {
          if (closedDuringHydration.has(snapshot.sessionId)) continue;
          for (const chunk of reconcileAgentOutputSnapshot(
            snapshot,
            outputDuringHydration.get(snapshot.sessionId) ?? [],
          )) {
            deliverOutput(snapshot.sessionId, chunk.offset, chunk.bytes);
          }
        }
        for (const [sessionId, queued] of outputDuringHydration) {
          if (
            closedDuringHydration.has(sessionId) ||
            snapshotsBySession.has(sessionId)
          ) {
            continue;
          }
          for (const chunk of reconcileAgentOutputSnapshot(null, queued)) {
            deliverOutput(sessionId, chunk.offset, chunk.bytes);
          }
        }

        hydrating = false;
        closedDuringHydration.clear();
        outputDuringHydration.clear();
        stateDuringHydration.clear();
        captureDuringHydration.clear();
        modelDuringHydration.clear();
        setCatalog(definitions);
        setDefaultWorkingDirectory(directory);
        setWorkspaceName(planSnapshot.workspaceName);
        setStartupInstructions(planSnapshot.startupInstructions);
        setPlans(planSnapshot.plans);
        setPlanRecovery(planSnapshot.recovery);
        setError(null);
        setMode("ready");
      } catch (reason) {
        hydrating = false;
        closedDuringHydration.clear();
        outputDuringHydration.clear();
        stateDuringHydration.clear();
        captureDuringHydration.clear();
        modelDuringHydration.clear();
        setCatalog(FALLBACK_CATALOG);
        setError(reason instanceof Error ? reason.message : String(reason));
        setMode("unavailable");
      }
    }

    void subscribeAndHydrate();
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

  const rename = useCallback(async (sessionId: string, label: string) => {
    const { invoke } = await core();
    const updated = await invoke<AgentSessionSummary>("agent_rename", {
      sessionId,
      label,
    });
    setSessions((current) =>
      current.map((session) =>
        session.groupId === updated.groupId
          ? { ...session, groupLabel: updated.groupLabel }
          : session,
      ),
    );
    return updated;
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

  const updateStartupInstructions = useCallback(async (instructions: string) => {
    const { invoke } = await core();
    const saved = await invoke<string>("agent_workspace_instructions_update", {
      instructions,
    });
    setStartupInstructions(saved);
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
    setSessions((current) =>
      reconcileSessionSnapshot(current, currentSessions),
    );
    return outcomes;
  }, []);

  const send = useCallback(async (sessionId: string, data: string) => {
    const { invoke } = await core();
    await invoke("agent_send", {
      sessionId,
      data: encodeAgentPayload(new TextEncoder().encode(data)),
    });
  }, []);

  const pasteClipboardImage = useCallback(
    async (sessionId: string): Promise<string | null> => {
      const { invoke } = await core();
      return invoke<string | null>("agent_paste_clipboard_image", {
        sessionId,
      });
    },
    [],
  );

  const exportTranscript = useCallback(
    async (sessionId: string): Promise<string | null> => {
      const { invoke } = await core();
      return invoke<string | null>("agent_export_transcript", { sessionId });
    },
    [],
  );

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
    intentionalDisconnects.current.add(sessionId);
    try {
      const { invoke } = await core();
      await invoke("agent_disconnect", { sessionId });
      setSessions((current) =>
        current.filter((session) => session.sessionId !== sessionId),
      );
    } catch (reason) {
      intentionalDisconnects.current.delete(sessionId);
      throw reason;
    }
  }, []);

  const clearLastClosed = useCallback(() => setLastClosed(null), []);

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
    lastClosed,
    workspaceName,
    startupInstructions,
    plans,
    planRecovery,
    refreshCatalog,
    launch,
    rename,
    savePlan,
    renameWorkspace,
    updateStartupInstructions,
    reorderPlans,
    deletePlan,
    restorePlans,
    send,
    pasteClipboardImage,
    exportTranscript,
    broadcast,
    resize,
    disconnect,
    clearLastClosed,
    onData,
    onClosed,
  };
}
