import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  loadAgentActivity,
  markAgentActivityRead,
  reconcileAgentActivity,
  saveAgentActivity,
  snapshotAgentStates,
  type AgentActivityItem,
} from "./agentActivity";
import type {
  AgentBackendMode,
  AgentSessionSummary,
} from "./useAgentSessions";

export interface AgentActivityApi {
  items: AgentActivityItem[];
  unreadCount: number;
  markGroupRead: (groupId: string) => void;
  markAllRead: () => void;
  clear: () => void;
}

/** Keeps the actionable CLI activity feed in sync and across app restarts. */
export function useAgentActivity(
  sessions: readonly AgentSessionSummary[],
  mode: AgentBackendMode,
): AgentActivityApi {
  const [items, setItems] = useState<AgentActivityItem[]>(() =>
    loadAgentActivity(window.localStorage),
  );
  const previousStatesRef = useRef<ReturnType<typeof snapshotAgentStates> | null>(
    null,
  );
  const sessionSignature = sessions
    .map(
      (session) =>
        `${session.sessionId}\0${session.groupId}\0${session.groupLabel}\0${session.label}\0${session.workingDirectory}\0${session.state}`,
    )
    .join("\n");

  useEffect(() => {
    if (mode !== "ready") {
      previousStatesRef.current = null;
      return;
    }
    setItems((current) =>
      reconcileAgentActivity(
        current,
        sessions,
        previousStatesRef.current,
      ),
    );
    previousStatesRef.current = snapshotAgentStates(sessions);
    // The signature deliberately excludes token usage and process ids: neither
    // changes what appears in Activity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, sessionSignature]);

  useEffect(() => {
    try {
      saveAgentActivity(window.localStorage, items);
    } catch {
      // Activity is a convenience; full or unavailable WebView storage must
      // never interrupt a live terminal.
    }
  }, [items]);

  const markGroupRead = useCallback((groupId: string) => {
    setItems((current) => markAgentActivityRead(current, groupId));
  }, []);

  const markAllRead = useCallback(() => {
    setItems((current) => markAgentActivityRead(current));
  }, []);

  const clear = useCallback(() => setItems([]), []);
  const unreadCount = useMemo(
    () => items.filter((item) => item.unread).length,
    [items],
  );

  return { items, unreadCount, markGroupRead, markAllRead, clear };
}
