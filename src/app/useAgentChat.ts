/**
 * Chat threads with an agent CLI, kept in the WebView and driven by the
 * Rust chat runner.
 *
 * Threads persist in browser storage so a conversation can be picked up
 * after a restart: the CLI's own session id is what makes that work, and
 * the messages shown are a bounded local copy. A running turn never
 * survives a reload, because its process belonged to the window that went.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyChatEvent,
  beginTurn,
  createThread,
  failTurn,
  loadStoredThreads,
  saveStoredThreads,
  type ChatDefinitionId,
  type ChatEventEnvelope,
  type ChatPermission,
  type ChatThread,
} from "./agentChat";
import { hasDesktopBackend } from "./nativeRuntime";

async function core() {
  return import("@tauri-apps/api/core");
}

async function events() {
  return import("@tauri-apps/api/event");
}

const EVENT_CHAT = "agent-chat://event";
const SAVE_DELAY_MS = 400;
const FALLBACK_SUPPORTED: ChatDefinitionId[] = ["claude", "codex"];

export interface ChatThreadSettings {
  definitionId: ChatDefinitionId;
  workingDirectory: string;
  permission: ChatPermission;
  model: string;
}

export interface AgentChatApi {
  threads: ChatThread[];
  activeThreadId: string | null;
  setActiveThreadId: (id: string | null) => void;
  /** CLIs the backend can drive in chat mode. */
  supported: readonly ChatDefinitionId[];
  createThread: (settings: ChatThreadSettings) => ChatThread;
  updateThread: (id: string, patch: Partial<ChatThreadSettings>) => void;
  removeThread: (id: string) => void;
  send: (id: string, prompt: string) => Promise<void>;
  stop: (id: string) => Promise<void>;
}

export function useAgentChat(): AgentChatApi {
  const [threads, setThreads] = useState<ChatThread[]>(() =>
    typeof localStorage === "undefined" ? [] : loadStoredThreads(localStorage),
  );
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    () => threads[0]?.id ?? null,
  );
  const [supported, setSupported] = useState<ChatDefinitionId[]>(FALLBACK_SUPPORTED);
  const threadsRef = useRef(threads);
  threadsRef.current = threads;

  // Persist a little after the last change so a streaming reply does not
  // rewrite storage on every token.
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    const timer = setTimeout(() => saveStoredThreads(localStorage, threads), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [threads]);

  useEffect(() => {
    if (!hasDesktopBackend()) return;
    let disposed = false;
    let stop: (() => void) | null = null;

    (async () => {
      const [{ invoke }, { listen }] = await Promise.all([core(), events()]);
      invoke<string[]>("agent_chat_supported")
        .then((ids) => {
          if (disposed) return;
          const known = ids.filter(
            (id): id is ChatDefinitionId => id === "claude" || id === "codex",
          );
          if (known.length > 0) setSupported(known);
        })
        .catch(() => {
          // An older backend without chat mode: the fallback list stands and
          // sending reports the real reason.
        });
      const unlisten = await listen<ChatEventEnvelope>(EVENT_CHAT, (event) => {
        const envelope = event.payload;
        setThreads((current) =>
          current.map((thread) =>
            thread.id === envelope.threadId ? applyChatEvent(thread, envelope) : thread,
          ),
        );
      });
      if (disposed) unlisten();
      else stop = unlisten;
    })().catch(() => {
      // Without the event bridge a turn can still be started; its reply
      // would simply never arrive, and the send error explains why.
    });

    return () => {
      disposed = true;
      stop?.();
    };
  }, []);

  const create = useCallback((settings: ChatThreadSettings) => {
    const thread = createThread(settings);
    setThreads((current) => [thread, ...current]);
    setActiveThreadId(thread.id);
    return thread;
  }, []);

  const update = useCallback((id: string, patch: Partial<ChatThreadSettings>) => {
    setThreads((current) =>
      current.map((thread) => (thread.id === id ? { ...thread, ...patch } : thread)),
    );
  }, []);

  const remove = useCallback((id: string) => {
    const target = threadsRef.current.find((thread) => thread.id === id);
    if (target?.runningTurnId && hasDesktopBackend()) {
      core()
        .then(({ invoke }) => invoke("agent_chat_stop", { threadId: id }))
        .catch(() => {});
    }
    setThreads((current) => current.filter((thread) => thread.id !== id));
    setActiveThreadId((current) => {
      if (current !== id) return current;
      const remaining = threadsRef.current.filter((thread) => thread.id !== id);
      return remaining[0]?.id ?? null;
    });
  }, []);

  const send = useCallback(async (id: string, prompt: string) => {
    const thread = threadsRef.current.find((entry) => entry.id === id);
    if (!thread || thread.runningTurnId) return;
    const turnId = crypto.randomUUID();
    setThreads((current) =>
      current.map((entry) => (entry.id === id ? beginTurn(entry, prompt, turnId) : entry)),
    );
    try {
      const { invoke } = await core();
      await invoke("agent_chat_send", {
        request: {
          threadId: thread.id,
          turnId,
          definitionId: thread.definitionId,
          workingDirectory: thread.workingDirectory,
          prompt,
          permission: thread.permission,
          model: thread.model.trim() || null,
          nativeSessionId: thread.nativeSessionId,
        },
      });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setThreads((current) =>
        current.map((entry) => (entry.id === id ? failTurn(entry, turnId, message) : entry)),
      );
    }
  }, []);

  const stopTurn = useCallback(async (id: string) => {
    const { invoke } = await core();
    await invoke<boolean>("agent_chat_stop", { threadId: id });
  }, []);

  return useMemo(
    () => ({
      threads,
      activeThreadId,
      setActiveThreadId,
      supported,
      createThread: create,
      updateThread: update,
      removeThread: remove,
      send,
      stop: stopTurn,
    }),
    [threads, activeThreadId, supported, create, update, remove, send, stopTurn],
  );
}
