/**
 * Workspace state: the connection collection, the activity log and the
 * filter the Connections view renders from.
 *
 * Profiles live in memory for this foundation build. Persistence waits for the
 * encrypted local store, so nothing here writes connection metadata to disk.
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

export function useWorkspace() {
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [filter, setFilter] = useState<ConnectionFilter>(emptyFilter);
  const [sortOrder, setSortOrder] = useState<SortOrder>("name");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const record = useCallback(
    (
      kind: ActivityEntry["kind"],
      message: string,
      detail?: string,
    ): void => {
      setActivity((entries) =>
        appendActivity(entries, createActivityEntry(kind, message, detail)),
      );
    },
    [],
  );

  const addProfile = useCallback(
    (draft: ConnectionDraft): ConnectionProfile => {
      const profile = createConnectionProfile(draft);
      setProfiles((current) => [...current, profile]);
      setSelectedId(profile.id);
      record(
        "created",
        profile.name,
        `${profile.protocol.toUpperCase()} · ${connectionTarget(profile)}`,
      );
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
      record(
        "updated",
        profile.name,
        `${profile.protocol.toUpperCase()} · ${connectionTarget(profile)}`,
      );
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
        name: `${source.name} copy`,
        favorite: false,
      });

      setProfiles((current) => [...current, copy]);
      setSelectedId(copy.id);
      record("created", copy.name, `Duplicated from ${source.name}`);
      return copy;
    },
    [profiles, record],
  );

  const removeProfile = useCallback(
    (id: string): void => {
      const target = profiles.find((entry) => entry.id === id);
      setProfiles((current) => current.filter((entry) => entry.id !== id));
      setSelectedId((current) => (current === id ? null : current));
      if (target) record("deleted", target.name, connectionTarget(target));
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
    record(
      "workspace",
      "Sample workspace loaded",
      `${sampleProfiles.length} example profiles using documentation hostnames`,
    );
  }, [record]);

  const importProfiles = useCallback(
    (imported: ConnectionProfile[]): number => {
      if (imported.length === 0) return 0;
      setProfiles((current) => [...current, ...imported]);
      if (imported.length > 0 && !selectedId) {
        setSelectedId(imported[0].id);
      }
      record(
        "workspace",
        `Imported ${imported.length} profile${imported.length === 1 ? "" : "s"}`,
        "Non-secret JSON import",
      );
      return imported.length;
    },
    [record, selectedId],
  );

  const clearActivity = useCallback((): void => {
    setActivity([]);
  }, []);

  const resetFilter = useCallback((): void => {
    setFilter(emptyFilter);
  }, []);

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
    record,
  };
}

export type Workspace = ReturnType<typeof useWorkspace>;
