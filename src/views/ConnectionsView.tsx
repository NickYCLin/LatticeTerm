/**
 * Connections: the default area and the only one with live data.
 *
 * Cards are grouped, favorites float to the top, and the two empty states are
 * distinct — an empty workspace offers a way to start, an empty result offers
 * a way back.
 */

import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { Workspace } from "../app/useWorkspace";
import {
  UNGROUPED,
  isProtocolAvailable,
  type ConnectionProfile,
} from "../domain/connection";
import type { SortOrder } from "../domain/query";
import { parseAndValidateImport, serializeProfiles } from "../domain/export";
import type { ImportIssue } from "../domain/export";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n";
import { ConnectionCard } from "../components/connections/ConnectionCard";
import { Callout, EmptyState } from "../components/common/Callout";
import {
  ConnectionsIcon,
  ExportIcon,
  ImportIcon,
  PlusIcon,
  SearchIcon,
} from "../components/icons";

const sortKeys: Record<SortOrder, MessageKey> = {
  name: "connections.sort.name",
  hostname: "connections.sort.hostname",
  environment: "connections.sort.environment",
};

interface Notice {
  tone: "info" | "warn";
  title: string;
  body: string;
}

function timestamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Triggers a download without leaving the app or touching the filesystem API. */
function downloadFile(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ConnectionsView({
  workspace,
  onCreate,
  onEdit,
  onDelete,
  onConnect,
}: {
  workspace: Workspace;
  onCreate: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onConnect: (profile: ConnectionProfile) => void;
}) {
  const { t } = useI18n();
  const {
    profiles,
    visibleGroups,
    visibleProfiles,
    filterActive,
    sortOrder,
    setSortOrder,
    resetFilter,
    selectedId,
    setSelectedId,
    duplicateProfile,
    toggleFavorite,
    loadSamples,
    importProfiles,
  } = workspace;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  /** Renders one import problem, including its field-level reasons. */
  function describeIssue(issue: ImportIssue): string {
    const reasons = (issue.fieldIssues ?? [])
      .map((field) => t(field.key, field.values))
      .join(" ");
    return t(issue.key, {
      ...(issue.values ?? {}),
      name: String(issue.values?.name ?? t("transfer.unnamed")),
      reasons,
    });
  }

  async function handleLoadSamples() {
    const result = await loadSamples();
    if (result.error) {
      setNotice({
        tone: "warn",
        title: t("connections.samplesFailed"),
        body: t("connections.samplesFailedBody", { error: result.error }),
      });
    }
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const result = parseAndValidateImport(String(reader.result ?? ""));

      if (result.validProfiles.length === 0) {
        setNotice({
          tone: "warn",
          title: t("transfer.import.failed"),
          body:
            result.issues.length > 0
              ? result.issues.map(describeIssue).join(" ")
              : t("transfer.import.failedBody"),
        });
        return;
      }

      const imported = await importProfiles(result.validProfiles);
      if (imported.error) {
        setNotice({
          tone: "warn",
          title: t("transfer.import.failed"),
          body: t("transfer.import.persistFailedBody", {
            error: imported.error,
          }),
        });
        return;
      }

      setNotice(
        result.issues.length > 0
          ? {
              tone: "warn",
              title: t("transfer.import.partial"),
              body: t("transfer.import.partialBody", {
                errors: result.issues.map(describeIssue).join(" "),
                skipped: result.skippedCount,
              }),
            }
          : {
              tone: "info",
              title: t("transfer.import.success"),
              body: t("transfer.import.successBody", {
                count: imported.count,
              }),
            },
      );
    };
    reader.onerror = () => {
      setNotice({
        tone: "warn",
        title: t("transfer.import.failed"),
        body: t("transfer.import.readFailedBody"),
      });
    };
    reader.readAsText(file);
  }

  const filePicker = (
    <input
      ref={fileInputRef}
      type="file"
      accept=".json,application/json"
      className="visually-hidden"
      onChange={handleFile}
      tabIndex={-1}
    />
  );

  if (profiles.length === 0) {
    return (
      <div className="connections">
        {filePicker}
        <div style={{ padding: "var(--space-5) var(--space-6) 0" }}>
          {notice && (
            <Callout tone={notice.tone} title={notice.title}>
              {notice.body}
            </Callout>
          )}
        </div>
        <EmptyState
          icon={<ConnectionsIcon size={26} />}
          title={t("connections.empty.title")}
          description={t("connections.empty.body")}
          actions={
            <>
              <button
                type="button"
                className="button button--primary"
                onClick={onCreate}
              >
                <PlusIcon size={15} />
                {t("connections.add")}
              </button>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => void handleLoadSamples()}
              >
                {t("connections.loadSamples")}
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => fileInputRef.current?.click()}
              >
                <ImportIcon size={15} />
                {t("connections.importJson")}
              </button>
            </>
          }
          footnote={t("connections.empty.footnote")}
        />
      </div>
    );
  }

  return (
    <div className="connections">
      {filePicker}

      <div className="connections__toolbar">
        <p className="connections__count" aria-live="polite">
          {filterActive
            ? t("connections.countFiltered", {
                visible: visibleProfiles.length,
                total: profiles.length,
              })
            : t("connections.count", { count: profiles.length })}
        </p>

        <div className="connections__tools">
          <label className="select">
            <span className="select__label">{t("connections.sortBy")}</span>
            <select
              value={sortOrder}
              onChange={(event) =>
                setSortOrder(event.currentTarget.value as SortOrder)
              }
            >
              {(Object.keys(sortKeys) as SortOrder[]).map((value) => (
                <option key={value} value={value}>
                  {t(sortKeys[value])}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <ImportIcon size={14} />
            {t("common.import")}
          </button>
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={() =>
              downloadFile(
                serializeProfiles(profiles),
                `latticeterm-connections-${timestamp()}.json`,
                "application/json",
              )
            }
            title={t("transfer.export.hint")}
          >
            <ExportIcon size={14} />
            {t("common.export")}
          </button>
        </div>
      </div>

      <div className="connections__scroll">
        {notice && (
          <div style={{ marginBottom: "var(--space-4)" }}>
            <Callout tone={notice.tone} title={notice.title}>
              {notice.body}
            </Callout>
          </div>
        )}

        {visibleProfiles.length === 0 ? (
          <EmptyState
            icon={<SearchIcon size={26} />}
            title={t("connections.noResults.title")}
            description={t("connections.noResults.body")}
            actions={
              <button
                type="button"
                className="button button--secondary"
                onClick={resetFilter}
              >
                {t("connections.resetFilters")}
              </button>
            }
          />
        ) : (
          visibleGroups.map((group) => (
            <section className="connection-group" key={group.name}>
              <h2 className="connection-group__title">
                <span className="eyebrow">
                  {group.name === UNGROUPED
                    ? t("connections.ungrouped")
                    : group.name}
                </span>
                <span className="connection-group__count">
                  {group.profiles.length}
                </span>
              </h2>
              <ul className="connection-grid">
                {group.profiles.map((profile) => (
                  <ConnectionCard
                    key={profile.id}
                    profile={profile}
                    selected={profile.id === selectedId}
                    onSelect={() =>
                      setSelectedId(
                        profile.id === selectedId ? null : profile.id,
                      )
                    }
                    onEdit={() => onEdit(profile.id)}
                    onDuplicate={() => duplicateProfile(profile.id)}
                    onDelete={() => onDelete(profile.id)}
                    onToggleFavorite={() => toggleFavorite(profile.id)}
                    onConnect={
                      isProtocolAvailable(profile.protocol)
                        ? () => onConnect(profile)
                        : undefined
                    }
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
