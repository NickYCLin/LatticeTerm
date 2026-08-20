/**
 * Activity entries for the current preview session.
 *
 * Only workspace bookkeeping is recorded: which profile changed and how.
 * Commands, output, credentials and fingerprints are never eligible, and the
 * log is in-memory, so closing the app clears it.
 */

export type ActivityKind = "created" | "updated" | "deleted" | "workspace";

export interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  message: string;
  detail?: string;
  /** Milliseconds since the epoch; formatted at render time. */
  at: number;
}

export const activityLabels: Record<ActivityKind, string> = {
  created: "Profile added",
  updated: "Profile updated",
  deleted: "Profile removed",
  workspace: "Workspace",
};

export function createActivityEntry(
  kind: ActivityKind,
  message: string,
  detail?: string,
  at: number = Date.now(),
  id: string = crypto.randomUUID(),
): ActivityEntry {
  return { id, kind, message, detail, at };
}

/** Newest first, capped so a long session cannot grow without bound. */
export function appendActivity(
  entries: ActivityEntry[],
  entry: ActivityEntry,
  limit = 200,
): ActivityEntry[] {
  return [entry, ...entries].slice(0, limit);
}
