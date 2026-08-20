/**
 * Activity: what changed in this workspace session.
 *
 * Real entries, not a mock feed — every line was produced by something the
 * user did. Connection results will join this list once protocol engines
 * exist; commands, output and credentials never will.
 */

import { useMemo, useState } from "react";
import {
  activityLabels,
  exportActivityLogText,
  filterActivity,
  type ActivityKind,
} from "../domain/activity";
import type { Workspace } from "../app/useWorkspace";
import { Callout, EmptyState } from "../components/common/Callout";
import { ConfirmDialog } from "../components/overlays/ConfirmDialog";
import {
  ActivityIcon,
  ExportIcon,
  SearchIcon,
  TrashIcon,
} from "../components/icons";

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const kindFilterOptions: { value: ActivityKind | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "created", label: "Added" },
  { value: "updated", label: "Updated" },
  { value: "deleted", label: "Removed" },
  { value: "workspace", label: "Workspace" },
];

export function ActivityView({ workspace }: { workspace: Workspace }) {
  const { activity, clearActivity } = workspace;
  const [confirming, setConfirming] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<ActivityKind | "all">("all");

  const filteredEntries = useMemo(
    () => filterActivity(activity, searchQuery, kindFilter),
    [activity, searchQuery, kindFilter],
  );

  function handleExportLog() {
    if (activity.length === 0) return;
    const text = exportActivityLogText(activity);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `latticeterm-activity-${new Date().toISOString().slice(0, 10)}.log`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="stack">
      <Callout tone="info" title="Session log only">
        These entries describe changes to connection profiles in this window.
        They are held in memory, contain no credentials or command output, and
        disappear when LatticeTerm closes. Connection results and failure stages
        join this view when the SSH engine lands in milestone 1.
      </Callout>

      {activity.length === 0 ? (
        <EmptyState
          icon={<ActivityIcon size={22} />}
          title="Nothing has happened yet"
          description="Add, edit or remove a connection and it will be recorded here with a timestamp."
        />
      ) : (
        <section className="panel">
          <header className="panel__head">
            <div>
              <h2 className="panel__title">Session activity</h2>
              <p className="panel__hint">
                {filteredEntries.length} of {activity.length} entr
                {activity.length === 1 ? "y" : "ies"}, newest first
              </p>
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                className="button button--ghost button--sm"
                onClick={handleExportLog}
                title="Export session activity log as text file"
              >
                <ExportIcon size={14} />
                Export log
              </button>
              <button
                type="button"
                className="button button--ghost button--danger button--sm"
                onClick={() => setConfirming(true)}
              >
                <TrashIcon size={14} />
                Clear log
              </button>
            </div>
          </header>

          <div
            style={{
              padding: "0.75rem 1rem",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              flexWrap: "wrap",
              gap: "0.75rem",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                flex: "1 1 200px",
                maxWidth: "320px",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  left: "0.5rem",
                  color: "var(--text-faint)",
                  display: "flex",
                }}
                aria-hidden="true"
              >
                <SearchIcon size={14} />
              </span>
              <input
                className="input"
                style={{ paddingLeft: "1.75rem", height: "1.75rem", fontSize: "0.8125rem" }}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search activity..."
                aria-label="Search activity"
              />
            </div>

            <div
              className="segmented"
              role="radiogroup"
              aria-label="Filter activity by kind"
            >
              {kindFilterOptions.map((opt) => (
                <button
                  type="button"
                  key={opt.value}
                  role="radio"
                  aria-checked={kindFilter === opt.value}
                  className={`segmented__option${
                    kindFilter === opt.value ? " is-selected" : ""
                  }`}
                  onClick={() => setKindFilter(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {filteredEntries.length === 0 ? (
            <div style={{ padding: "2rem", textAlign: "center" }}>
              <p style={{ color: "var(--text-muted)", marginBottom: "0.75rem" }}>
                No activity entries match your filter.
              </p>
              <button
                type="button"
                className="button button--secondary button--sm"
                onClick={() => {
                  setSearchQuery("");
                  setKindFilter("all");
                }}
              >
                Reset activity filter
              </button>
            </div>
          ) : (
            <ul className="activity-list">
              {filteredEntries.map((entry) => (
                <li className="activity-row" key={entry.id}>
                  <span className={`activity-row__kind kind-${entry.kind}`}>
                    {activityLabels[entry.kind]}
                  </span>
                  <span className="activity-row__message truncate">
                    {entry.message}
                  </span>
                  {entry.detail && (
                    <span className="activity-row__detail mono truncate">
                      {entry.detail}
                    </span>
                  )}
                  <time className="activity-row__time mono">
                    {timeFormat.format(entry.at)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {confirming && (
        <ConfirmDialog
          title="Clear the session log?"
          body={`This removes all ${activity.length} entries from this window. Connection profiles are not affected.`}
          confirmLabel={`Clear ${activity.length} entries`}
          onConfirm={() => {
            clearActivity();
            setConfirming(false);
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
