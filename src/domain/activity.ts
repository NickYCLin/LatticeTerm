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

export const activityKindList: ActivityKind[] = [
  "created",
  "updated",
  "deleted",
  "workspace",
];

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

/** Filters activity entries by search term and kind. */
export function filterActivity(
  entries: ActivityEntry[],
  searchQuery: string,
  kindFilter: ActivityKind | "all" = "all",
): ActivityEntry[] {
  const query = searchQuery.trim().toLowerCase();

  return entries.filter((entry) => {
    if (kindFilter !== "all" && entry.kind !== kindFilter) {
      return false;
    }

    if (!query) return true;

    const label = activityLabels[entry.kind].toLowerCase();
    const message = entry.message.toLowerCase();
    const detail = (entry.detail ?? "").toLowerCase();

    return (
      label.includes(query) ||
      message.includes(query) ||
      detail.includes(query)
    );
  });
}

/**
 * Formats activity entries into a clean, human-readable plain text log.
 * Guaranteed to be free of credentials and secrets.
 */
export function exportActivityLogText(entries: ActivityEntry[]): string {
  const lines: string[] = [
    `# LatticeTerm Activity Log`,
    `# Exported At: ${new Date().toISOString()}`,
    `# Total Entries: ${entries.length}`,
    `# Note: In-memory session log only. No secrets or credentials are recorded.`,
    `--------------------------------------------------------------------------------`,
  ];

  for (const entry of entries) {
    const time = new Date(entry.at).toISOString();
    const kind = activityLabels[entry.kind].padEnd(16, " ");
    const detail = entry.detail ? ` (${entry.detail})` : "";
    lines.push(`[${time}] [${kind}] ${entry.message}${detail}`);
  }

  return lines.join("\n");
}

/**
 * Serializes activity entries to structured JSON format.
 */
export function exportActivityLogJson(entries: ActivityEntry[]): string {
  const data = {
    application: "LatticeTerm",
    exportedAt: new Date().toISOString(),
    totalEntries: entries.length,
    entries: entries.map((e) => ({
      id: e.id,
      kind: e.kind,
      kindLabel: activityLabels[e.kind],
      message: e.message,
      detail: e.detail ?? null,
      timestamp: new Date(e.at).toISOString(),
    })),
  };

  return JSON.stringify(data, null, 2);
}
