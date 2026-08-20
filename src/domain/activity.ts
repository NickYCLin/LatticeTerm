/**
 * Activity entries for the current session.
 *
 * Only workspace bookkeeping is recorded: which entry changed and how.
 * Commands, output, credentials and fingerprints are never eligible, and the
 * log is in memory, so closing the app clears it.
 *
 * Entries hold data and message keys, never rendered sentences, so the same
 * log reads correctly after the user switches language.
 */

import type { MessageKey } from "../i18n/messages/zh-TW";

export type ActivityKind = "created" | "updated" | "deleted" | "workspace";

export interface TranslatableNote {
  key: MessageKey;
  values?: Record<string, string | number>;
}

export interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  /** Milliseconds since the epoch; formatted at render time. */
  at: number;
  /** User data, such as a connection name. Shown as typed. */
  subject?: string;
  /** Used when the headline is our own wording rather than user data. */
  titleKey?: MessageKey;
  /** Literal data detail, such as `user@host:port`. */
  detail?: string;
  /** Detail that is our wording and therefore needs translating. */
  note?: TranslatableNote;
}

export const activityKindList: ActivityKind[] = [
  "created",
  "updated",
  "deleted",
  "workspace",
];

export function activityKindLabelKey(kind: ActivityKind): MessageKey {
  return `activity.kind.${kind}` as MessageKey;
}

export function createActivityEntry(
  entry: Omit<ActivityEntry, "id" | "at">,
  at: number = Date.now(),
  id: string = crypto.randomUUID(),
): ActivityEntry {
  return { ...entry, id, at };
}

/** Newest first, capped so a long session cannot grow without bound. */
export function appendActivity(
  entries: ActivityEntry[],
  entry: ActivityEntry,
  limit = 200,
): ActivityEntry[] {
  return [entry, ...entries].slice(0, limit);
}

/**
 * Filters by kind and by free text. The caller supplies the rendered text for
 * an entry, so search matches what is actually on screen in the current
 * language rather than an internal key.
 */
export function filterActivity(
  entries: ActivityEntry[],
  searchQuery: string,
  kindFilter: ActivityKind | "all",
  renderText: (entry: ActivityEntry) => string,
): ActivityEntry[] {
  const query = searchQuery.trim().toLowerCase();

  return entries.filter((entry) => {
    if (kindFilter !== "all" && entry.kind !== kindFilter) return false;
    if (!query) return true;
    return renderText(entry).toLowerCase().includes(query);
  });
}

/**
 * Plain-text log for export. The caller renders each entry, keeping this
 * function free of both display text and language decisions.
 */
export function exportActivityLogText(
  entries: ActivityEntry[],
  renderLine: (entry: ActivityEntry) => string,
  exportedAt: string = new Date().toISOString(),
): string {
  const lines = [
    "# LatticeTerm activity log",
    `# Exported at: ${exportedAt}`,
    `# Entries: ${entries.length}`,
    "# In-memory session log. No credentials or command output are recorded.",
    "-".repeat(72),
  ];

  for (const entry of entries) {
    lines.push(`[${new Date(entry.at).toISOString()}] ${renderLine(entry)}`);
  }

  return lines.join("\n");
}
