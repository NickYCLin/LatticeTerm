/**
 * Application shell.
 *
 * Frame from the design brief: global rail, resource sidebar, workspace column
 * and status bar. This file owns navigation, overlays and shortcuts; the data
 * itself lives in `useWorkspace`, and each area renders its own view.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findNavigationItem, navigationItems, type ViewId } from "./app/navigation";
import { usePreferences } from "./app/preferences";
import { useRuntimeSummary } from "./app/useRuntimeSummary";
import { useWorkspace } from "./app/useWorkspace";
import { draftFromProfile, type ConnectionDraft } from "./domain/connection";
import { NavRail } from "./components/shell/NavRail";
import { ResourceSidebar } from "./components/shell/ResourceSidebar";
import { StatusBar } from "./components/shell/StatusBar";
import { ViewHeader } from "./components/shell/ViewHeader";
import { ConnectionInspector } from "./components/connections/ConnectionInspector";
import { CommandPalette, type Command } from "./components/overlays/CommandPalette";
import { ConfirmDialog } from "./components/overlays/ConfirmDialog";
import { ConnectionDrawer } from "./components/overlays/ConnectionDrawer";
import { ConnectionsView } from "./views/ConnectionsView";
import { ActivityView } from "./views/ActivityView";
import { PlannedView, type PlannedArea } from "./views/PlannedView";
import { SettingsView } from "./views/SettingsView";
import {
  ImportIcon,
  PlusIcon,
  TunnelIcon,
  VaultIcon,
} from "./components/icons";
import "./styles/index.css";

const plannedAreas: Record<"tunnels" | "vault", PlannedArea> = {
  tunnels: {
    milestone: 4,
    summary:
      "Port forwarding for the hosts you already keep here: local, remote and dynamic tunnels, each showing where it binds and which session depends on it.",
    icon: <TunnelIcon size={22} />,
    boundary:
      "A tunnel needs a live SSH session, so this area opens after the SSH engine and the credential store are in place. Until then no forwarding of any kind is started.",
    capabilities: [
      {
        title: "Local, remote and dynamic forwarding",
        detail:
          "Each type shown with its source, destination and bind scope, in the direction data actually travels.",
      },
      {
        title: "Live state per tunnel",
        detail:
          "Which sessions use it, how long it has been up, and whether it is starting, listening or stopped.",
      },
      {
        title: "Failures that name the cause",
        detail:
          "Port already in use, SSH session dropped, or permission denied on a privileged port — never a bare error.",
      },
    ],
  },
  vault: {
    milestone: 2,
    summary:
      "One place for the things that must stay secret: SSH keys, saved passwords, jump host credentials, and the host fingerprints you have chosen to trust.",
    icon: <VaultIcon size={22} />,
    boundary:
      "Secrets go to the operating system credential store, and host trust to a strict known_hosts check. Neither exists yet, which is why this build asks for no credential anywhere.",
    capabilities: [
      {
        title: "Explicit lock state",
        detail:
          "Locked, unlocking, unlocked, auto-lock imminent, unavailable and recovery required, each visible at a glance.",
      },
      {
        title: "Credentials with references",
        detail:
          "Every item shows which connections use it, so nothing is deleted blindly.",
      },
      {
        title: "Host trust decisions",
        detail:
          "Full fingerprints, comparable and copyable, with first-connect trust and changed-key warnings kept clearly apart.",
      },
      {
        title: "Encrypted import and export",
        detail:
          "Move a vault between machines without its contents passing through plain files.",
      },
    ],
  },
};

export default function App() {
  const { preferences, update } = usePreferences();
  const workspace = useWorkspace();
  const runtime = useRuntimeSummary();

  const [view, setView] = useState<ViewId>("connections");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawer, setDrawer] = useState<{ open: boolean; profileId: string | null }>(
    { open: false, profileId: null },
  );
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);

  const {
    profiles,
    visibleProfiles,
    groups,
    tags,
    filter,
    filterActive,
    setFilter,
    selected,
    setSelectedId,
    addProfile,
    updateProfile,
    duplicateProfile,
    removeProfile,
    loadSamples,
  } = workspace;

  const editing = useMemo(
    () => profiles.find((entry) => entry.id === drawer.profileId) ?? null,
    [profiles, drawer.profileId],
  );

  const deleting = useMemo(
    () => profiles.find((entry) => entry.id === pendingDelete) ?? null,
    [profiles, pendingDelete],
  );

  const openCreate = useCallback(() => {
    setView("connections");
    setDrawer({ open: true, profileId: null });
  }, []);

  const openEdit = useCallback((id: string) => {
    setView("connections");
    setDrawer({ open: true, profileId: id });
  }, []);

  const saveDraft = useCallback(
    (draft: ConnectionDraft) => {
      if (drawer.profileId) updateProfile(drawer.profileId, draft);
      else addProfile(draft);
      setDrawer({ open: false, profileId: null });
    },
    [drawer.profileId, addProfile, updateProfile],
  );

  const resolvedTheme =
    (document.documentElement.dataset.theme as "dark" | "light") ?? "dark";

  const commands = useMemo<Command[]>(() => {
    const entries: Command[] = navigationItems.map((item) => ({
      id: `view:${item.id}`,
      label: `Go to ${item.label}`,
      hint: item.description,
      group: "Navigate",
      run: () => setView(item.id),
    }));

    entries.push(
      {
        id: "action:new",
        label: "Add connection",
        hint: "Open the new connection form",
        group: "Actions",
        keys: ["N"],
        run: openCreate,
      },
      {
        id: "action:search",
        label: "Search connections",
        hint: "Focus the sidebar search field",
        group: "Actions",
        keys: ["/"],
        run: () => {
          setView("connections");
          update({ sidebarCollapsed: false });
          window.setTimeout(() => searchRef.current?.focus(), 0);
        },
      },
      {
        id: "action:theme",
        label: `Switch to ${resolvedTheme === "dark" ? "light" : "dark"} theme`,
        group: "Appearance",
        run: () => update({ theme: resolvedTheme === "dark" ? "light" : "dark" }),
      },
      {
        id: "action:density",
        label:
          preferences.density === "compact"
            ? "Use comfortable density"
            : "Use compact density",
        group: "Appearance",
        run: () =>
          update({
            density:
              preferences.density === "compact" ? "comfortable" : "compact",
          }),
      },
      {
        id: "action:sidebar",
        label: preferences.sidebarCollapsed ? "Show sidebar" : "Hide sidebar",
        group: "Appearance",
        keys: ["Ctrl", "B"],
        run: () => update({ sidebarCollapsed: !preferences.sidebarCollapsed }),
      },
    );

    if (profiles.length === 0) {
      entries.push({
        id: "action:samples",
        label: "Load sample workspace",
        hint: "Six example profiles using documentation hostnames",
        group: "Actions",
        run: loadSamples,
      });
    }

    return entries;
  }, [
    openCreate,
    update,
    resolvedTheme,
    preferences.density,
    preferences.sidebarCollapsed,
    profiles.length,
    loadSamples,
  ]);

  // Global shortcuts. Anything typed into a field is left alone.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable === true;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        update({ sidebarCollapsed: !preferences.sidebarCollapsed });
        return;
      }

      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === "/") {
        event.preventDefault();
        setView("connections");
        update({ sidebarCollapsed: false });
        window.setTimeout(() => searchRef.current?.focus(), 0);
      } else if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        openCreate();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openCreate, update, preferences.sidebarCollapsed]);

  const item = findNavigationItem(view);
  const showSidebar = view === "connections" && !preferences.sidebarCollapsed;
  const showInspector =
    view === "connections" && selected !== null && preferences.inspectorOpen;

  return (
    <div className="app">
      <NavRail
        current={view}
        onSelect={setView}
        theme={preferences.theme}
        resolvedTheme={resolvedTheme}
        onToggleTheme={() =>
          update({ theme: resolvedTheme === "dark" ? "light" : "dark" })
        }
      />

      {showSidebar && (
        <ResourceSidebar
          ref={searchRef}
          filter={filter}
          onFilterChange={setFilter}
          filterActive={filterActive}
          groups={groups}
          tags={tags}
          totalCount={profiles.length}
          favoriteCount={profiles.filter((entry) => entry.favorite).length}
          visibleCount={visibleProfiles.length}
        />
      )}

      <main className="workspace">
        <ViewHeader
          title={item.label}
          description={item.description}
          sidebarCollapsed={preferences.sidebarCollapsed}
          showSidebarToggle={view === "connections"}
          onToggleSidebar={() =>
            update({ sidebarCollapsed: !preferences.sidebarCollapsed })
          }
          actions={
            view === "connections" ? (
              <>
                {profiles.length === 0 && (
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={loadSamples}
                  >
                    <ImportIcon size={14} />
                    Load samples
                  </button>
                )}
                <button
                  type="button"
                  className="button button--primary"
                  onClick={openCreate}
                >
                  <PlusIcon size={14} />
                  Add connection
                </button>
              </>
            ) : undefined
          }
        />

        <div className="workspace__body">
          <div className="workspace__content">
            {view === "connections" && (
              <ConnectionsView
                workspace={workspace}
                onCreate={openCreate}
                onEdit={openEdit}
                onDelete={setPendingDelete}
              />
            )}
            {view === "tunnels" && <PlannedView area={plannedAreas.tunnels} />}
            {view === "vault" && <PlannedView area={plannedAreas.vault} />}
            {view === "activity" && <ActivityView workspace={workspace} />}
            {view === "settings" && (
              <SettingsView
                preferences={preferences}
                onChange={update}
                runtime={runtime}
              />
            )}
          </div>

          {showInspector && selected && (
            <ConnectionInspector
              profile={selected}
              onClose={() => setSelectedId(null)}
              onEdit={() => openEdit(selected.id)}
              onDuplicate={() => duplicateProfile(selected.id)}
              onDelete={() => setPendingDelete(selected.id)}
            />
          )}
        </div>

        <StatusBar
          profileCount={profiles.length}
          visibleCount={visibleProfiles.length}
          filterActive={filterActive}
          vaultReady={runtime.summary?.credentialStorageReady ?? false}
          version={runtime.summary?.version ?? "0.1.0"}
        />
      </main>

      {drawer.open && (
        <ConnectionDrawer
          key={drawer.profileId ?? "new"}
          profile={editing}
          profiles={profiles}
          onSave={saveDraft}
          onClose={() => setDrawer({ open: false, profileId: null })}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          body={`This removes the profile for ${draftFromProfile(deleting).hostname} from this workspace. No remote system is affected.`}
          confirmLabel={`Delete ${deleting.name}`}
          onConfirm={() => {
            removeProfile(deleting.id);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {paletteOpen && (
        <CommandPalette
          commands={commands}
          profiles={profiles}
          onSelectProfile={(profile) => {
            setView("connections");
            setSelectedId(profile.id);
          }}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
}
