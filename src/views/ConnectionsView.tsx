/**
 * Connections: the default area and the only one with live data.
 *
 * Rows are grouped, favorites float to the top, and the two empty states are
 * distinct — an empty workspace offers a way to start, while an empty result
 * offers a way back.
 */

import { useRef, useState, type ChangeEvent } from "react";
import type { Workspace } from "../app/useWorkspace";
import type { SortOrder } from "../domain/query";
import { ConnectionRow } from "../components/connections/ConnectionRow";
import { Callout, EmptyState } from "../components/common/Callout";
import {
  ConnectionsIcon,
  ExportIcon,
  ImportIcon,
  PlusIcon,
  SearchIcon,
} from "../components/icons";
import { parseAndValidateImport, serializeProfiles } from "../domain/export";

const sortLabels: Record<SortOrder, string> = {
  name: "Name",
  hostname: "Hostname",
  environment: "Environment",
};

export function ConnectionsView({
  workspace,
  onCreate,
  onEdit,
  onDelete,
}: {
  workspace: Workspace;
  onCreate: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
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
  const [importNotice, setImportNotice] = useState<{
    tone: "info" | "warn";
    title: string;
    message: string;
  } | null>(null);

  function triggerImport() {
    fileInputRef.current?.click();
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = String(e.target?.result ?? "");
      const result = parseAndValidateImport(content);

      if (result.validProfiles.length > 0) {
        const count = importProfiles(result.validProfiles);
        if (result.errors.length > 0) {
          setImportNotice({
            tone: "warn",
            title: `Imported ${count} profiles with notices`,
            message: `${result.errors.join(" ")} (${result.skippedCount} invalid entries skipped).`,
          });
        } else {
          setImportNotice({
            tone: "info",
            title: `Import successful`,
            message: `Successfully imported ${count} connection profiles.`,
          });
        }
      } else {
        setImportNotice({
          tone: "warn",
          title: "Import failed",
          message:
            result.errors.length > 0
              ? result.errors.join(" ")
              : "No valid connection profiles found in file.",
        });
      }
    };
    reader.readAsText(file);
    // Reset file input so same file can be re-selected if desired
    event.target.value = "";
  }

  function handleExport() {
    if (profiles.length === 0) return;
    const json = serializeProfiles(profiles);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `latticeterm-connections-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  if (profiles.length === 0) {
    return (
      <div className="stack">
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: "none" }}
          onChange={handleFileChange}
          aria-hidden="true"
        />

        {importNotice && (
          <Callout tone={importNotice.tone} title={importNotice.title}>
            {importNotice.message}
          </Callout>
        )}

        <EmptyState
          icon={<ConnectionsIcon size={22} />}
          title="No connections yet"
          description="Add the first host you want to reach, load documentation samples, or import a previously exported non-secret JSON backup."
          actions={
            <>
              <button
                type="button"
                className="button button--primary"
                onClick={onCreate}
              >
                <PlusIcon size={14} />
                Add connection
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={loadSamples}
              >
                <ImportIcon size={14} />
                Load sample workspace
              </button>
              <button
                type="button"
                className="button button--secondary"
                onClick={triggerImport}
              >
                <ImportIcon size={14} />
                Import JSON
              </button>
            </>
          }
          footnote="LatticeTerm only stores non-secret metadata (hostname, protocol, tags). Secrets are never exported or accepted."
        />
      </div>
    );
  }

  if (visibleProfiles.length === 0) {
    return (
      <EmptyState
        icon={<SearchIcon size={22} />}
        title="No connections match this filter"
        description="Every host is still here — the current search and facets simply exclude them all."
        actions={
          <button
            type="button"
            className="button button--secondary"
            onClick={resetFilter}
          >
            Reset filters
          </button>
        }
      />
    );
  }

  return (
    <div className="connections">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: "none" }}
        onChange={handleFileChange}
        aria-hidden="true"
      />

      {importNotice && (
        <Callout tone={importNotice.tone} title={importNotice.title}>
          {importNotice.message}
        </Callout>
      )}

      <div className="connections__toolbar">
        <p className="connections__count" aria-live="polite">
          {visibleProfiles.length}
          {filterActive ? ` of ${profiles.length}` : ""} connection
          {visibleProfiles.length === 1 ? "" : "s"}
        </p>

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <label className="select">
            <span className="select__label">Sort by</span>
            <select
              value={sortOrder}
              onChange={(event) =>
                setSortOrder(event.currentTarget.value as SortOrder)
              }
            >
              {Object.entries(sortLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={triggerImport}
            title="Import connection profiles from JSON"
          >
            <ImportIcon size={14} />
            Import
          </button>

          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={handleExport}
            title="Export connection profiles as non-secret JSON"
          >
            <ExportIcon size={14} />
            Export
          </button>
        </div>
      </div>

      <div className="connections__scroll">
        {visibleGroups.map((group) => (
          <section className="connection-group" key={group.name}>
            <h2 className="connection-group__title">
              <span className="eyebrow">{group.name}</span>
              <span className="connection-group__count">
                {group.profiles.length}
              </span>
            </h2>
            <ul className="connection-list">
              {group.profiles.map((profile) => (
                <ConnectionRow
                  key={profile.id}
                  profile={profile}
                  selected={profile.id === selectedId}
                  onSelect={() =>
                    setSelectedId(profile.id === selectedId ? null : profile.id)
                  }
                  onEdit={() => onEdit(profile.id)}
                  onDuplicate={() => duplicateProfile(profile.id)}
                  onDelete={() => onDelete(profile.id)}
                  onToggleFavorite={() => toggleFavorite(profile.id)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
