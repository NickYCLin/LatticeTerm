/**
 * Workspace state: the connection collection, the activity log and the filter
 * the connections view renders from.
 *
 * Entries live in memory for this foundation build. Persistence waits for the
 * encrypted local store, so nothing here writes connection data to disk.
 */

import { useCallback, useMemo, useState } from "react";
import {
  appendActivity,
  createActivityEntry,
  type ActivityEntry,
} from "../domain/activity";
import {
  connectionTarget,
  createConnectionProfile,
  findProtocol,
  type ConnectionDraft,
  type ConnectionProfile,
} from "../domain/connection";
import {
  collectTags,
  emptyFilter,
  filterProfiles,
  groupProfiles,
  isFilterActive,
  sortProfiles,
  type ConnectionFilter,
  type SortOrder,
} from "../domain/query";
import { sampleProfiles } from "../domain/samples";

/** `SSH · operator@host:22`, the line shown beside an activity entry. */
function describe(profile: ConnectionProfile): string {
  return `${findProtocol(profile.protocol).acronym} · ${connectionTarget(profile)}`;
}

export function useWorkspace() {
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [filter, setFilter] = useState<ConnectionFilter>(emptyFilter);
  const [sortOrder, setSortOrder] = useState<SortOrder>("name");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const record = useCallback((entry: Omit<ActivityEntry, "id" | "at">) => {
    setActivity((entries) => appendActivity(entries, createActivityEntry(entry)));
  }, []);

  const addProfile = useCallback(
    (draft: ConnectionDraft): ConnectionProfile => {
      const profile = createConnectionProfile(draft);
      setProfiles((current) => [...current, profile]);
      setSelectedId(profile.id);
      record({ kind: "created", subject: profile.name, detail: describe(profile) });
      return profile;
    },
    [record],
  );

  const updateProfile = useCallback(
    (id: string, draft: ConnectionDraft): ConnectionProfile => {
      const profile = createConnectionProfile(draft, id);
      setProfiles((current) =>
        current.map((entry) => (entry.id === id ? profile : entry)),
      );
      record({ kind: "updated", subject: profile.name, detail: describe(profile) });
      return profile;
    },
    [record],
  );

  const duplicateProfile = useCallback(
    (id: string): ConnectionProfile | undefined => {
      const source = profiles.find((entry) => entry.id === id);
      if (!source) return undefined;

      const copy = createConnectionProfile({
        ...source,
        name: `${source.name} (2)`,
        favorite: false,
      });

      setProfiles((current) => [...current, copy]);
      setSelectedId(copy.id);
      record({
        kind: "created",
        subject: copy.name,
        note: { key: "activity.duplicatedFrom", values: { name: source.name } },
      });
      return copy;
    },
    [profiles, record],
  );

  const removeProfile = useCallback(
    (id: string): void => {
      const target = profiles.find((entry) => entry.id === id);
      setProfiles((current) => current.filter((entry) => entry.id !== id));
      setSelectedId((current) => (current === id ? null : current));
      if (target) {
        record({
          kind: "deleted",
          subject: target.name,
          detail: connectionTarget(target),
        });
      }
    },
    [profiles, record],
  );

  const toggleFavorite = useCallback((id: string): void => {
    setProfiles((current) =>
      current.map((entry) =>
        entry.id === id ? { ...entry, favorite: !entry.favorite } : entry,
      ),
    );
  }, []);

  const loadSamples = useCallback((): void => {
    setProfiles(sampleProfiles.map((profile) => ({ ...profile })));
    setSelectedId(sampleProfiles[0]?.id ?? null);
    record({
      kind: "workspace",
      titleKey: "activity.samplesLoaded",
      note: {
        key: "activity.samplesDetail",
        values: { count: sampleProfiles.length },
      },
    });
  }, [record]);

  /** Imported entries are appended; nothing already in the workspace is lost. */
  const importProfiles = useCallback(
    (imported: ConnectionProfile[]): number => {
      if (imported.length === 0) return 0;

      setProfiles((current) => [...current, ...imported]);
      setSelectedId((current) => current ?? imported[0].id);

      for (const profile of imported) {
        record({
          kind: "created",
          subject: profile.name,
          detail: describe(profile),
        });
      }

      return imported.length;
    },
    [record],
  );

  const resetFilter = useCallback((): void => setFilter(emptyFilter), []);

  const clearActivity = useCallback((): void => setActivity([]), []);

  const visibleProfiles = useMemo(
    () => sortProfiles(filterProfiles(profiles, filter), sortOrder),
    [profiles, filter, sortOrder],
  );

  const groups = useMemo(() => groupProfiles(profiles), [profiles]);
  const visibleGroups = useMemo(
    () => groupProfiles(visibleProfiles),
    [visibleProfiles],
  );
  const tags = useMemo(() => collectTags(profiles), [profiles]);

  const selected = useMemo(
    () => profiles.find((entry) => entry.id === selectedId) ?? null,
    [profiles, selectedId],
  );

  return {
    profiles,
    visibleProfiles,
    visibleGroups,
    groups,
    tags,
    activity,
    filter,
    filterActive: isFilterActive(filter),
    sortOrder,
    selected,
    selectedId,
    setFilter,
    resetFilter,
    setSortOrder,
    setSelectedId,
    addProfile,
    updateProfile,
    duplicateProfile,
    removeProfile,
    toggleFavorite,
    loadSamples,
    importProfiles,
    clearActivity,
  };
}

export type Workspace = ReturnType<typeof useWorkspace>;
