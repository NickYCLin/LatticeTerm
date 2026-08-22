export interface SessionIdentity {
  sessionId: string;
}

export interface SessionClosedNotice extends SessionIdentity {
  label: string;
  reason: string;
  at: number;
}

/**
 * Returns whether a closed pane owns the currently visible workspace tab.
 * Background terminal panes remain mounted, so their close callbacks must not
 * clear the user's selection while another session is active.
 */
export function shouldClearSessionSelection(
  activeSessionId: string,
  closedSessionId: string,
): boolean {
  return activeSessionId === closedSessionId;
}

/**
 * Builds the durable notice shown after a session pane has already unmounted.
 * The id fallback matters during initial hydration, where a close event can
 * arrive before the matching backend snapshot.
 */
export function createSessionClosedNotice<T extends SessionIdentity>(
  sessions: readonly T[],
  sessionId: string,
  reason: string,
  label: (session: T) => string,
  at = Date.now(),
): SessionClosedNotice {
  const session = sessions.find((entry) => entry.sessionId === sessionId);
  return {
    sessionId,
    label: session ? label(session) : sessionId,
    reason,
    at,
  };
}

/**
 * Reconciles a backend snapshot with events or connections that landed while
 * the snapshot request was in flight. Current entries win so a newer frame or
 * local connection is never replaced by an older snapshot, while sessions
 * observed closing during hydration cannot be resurrected.
 */
export function reconcileSessionSnapshot<T extends SessionIdentity>(
  current: T[],
  snapshot: T[],
  closedSessionIds: ReadonlySet<string> = new Set(),
): T[] {
  const reconciled = new Map<string, T>();

  for (const session of snapshot) {
    if (!closedSessionIds.has(session.sessionId)) {
      reconciled.set(session.sessionId, session);
    }
  }
  for (const session of current) {
    if (!closedSessionIds.has(session.sessionId)) {
      reconciled.set(session.sessionId, session);
    }
  }

  return [...reconciled.values()];
}

/**
 * Reconciles a singleton backend snapshot with status events or local actions
 * that completed while the snapshot request was in flight. A current value is
 * newer than the snapshot, while a close event must prevent the matching
 * snapshot value from being restored.
 */
export function reconcileSingletonSnapshot<T>(
  current: T | null,
  snapshot: T | null,
  identity: (value: T) => string,
  closedSessionIds: ReadonlySet<string> = new Set(),
): T | null {
  if (current && !closedSessionIds.has(identity(current))) return current;
  if (snapshot && !closedSessionIds.has(identity(snapshot))) return snapshot;
  return null;
}
