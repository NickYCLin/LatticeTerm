/**
 * Activity: what changed in this workspace session.
 *
 * Real entries, not a mock feed — every line was produced by something the
 * user did. Connection results will join this list once protocol engines
 * exist; commands, output and credentials never will.
 */

import { useState } from "react";
import { activityLabels } from "../domain/activity";
import type { Workspace } from "../app/useWorkspace";
import { Callout, EmptyState } from "../components/common/Callout";
import { ConfirmDialog } from "../components/overlays/ConfirmDialog";
import { ActivityIcon, TrashIcon } from "../components/icons";

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function ActivityView({ workspace }: { workspace: Workspace }) {
  const { activity, clearActivity } = workspace;
  const [confirming, setConfirming] = useState(false);

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
                {activity.length} entr{activity.length === 1 ? "y" : "ies"},
                newest first
              </p>
            </div>
            <button
              type="button"
              className="button button--ghost button--danger button--sm"
              onClick={() => setConfirming(true)}
            >
              <TrashIcon size={14} />
              Clear log
            </button>
          </header>

          <ul className="activity-list">
            {activity.map((entry) => (
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
