/**
 * Chat threads with an agent CLI: the data model, the rule that folds the
 * backend's event stream into a thread, and the bounds applied before a
 * thread is written to browser storage.
 *
 * Nothing here talks to the backend or the DOM, so every rule is testable
 * on its own. The hook in `useAgentChat` wires it to Tauri.
 */

export type ChatDefinitionId = "claude" | "codex";

/** What the CLI may do during a turn; see `ChatPermission` in Rust. */
export type ChatPermission = "ask" | "readOnly" | "workspaceWrite" | "full";

export const chatPermissions: readonly ChatPermission[] = [
  "ask",
  "readOnly",
  "workspaceWrite",
  "full",
];

/**
 * The permissions a CLI can honour in chat mode. Asking per tool call needs
 * a bidirectional headless protocol, which only Claude Code has.
 */
export function permissionsFor(
  definitionId: ChatDefinitionId,
): readonly ChatPermission[] {
  return definitionId === "claude"
    ? chatPermissions
    : chatPermissions.filter((permission) => permission !== "ask");
}

/** The permission a new thread starts with: ask when the CLI can. */
export function defaultPermission(definitionId: ChatDefinitionId): ChatPermission {
  return definitionId === "claude" ? "ask" : "readOnly";
}

export type ApprovalDecision = "pending" | "allowed" | "denied" | "closed";

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
}

export type ChatEvent =
  | { kind: "started"; nativeSessionId: string | null; model: string | null }
  | { kind: "textDelta"; itemId: string; delta: string }
  | { kind: "text"; itemId: string; text: string }
  | { kind: "reasoning"; itemId: string; text: string }
  | { kind: "toolStarted"; itemId: string; name: string; summary: string }
  | {
      kind: "toolFinished";
      itemId: string;
      name: string | null;
      summary: string | null;
      output: string;
      isError: boolean;
    }
  | { kind: "notice"; message: string }
  | {
      kind: "approvalRequested";
      requestId: string;
      toolUseId: string | null;
      name: string;
      summary: string;
      input: string;
    }
  | {
      kind: "finished";
      nativeSessionId: string | null;
      usage: ChatUsage | null;
      costUsd: number | null;
      durationMs: number | null;
      error: string | null;
    };

export interface ChatEventEnvelope {
  threadId: string;
  turnId: string;
  event: ChatEvent;
}

export type ChatItem =
  | { type: "user"; id: string; text: string; at: number }
  | { type: "text"; id: string; text: string }
  | { type: "reasoning"; id: string; text: string }
  | {
      type: "tool";
      id: string;
      name: string;
      summary: string;
      output: string | null;
      isError: boolean;
      done: boolean;
    }
  | { type: "notice"; id: string; text: string }
  | {
      type: "approval";
      id: string;
      requestId: string;
      name: string;
      summary: string;
      input: string;
      decision: ApprovalDecision;
    }
  | {
      type: "turnEnd";
      id: string;
      usage: ChatUsage | null;
      costUsd: number | null;
      durationMs: number | null;
      error: string | null;
    };

export interface ChatThread {
  id: string;
  definitionId: ChatDefinitionId;
  /** First message, shortened; what the thread list shows. */
  title: string;
  workingDirectory: string;
  permission: ChatPermission;
  model: string;
  /** The CLI's own conversation id, once the first turn announced it. */
  nativeSessionId: string | null;
  /** Model the CLI reported, when it did; never guessed from the name. */
  reportedModel: string | null;
  items: ChatItem[];
  createdAt: number;
  updatedAt: number;
  /** The turn in flight. Stored threads never carry one: a process does
   *  not outlive the window that started it. */
  runningTurnId: string | null;
}

export const MAX_TITLE_LENGTH = 60;
/** Items kept per thread in storage; older ones fall off the top. */
export const MAX_STORED_ITEMS = 300;
/** Tool output kept per card in storage. The CLI has the full transcript. */
export const MAX_STORED_TOOL_OUTPUT = 2 * 1024;
/** Total budget for all stored threads, oldest dropped first. */
export const MAX_STORED_BYTES = 4 * 1024 * 1024;
export const MAX_STORED_THREADS = 50;

export function threadTitle(prompt: string): string {
  const line = prompt.trim().split(/\r?\n/, 1)[0] ?? "";
  if (line.length <= MAX_TITLE_LENGTH) return line;
  return `${line.slice(0, MAX_TITLE_LENGTH - 1)}…`;
}

export function createThread(
  settings: Pick<
    ChatThread,
    "definitionId" | "workingDirectory" | "permission" | "model"
  >,
  id: string = crypto.randomUUID(),
  now: number = Date.now(),
): ChatThread {
  return {
    id,
    definitionId: settings.definitionId,
    title: "",
    workingDirectory: settings.workingDirectory,
    permission: settings.permission,
    model: settings.model.trim(),
    nativeSessionId: null,
    reportedModel: null,
    items: [],
    createdAt: now,
    updatedAt: now,
    runningTurnId: null,
  };
}

/** The user's message going out, and the turn it starts. */
export function beginTurn(
  thread: ChatThread,
  prompt: string,
  turnId: string,
  now: number = Date.now(),
): ChatThread {
  return {
    ...thread,
    title: thread.title || threadTitle(prompt),
    items: [
      ...thread.items,
      { type: "user", id: `${turnId}:prompt`, text: prompt, at: now },
    ],
    updatedAt: now,
    runningTurnId: turnId,
  };
}

/** A turn that never started, or ended without the backend's say-so. */
export function failTurn(
  thread: ChatThread,
  turnId: string,
  error: string,
  now: number = Date.now(),
): ChatThread {
  if (thread.runningTurnId !== turnId) return thread;
  return {
    ...thread,
    items: [
      ...thread.items,
      {
        type: "turnEnd",
        id: `${turnId}:end`,
        usage: null,
        costUsd: null,
        durationMs: null,
        error,
      },
    ],
    updatedAt: now,
    runningTurnId: null,
  };
}

function upsert(
  items: ChatItem[],
  id: string,
  update: (existing: ChatItem | undefined) => ChatItem,
): ChatItem[] {
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return [...items, update(undefined)];
  const next = items.slice();
  next[index] = update(items[index]);
  return next;
}

/**
 * Folds one backend event into the thread. Events for a turn other than the
 * running one are stale (a stopped turn's tail, a duplicate after reload)
 * and leave the thread untouched.
 */
export function applyChatEvent(
  thread: ChatThread,
  envelope: ChatEventEnvelope,
  now: number = Date.now(),
): ChatThread {
  if (envelope.threadId !== thread.id) return thread;
  if (thread.runningTurnId !== envelope.turnId) return thread;
  const { event } = envelope;
  const scoped = (itemId: string) => `${envelope.turnId}:${itemId}`;

  switch (event.kind) {
    case "started":
      return {
        ...thread,
        nativeSessionId: event.nativeSessionId ?? thread.nativeSessionId,
        reportedModel: event.model ?? thread.reportedModel,
        updatedAt: now,
      };
    case "textDelta":
      return {
        ...thread,
        items: upsert(thread.items, scoped(event.itemId), (existing) => ({
          type: "text",
          id: scoped(event.itemId),
          text:
            (existing?.type === "text" ? existing.text : "") + event.delta,
        })),
        updatedAt: now,
      };
    case "text":
      return {
        ...thread,
        items: upsert(thread.items, scoped(event.itemId), () => ({
          type: "text",
          id: scoped(event.itemId),
          text: event.text,
        })),
        updatedAt: now,
      };
    case "reasoning":
      return {
        ...thread,
        items: upsert(thread.items, scoped(event.itemId), () => ({
          type: "reasoning",
          id: scoped(event.itemId),
          text: event.text,
        })),
        updatedAt: now,
      };
    case "toolStarted":
      return {
        ...thread,
        items: upsert(thread.items, scoped(event.itemId), (existing) => ({
          type: "tool",
          id: scoped(event.itemId),
          name: event.name,
          summary: event.summary,
          output: existing?.type === "tool" ? existing.output : null,
          isError: existing?.type === "tool" ? existing.isError : false,
          done: existing?.type === "tool" ? existing.done : false,
        })),
        updatedAt: now,
      };
    case "toolFinished":
      return {
        ...thread,
        items: upsert(thread.items, scoped(event.itemId), (existing) => ({
          type: "tool",
          id: scoped(event.itemId),
          name:
            event.name ??
            (existing?.type === "tool" ? existing.name : "tool"),
          summary:
            event.summary ??
            (existing?.type === "tool" ? existing.summary : ""),
          output: event.output,
          isError: event.isError,
          done: true,
        })),
        updatedAt: now,
      };
    case "notice":
      return {
        ...thread,
        items: [
          ...thread.items,
          {
            type: "notice",
            id: `${envelope.turnId}:notice:${thread.items.length}`,
            text: event.message,
          },
        ],
        updatedAt: now,
      };
    case "approvalRequested":
      return {
        ...thread,
        items: [
          ...thread.items,
          {
            type: "approval",
            id: `${envelope.turnId}:approval:${event.requestId}`,
            requestId: event.requestId,
            name: event.name,
            summary: event.summary,
            input: event.input,
            decision: "pending",
          },
        ],
        updatedAt: now,
      };
    case "finished":
      return {
        ...thread,
        nativeSessionId: event.nativeSessionId ?? thread.nativeSessionId,
        items: [
          // An approval nobody answered can no longer be answered: the
          // process that asked is gone.
          ...thread.items.map(closePendingApproval),
          {
            type: "turnEnd",
            id: `${envelope.turnId}:end`,
            usage: event.usage,
            costUsd: event.costUsd,
            durationMs: event.durationMs,
            error: event.error,
          },
        ],
        updatedAt: now,
        runningTurnId: null,
      };
  }
}

function closePendingApproval(item: ChatItem): ChatItem {
  if (item.type !== "approval" || item.decision !== "pending") return item;
  return { ...item, decision: "closed" };
}

/** Records the user's answer to an approval card. */
export function decideApproval(
  thread: ChatThread,
  requestId: string,
  decision: "allowed" | "denied",
  now: number = Date.now(),
): ChatThread {
  return {
    ...thread,
    items: thread.items.map((item) =>
      item.type === "approval" &&
      item.requestId === requestId &&
      item.decision === "pending"
        ? { ...item, decision }
        : item,
    ),
    updatedAt: now,
  };
}

/** Whether a thread can still switch CLI: nothing has been said yet. */
export function threadIsFresh(thread: ChatThread): boolean {
  return thread.items.length === 0 && thread.nativeSessionId === null;
}

/**
 * Trims a thread to what storage keeps. Tool output is the bulk of a long
 * conversation and the CLI still has all of it, so it is cut hardest.
 */
export function boundThreadForStorage(thread: ChatThread): ChatThread {
  const items = thread.items.slice(-MAX_STORED_ITEMS).map((item) => {
    // A stored approval is never still answerable.
    if (item.type === "approval") return closePendingApproval(item);
    if (item.type !== "tool" || item.output === null) return item;
    if (item.output.length <= MAX_STORED_TOOL_OUTPUT) return item;
    return { ...item, output: `${item.output.slice(0, MAX_STORED_TOOL_OUTPUT)}…` };
  });
  return { ...thread, items, runningTurnId: null };
}

/**
 * The set of threads that fits the storage budget: newest first, dropped
 * from the oldest end until the serialised size is under the cap.
 */
export function boundThreadsForStorage(threads: ChatThread[]): ChatThread[] {
  const ordered = threads
    .map(boundThreadForStorage)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_STORED_THREADS);
  let total = 0;
  const kept: ChatThread[] = [];
  for (const thread of ordered) {
    const size = JSON.stringify(thread).length;
    if (total + size > MAX_STORED_BYTES) break;
    total += size;
    kept.push(thread);
  }
  return kept;
}

const STORAGE_KEY = "latticeterm.agentChat.v1";

function isThread(value: unknown): value is ChatThread {
  if (!value || typeof value !== "object") return false;
  const thread = value as Partial<ChatThread>;
  return (
    typeof thread.id === "string" &&
    (thread.definitionId === "claude" || thread.definitionId === "codex") &&
    typeof thread.workingDirectory === "string" &&
    chatPermissions.includes(thread.permission as ChatPermission) &&
    Array.isArray(thread.items)
  );
}

export function loadStoredThreads(storage: Pick<Storage, "getItem">): ChatThread[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isThread).map((thread) => ({
      ...thread,
      title: typeof thread.title === "string" ? thread.title : "",
      model: typeof thread.model === "string" ? thread.model : "",
      nativeSessionId:
        typeof thread.nativeSessionId === "string" ? thread.nativeSessionId : null,
      reportedModel:
        typeof thread.reportedModel === "string" ? thread.reportedModel : null,
      createdAt: typeof thread.createdAt === "number" ? thread.createdAt : 0,
      updatedAt: typeof thread.updatedAt === "number" ? thread.updatedAt : 0,
      // A turn cannot survive a reload: its process belonged to the window
      // that is gone.
      runningTurnId: null,
    }));
  } catch {
    return [];
  }
}

export function saveStoredThreads(
  storage: Pick<Storage, "setItem" | "removeItem">,
  threads: ChatThread[],
): void {
  try {
    const bounded = boundThreadsForStorage(threads);
    if (bounded.length === 0) {
      storage.removeItem(STORAGE_KEY);
      return;
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(bounded));
  } catch {
    // Storage full or unavailable: the conversation still works this
    // session, and the CLI keeps the transcript regardless.
  }
}

/** Compact token count for a footer: 12.3k rather than 12345. */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}
