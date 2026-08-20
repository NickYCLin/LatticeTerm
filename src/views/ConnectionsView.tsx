/**
 * Connections: the default area and the only one with live data.
 *
 * Rows are grouped, favorites float to the top, and the two empty states are
 * distinct — an empty workspace offers a way to start, while an empty result
 * offers a way back.
 */

import type { Workspace } from "../app/useWorkspace";
import type { SortOrder } from "../domain/query";
import { ConnectionRow } from "../components/connections/ConnectionRow";
import { EmptyState } from "../components/common/Callout";
import { ConnectionsIcon, ImportIcon, PlusIcon, SearchIcon } from "../components/icons";

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
    setFilter,
    selectedId,
    setSelectedId,
    duplicateProfile,
    toggleFavorite,
    loadSamples,
  } = workspace;

  if (profiles.length === 0) {
    return (
      <EmptyState
        icon={<ConnectionsIcon size={22} />}
        title="No connections yet"
        description="Add the first host you want to reach. LatticeTerm stores its name, address and organisation — never a password or a key."
        actions={
          <>
            <button type="button" className="button button--primary" onClick={onCreate}>
              <PlusIcon size={14} />
              Add connection
            </button>
            <button type="button" className="button button--ghost" onClick={loadSamples}>
              <ImportIcon size={14} />
              Load sample workspace
            </button>
          </>
        }
        footnote="Sample hosts use documentation-only names such as example.com and 192.0.2.0/24."
      />
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
            onClick={() =>
              setFilter({
                search: "",
                protocols: [],
                environments: [],
                tags: [],
                favoritesOnly: false,
                group: null,
              })
            }
          >
            Reset filters
          </button>
        }
      />
    );
  }

  return (
    <div className="connections">
      <div className="connections__toolbar">
        <p className="connections__count" aria-live="polite">
          {visibleProfiles.length}
          {filterActive ? ` of ${profiles.length}` : ""} connection
          {visibleProfiles.length === 1 ? "" : "s"}
        </p>

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
