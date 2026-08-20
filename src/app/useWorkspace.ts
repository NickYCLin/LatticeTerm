/**
 * Workspace state: the connection collection, the activity log and the filter
 * the connections view renders from.
 *
 * Synchronizes with Rust backend storage in desktop mode, and seamlessly falls
 * back to React in-memory state in browser preview mode.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
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

async function syncSaveToBackend(profile: ConnectionProfile): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_connection_profile", { profile });
  } catch {
    // In-memory fallback
  }
}

async function syncDeleteToBackend(id: string): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("delete_connection_profile", { id });
  } catch {
    // In-memory fallback
  }
}

export function useWorkspace() {
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [filter, setFilter] = useState<ConnectionFilter>(emptyFilter);
  const [sortOrder, setSortOrder] = useState<SortOrder>("name");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Sync initial list from Rust backend storage if running inside Tauri
  useEffect(() => {
    let cancelled = false;

    async function loadBackendProfiles() {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const backendProfiles = await invoke<ConnectionProfile[]>(
          "list_connection_profiles",
        );
        if (
          !cancelled &&
          Array.isArray(backendProfiles) &&
          backendProfiles.length > 0
        ) {
          setProfiles(backendProfiles);
        }
      } catch {
        // In-memory fallback for browser
      }
    }

    void loadBackendProfiles();
    return () => {
      cancelled = true;
    };
  }, []);

  const record = useCallback((entry: Omit<ActivityEntry, "id" | "at">) => {
    setActivity((entries) => appendActivity(entries, createActivityEntry(entry)));
  }, []);

  const addProfile = useCallback(
    (draft: ConnectionDraft): ConnectionProfile => {
      const profile = createConnectionProfile(draft);
      setProfiles((current) => [...current, profile]);
      setSelectedId(profile.id);
      record({ kind: "created", subject: profile.name, detail: describe(profile) });
      void syncSaveToBackend(profile);
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
      void syncSaveToBackend(profile);
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
      void syncSaveToBackend(copy);
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
      void syncDeleteToBackend(id);
    },
    [profiles, record],
  );

  const toggleFavorite = useCallback((id: string): void => {
    setProfiles((current) =>
      current.map((entry) => {
        if (entry.id !== id) return entry;
        const updated = { ...entry, favorite: !entry.favorite };
        void syncSaveToBackend(updated);
        return updated;
      }),
    );
  }, []);

  const loadSamples = useCallback((): void => {
    const loaded = sampleProfiles.map((profile) => ({ ...profile }));
    setProfiles(loaded);
    setSelectedId(loaded[0]?.id ?? null);
    record({
      kind: "workspace",
      titleKey: "activity.samplesLoaded",
      note: {
        key: "activity.samplesDetail",
        values: { count: sampleProfiles.length },
      },
    });
    for (const p of loaded) {
      void syncSaveToBackend(p);
    }
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
        void syncSaveToBackend(profile);
      }

      return imported.length;
    },
    [record],
  );

  const resetFilter = useCallback((): void => setFilter(emptyFilter), []);

  const clearActivity = useCallback((): void => setActivity([]), []);

  const logActivity = useCallback(
    (entry: {
      type: "created" | "updated" | "deleted" | "workspace";
      message: string;
      detail?: string;
    }) => {
      record({
        kind: entry.type,
        subject: entry.message,
        detail: entry.detail,
      });
    },
    [record],
  );

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
    logActivity,
  };
}

export type WorkspaceState = ReturnType<typeof useWorkspace>;
export type Workspace = WorkspaceState;
