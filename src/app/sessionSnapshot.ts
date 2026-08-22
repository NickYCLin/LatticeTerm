export interface SessionIdentity {
  sessionId: string;
}

export interface SessionClosedNotice extends SessionIdentity {
  label: string;
  reason: string;
  at: number;
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
