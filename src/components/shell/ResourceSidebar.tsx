/**
 * Resource sidebar: search plus the facets that narrow the connection list.
 *
 * Facets are toggle buttons with `aria-pressed`, so their state is available
 * to assistive technology and not only to the eye.
 */

import { forwardRef } from "react";
import {
  environmentCatalog,
  protocolCatalog,
  type Environment,
  type Protocol,
} from "../../domain/connection";
import type { ConnectionFilter } from "../../domain/query";
import type { ConnectionGroup } from "../../domain/query";
import { ProtocolIcon } from "../common/Badge";
import { CloseIcon, SearchIcon, StarIcon } from "../icons";

function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value];
}

export const ResourceSidebar = forwardRef<
  HTMLInputElement,
  {
    filter: ConnectionFilter;
    onFilterChange: (filter: ConnectionFilter) => void;
    filterActive: boolean;
    groups: ConnectionGroup[];
    tags: string[];
    totalCount: number;
    favoriteCount: number;
    visibleCount: number;
  }
>(function ResourceSidebar(
  {
    filter,
    onFilterChange,
    filterActive,
    groups,
    tags,
    totalCount,
    favoriteCount,
    visibleCount,
  },
  searchRef,
) {
  const patch = (next: Partial<ConnectionFilter>) =>
    onFilterChange({ ...filter, ...next });

  return (
    <div className="sidebar">
      <div className="sidebar__search">
        <span className="sidebar__search-icon" aria-hidden="true">
          <SearchIcon />
        </span>
        <input
          ref={searchRef}
          type="search"
          value={filter.search}
          onChange={(event) => patch({ search: event.currentTarget.value })}
          placeholder="Search connections"
          aria-label="Search connections"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        {filter.search && (
          <button
            type="button"
            className="sidebar__search-clear"
            onClick={() => patch({ search: "" })}
            aria-label="Clear search"
          >
            <CloseIcon size={12} />
          </button>
        )}
      </div>

      <div className="sidebar__scroll">
        <section className="sidebar__section" aria-label="Views">
          <button
            type="button"
            className={`sidebar__row${
              !filter.favoritesOnly && filter.group === null ? " is-active" : ""
            }`}
            onClick={() => patch({ favoritesOnly: false, group: null })}
          >
            <span className="truncate">All connections</span>
            <span className="sidebar__count">{totalCount}</span>
          </button>
          <button
            type="button"
            className={`sidebar__row${filter.favoritesOnly ? " is-active" : ""}`}
            aria-pressed={filter.favoritesOnly}
            onClick={() => patch({ favoritesOnly: !filter.favoritesOnly })}
          >
            <span className="sidebar__row-icon">
              <StarIcon size={13} filled={filter.favoritesOnly} />
            </span>
            <span className="truncate">Favorites</span>
            <span className="sidebar__count">{favoriteCount}</span>
          </button>
        </section>

        {groups.length > 0 && (
          <section className="sidebar__section" aria-label="Groups">
            <h2 className="sidebar__heading eyebrow">Groups</h2>
            {groups.map((group) => (
              <button
                type="button"
                key={group.name}
                className={`sidebar__row${
                  filter.group === group.name ? " is-active" : ""
                }`}
                aria-pressed={filter.group === group.name}
                onClick={() =>
                  patch({
                    group: filter.group === group.name ? null : group.name,
                  })
                }
              >
                <span className="truncate">{group.name}</span>
                <span className="sidebar__count">{group.profiles.length}</span>
              </button>
            ))}
          </section>
        )}

        <section className="sidebar__section" aria-label="Protocols">
          <h2 className="sidebar__heading eyebrow">Protocols</h2>
          <div className="sidebar__chips">
            {protocolCatalog.map((protocol) => {
              const pressed = filter.protocols.includes(protocol.id);
              return (
                <button
                  type="button"
                  key={protocol.id}
                  className={`filter-chip protocol-${protocol.id}${
                    pressed ? " is-on" : ""
                  }`}
                  aria-pressed={pressed}
                  onClick={() =>
                    patch({
                      protocols: toggle<Protocol>(filter.protocols, protocol.id),
                    })
                  }
                >
                  <ProtocolIcon protocol={protocol.id} size={12} />
                  {protocol.name}
                </button>
              );
            })}
          </div>
        </section>

        <section className="sidebar__section" aria-label="Environments">
          <h2 className="sidebar__heading eyebrow">Environments</h2>
          <div className="sidebar__chips">
            {environmentCatalog.map((environment) => {
              const pressed = filter.environments.includes(environment.id);
              return (
                <button
                  type="button"
                  key={environment.id}
                  className={`filter-chip env-${environment.id}${
                    pressed ? " is-on" : ""
                  }`}
                  aria-pressed={pressed}
                  onClick={() =>
                    patch({
                      environments: toggle<Environment>(
                        filter.environments,
                        environment.id,
                      ),
                    })
                  }
                >
                  <span className="badge__dot" aria-hidden="true" />
                  {environment.label}
                </button>
              );
            })}
          </div>
        </section>

        {tags.length > 0 && (
          <section className="sidebar__section" aria-label="Tags">
            <h2 className="sidebar__heading eyebrow">Tags</h2>
            <div className="sidebar__chips">
              {tags.map((tag) => {
                const pressed = filter.tags.includes(tag);
                return (
                  <button
                    type="button"
                    key={tag}
                    className={`filter-chip${pressed ? " is-on" : ""}`}
                    aria-pressed={pressed}
                    onClick={() => patch({ tags: toggle(filter.tags, tag) })}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {filterActive && (
        <div className="sidebar__footer">
          <span className="sidebar__result" aria-live="polite">
            {visibleCount} of {totalCount} shown
          </span>
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={() =>
              onFilterChange({
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
        </div>
      )}
    </div>
  );
});
