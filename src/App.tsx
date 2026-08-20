/**
 * Application shell.
 *
 * Rail, sidebar, workspace column and status bar. This file owns navigation,
 * overlays and shortcuts; the data lives in `useWorkspace`, the language in
 * `I18nProvider`, and each area renders its own view.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  findNavigationItem,
  navigationItems,
  type ViewId,
} from "./app/navigation";
import { usePreferences, type PreferencesValue } from "./app/preferences";
import { findTheme, oppositeTheme, themeCatalog } from "./app/themes";
import { useRuntimeSummary } from "./app/useRuntimeSummary";
import { useWindowTheme } from "./app/useWindowTheme";
import { useWorkspace } from "./app/useWorkspace";
import type { ConnectionDraft } from "./domain/connection";
import { I18nProvider, localeCatalog, useI18n } from "./i18n";
import { NavRail } from "./components/shell/NavRail";
import { ResourceSidebar } from "./components/shell/ResourceSidebar";
import { StatusBar } from "./components/shell/StatusBar";
import { ViewHeader } from "./components/shell/ViewHeader";
import { ConnectionInspector } from "./components/connections/ConnectionInspector";
import {
  CommandPalette,
  type Command,
} from "./components/overlays/CommandPalette";
import { ConfirmDialog } from "./components/overlays/ConfirmDialog";
import { ConnectionDrawer } from "./components/overlays/ConnectionDrawer";
import { ConnectionsView } from "./views/ConnectionsView";
import { ActivityView } from "./views/ActivityView";
import { VaultView } from "./views/VaultView";
import { PlannedView, type PlannedArea } from "./views/PlannedView";
import { SettingsView } from "./views/SettingsView";
import { PlusIcon, TunnelIcon } from "./components/icons";
import "./styles/index.css";

const plannedAreas: Record<"tunnels", PlannedArea> = {
  tunnels: {
    summaryKey: "planned.tunnels.summary",
    boundaryKey: "planned.tunnels.boundary",
    icon: <TunnelIcon size={24} />,
    capabilities: [
      {
        titleKey: "planned.tunnels.cap1.title",
        detailKey: "planned.tunnels.cap1.detail",
      },
      {
        titleKey: "planned.tunnels.cap2.title",
        detailKey: "planned.tunnels.cap2.detail",
      },
      {
        titleKey: "planned.tunnels.cap3.title",
        detailKey: "planned.tunnels.cap3.detail",
      },
    ],
  },
};

function Workspace({ preferences, update, activeTheme }: PreferencesValue) {
  const { t } = useI18n();
  const workspace = useWorkspace();
  const runtime = useRuntimeSummary();

  useWindowTheme(findTheme(activeTheme).isDark);

  const [view, setView] = useState<ViewId>("connections");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawer, setDrawer] = useState<{
    open: boolean;
    profileId: string | null;
  }>({ open: false, profileId: null });
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
    resetFilter,
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

  const focusSearch = useCallback(() => {
    setView("connections");
    update({ sidebarCollapsed: false });
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }, [update]);

  const saveDraft = useCallback(
    (draft: ConnectionDraft) => {
      if (drawer.profileId) updateProfile(drawer.profileId, draft);
      else addProfile(draft);
      setDrawer({ open: false, profileId: null });
    },
    [drawer.profileId, addProfile, updateProfile],
  );

  const commands = useMemo<Command[]>(() => {
    const entries: Command[] = navigationItems.map((item) => ({
      id: `view:${item.id}`,
      label: t("palette.goTo", { name: t(item.labelKey) }),
      hint: t(item.descriptionKey),
      group: t("palette.group.navigate"),
      run: () => setView(item.id),
    }));

    entries.push(
      {
        id: "action:new",
        label: t("palette.command.add"),
        hint: t("palette.command.addHint"),
        group: t("palette.group.actions"),
        keys: ["N"],
        run: openCreate,
      },
      {
        id: "action:search",
        label: t("palette.command.search"),
        hint: t("palette.command.searchHint"),
        group: t("palette.group.actions"),
        keys: ["/"],
        run: focusSearch,
      },
    );

    if (profiles.length === 0) {
      entries.push({
        id: "action:samples",
        label: t("palette.command.samples"),
        hint: t("palette.command.samplesHint"),
        group: t("palette.group.actions"),
        run: loadSamples,
      });
    }

    // Every theme is reachable from the keyboard, not only the two-way toggle.
    for (const theme of themeCatalog) {
      if (theme.id === preferences.theme) continue;
      entries.push({
        id: `theme:${theme.id}`,
        label: t("palette.command.theme", { name: t(theme.labelKey) }),
        group: t("palette.group.appearance"),
        run: () => update({ theme: theme.id }),
      });
    }

    for (const locale of localeCatalog) {
      if (locale.id === preferences.locale) continue;
      entries.push({
        id: `locale:${locale.id}`,
        label: t("palette.command.language", { name: locale.label }),
        group: t("palette.group.appearance"),
        run: () => update({ locale: locale.id }),
      });
    }

    entries.push(
      {
        id: "action:density",
        label: t("palette.command.density", {
          name:
            preferences.density === "compact"
              ? t("settings.density.comfortable")
              : t("settings.density.compact"),
        }),
        group: t("palette.group.appearance"),
        run: () =>
          update({
            density:
              preferences.density === "compact" ? "comfortable" : "compact",
          }),
      },
      {
        id: "action:sidebar",
        label: preferences.sidebarCollapsed
          ? t("palette.command.sidebar.show")
          : t("palette.command.sidebar.hide"),
        group: t("palette.group.appearance"),
        keys: ["Ctrl", "B"],
        run: () => update({ sidebarCollapsed: !preferences.sidebarCollapsed }),
      },
    );

    return entries;
  }, [
    t,
    openCreate,
    focusSearch,
    update,
    preferences.theme,
    preferences.locale,
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
        focusSearch();
      } else if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        openCreate();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openCreate, focusSearch, update, preferences.sidebarCollapsed]);

  const item = findNavigationItem(view);
  const showSidebar = view === "connections" && !preferences.sidebarCollapsed;
  const showInspector =
    view === "connections" && selected !== null && preferences.inspectorOpen;

  return (
    <div className="app">
      <NavRail
        current={view}
        onSelect={setView}
        activeTheme={activeTheme}
        onToggleTheme={() => update({ theme: oppositeTheme(activeTheme) })}
      />

      {showSidebar && (
        <ResourceSidebar
          ref={searchRef}
          filter={filter}
          onFilterChange={setFilter}
          onReset={resetFilter}
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
          title={t(item.labelKey)}
          description={t(item.descriptionKey)}
          sidebarCollapsed={preferences.sidebarCollapsed}
          showSidebarToggle={view === "connections"}
          onToggleSidebar={() =>
            update({ sidebarCollapsed: !preferences.sidebarCollapsed })
          }
          actions={
            view === "connections" && profiles.length > 0 ? (
              <button
                type="button"
                className="button button--primary"
                onClick={openCreate}
              >
                <PlusIcon size={15} />
                {t("connections.add")}
              </button>
            ) : undefined
          }
        />

        <div className="workspace__body">
          <div className="workspace__content glass glass--sheen">
            {view === "connections" && (
              <ConnectionsView
                workspace={workspace}
                onCreate={openCreate}
                onEdit={openEdit}
                onDelete={setPendingDelete}
              />
            )}
            {view === "tunnels" && <PlannedView area={plannedAreas.tunnels} />}
            {view === "vault" && <VaultView workspace={workspace} />}
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
          title={t("confirm.delete.title", { name: deleting.name })}
          body={t("confirm.delete.body", { host: deleting.hostname })}
          confirmLabel={t("confirm.delete.confirm", { name: deleting.name })}
          cancelLabel={t("common.cancel")}
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

/**
 * Preferences are read once, here, and handed down: the language has to be
 * settled before anything below renders, and a second copy of the state would
 * quietly diverge from this one.
 */
export default function App() {
  const preferences = usePreferences();

  return (
    <I18nProvider locale={preferences.preferences.locale}>
      <Workspace {...preferences} />
    </I18nProvider>
  );
}
