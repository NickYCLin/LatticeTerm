/**
 * Activity: what changed while this window has been open.
 *
 * Real entries, not a mock feed — every line came from something the user did.
 * Connection results will join this list once sessions exist; commands, output
 * and credentials never will.
 */

import { useMemo, useState } from "react";
import type { Workspace } from "../app/useWorkspace";
import {
  activityKindLabelKey,
  activityKindList,
  exportActivityLogText,
  filterActivity,
  type ActivityEntry,
  type ActivityKind,
} from "../domain/activity";
import { useI18n } from "../i18n/context";
import { Callout, EmptyState } from "../components/common/Callout";
import { ConfirmDialog } from "../components/overlays/ConfirmDialog";
import { ActivityIcon, ExportIcon, SearchIcon, TrashIcon } from "../components/icons";
import { moveRadioGroupFocus } from "../components/overlays/radioNavigation";

const activityFilterChoices: readonly (ActivityKind | "all")[] = [
  "all",
  ...activityKindList,
];

export function ActivityView({ workspace }: { workspace: Workspace }) {
  const { t, tag } = useI18n();
  const { activity, clearActivity } = workspace;
  const [confirming, setConfirming] = useState(false);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<ActivityKind | "all">("all");

  const timeFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(tag, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    [tag],
  );

  /** Headline for an entry: user data if there is any, otherwise our wording. */
  const title = (entry: ActivityEntry) =>
    entry.subject ?? (entry.titleKey ? t(entry.titleKey) : "");

  const detail = (entry: ActivityEntry) =>
    entry.detail ?? (entry.note ? t(entry.note.key, entry.note.values) : "");

  const searchText = (entry: ActivityEntry) =>
    `${t(activityKindLabelKey(entry.kind))} ${title(entry)} ${detail(entry)}`;

  const visible = useMemo(
    () => filterActivity(activity, search, kind, searchText),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activity, search, kind, t],
  );

  const filtering = search.trim() !== "" || kind !== "all";

  if (activity.length === 0) {
    return (
      <div className="stack">
        <Callout tone="info" title={t("activity.note.title")}>
          {t("activity.note.body")}
        </Callout>
        <EmptyState
          icon={<ActivityIcon size={26} />}
          title={t("activity.empty.title")}
          description={t("activity.empty.body")}
        />
      </div>
    );
  }

  return (
    <div className="stack">
      <Callout tone="info" title={t("activity.note.title")}>
        {t("activity.note.body")}
      </Callout>

      <section className="panel glass glass--sheen">
        <header className="panel__head">
          <div>
            <h2 className="panel__title">{t("activity.title")}</h2>
            <p className="panel__hint">
              {filtering
                ? t("activity.countFiltered", {
                    visible: visible.length,
                    total: activity.length,
                  })
                : t("activity.count", { count: activity.length })}
            </p>
          </div>
          <div className="panel__actions">
            <button
              type="button"
              className="button button--ghost button--sm"
              onClick={() =>
                exportLog(
                  exportActivityLogText(
                    activity,
                    (entry) =>
                      `[${t(activityKindLabelKey(entry.kind))}] ${title(entry)}${
                        detail(entry) ? ` (${detail(entry)})` : ""
                      }`,
                  ),
                )
              }
            >
              <ExportIcon size={14} />
              {t("activity.export")}
            </button>
            <button
              type="button"
              className="button button--ghost button--danger button--sm"
              onClick={() => setConfirming(true)}
            >
              <TrashIcon size={14} />
              {t("activity.clear")}
            </button>
          </div>
        </header>

        <div className="activity-toolbar">
          <label className="activity-search">
            <SearchIcon size={14} />
            <input
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder={t("activity.searchPlaceholder")}
              aria-label={t("activity.searchPlaceholder")}
            />
          </label>

          <div
            className="segmented"
            role="radiogroup"
            aria-label={t("activity.title")}
          >
            {activityFilterChoices.map((value, index) => (
              <button
                type="button"
                key={value}
                role="radio"
                aria-checked={kind === value}
                tabIndex={kind === value ? 0 : -1}
                className={`segmented__option${kind === value ? " is-selected" : ""}`}
                onClick={() => setKind(value)}
                onKeyDown={(event) =>
                  moveRadioGroupFocus(event, index, (nextIndex) =>
                    setKind(activityFilterChoices[nextIndex]),
                  )
                }
              >
                {value === "all"
                  ? t("activity.filter.all")
                  : t(activityKindLabelKey(value))}
              </button>
            ))}
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="activity-empty">
            <p>{t("activity.noMatch")}</p>
            <button
              type="button"
              className="button button--secondary button--sm"
              onClick={() => {
                setSearch("");
                setKind("all");
              }}
            >
              {t("activity.resetFilter")}
            </button>
          </div>
        ) : (
          <ul className="activity-list">
            {visible.map((entry) => (
              <li className="activity-row" key={entry.id}>
                <span className={`activity-row__kind kind-${entry.kind}`}>
                  {t(activityKindLabelKey(entry.kind))}
                </span>
                <span className="activity-row__message truncate">
                  {title(entry)}
                </span>
                <span className="activity-row__detail mono truncate">
                  {detail(entry)}
                </span>
                <time className="activity-row__time mono">
                  {timeFormat.format(entry.at)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>

      {confirming && (
        <ConfirmDialog
          title={t("activity.confirmClear.title")}
          body={t("activity.confirmClear.body", { count: activity.length })}
          confirmLabel={t("activity.confirmClear.confirm", {
            count: activity.length,
          })}
          cancelLabel={t("common.cancel")}
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

function exportLog(content: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/plain;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `latticeterm-activity-${new Date().toISOString().slice(0, 10)}.log`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
