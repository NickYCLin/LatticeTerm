export interface SessionIdentity {
  sessionId: string;
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
