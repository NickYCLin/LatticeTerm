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
  isMobilePlatform,
  navigationItemsFor,
  type ViewId,
} from "./app/navigation";
import { usePreferences, type PreferencesValue } from "./app/preferences";
import { findTheme, themeCatalog } from "./app/themes";
import { useRuntimeSummary } from "./app/useRuntimeSummary";
import { APP_VERSION } from "./app/version";
import { useStorageStatus } from "./app/useStorageStatus";
import { useAgentSessions } from "./app/useAgentSessions";
import { useSshSessions } from "./app/useSshSessions";
import { useSftpSessions } from "./app/useSftpSessions";
import { useRemoteSessions } from "./app/useRemoteSessions";
import { useRemoteHost } from "./app/useRemoteHost";
import { useRdpSessions } from "./app/useRdpSessions";
import { useVncSessions } from "./app/useVncSessions";
import { useVault } from "./app/useVault";
import { useVaultAutoLock } from "./app/useVaultAutoLock";
import { useWindowTheme } from "./app/useWindowTheme";
import { useWorkspace } from "./app/useWorkspace";
import { useCredentialDeleteGuard } from "./app/useSavedCredential";
import type { ConnectionDraft, ConnectionProfile } from "./domain/connection";
import { I18nProvider, localeCatalog, useI18n } from "./i18n";
import { NavRail } from "./components/shell/NavRail";
import { ResourceSidebar } from "./components/shell/ResourceSidebar";
import { StatusBar } from "./components/shell/StatusBar";
import { ViewHeader } from "./components/shell/ViewHeader";
import { ConnectionInspector } from "./components/connections/ConnectionInspector";
import { useHostMetrics } from "./app/useHostMetrics";
import {
  CommandPalette,
  type Command,
} from "./components/overlays/CommandPalette";
import { ConfirmDialog } from "./components/overlays/ConfirmDialog";
import { ConnectionDrawer } from "./components/overlays/ConnectionDrawer";
import { ConnectionsView } from "./views/ConnectionsView";
import { AgentsView } from "./views/AgentsView";
import { SessionsView } from "./views/SessionsView";
import { ConnectFlow } from "./components/terminal/ConnectFlow";
import { RemoteConnectFlow } from "./components/remote/RemoteConnectFlow";
import { RemoteHostDialog } from "./components/remote/RemoteHostDialog";
import { RdpConnectFlow } from "./components/rdp/RdpConnectFlow";
import { VncConnectFlow } from "./components/vnc/VncConnectFlow";
import { SftpConnectFlow } from "./components/sftp/SftpConnectFlow";
import { ActivityView } from "./views/ActivityView";
import { VaultView } from "./views/VaultView";
import { TunnelsView } from "./views/TunnelsView";
import { SettingsView } from "./views/SettingsView";
import { PlusIcon, ScreenShareIcon } from "./components/icons";
import "./styles/index.css";

function Workspace({ preferences, update, activeTheme }: PreferencesValue) {
  const { t } = useI18n();
  const workspace = useWorkspace();
  const runtime = useRuntimeSummary();
  const platform = runtime.summary?.platform;
  const onMobile = isMobilePlatform(platform);
  const visibleNavigation = navigationItemsFor(platform);
  const storage = useStorageStatus();
  const agents = useAgentSessions();
  const ssh = useSshSessions();
  const sftp = useSftpSessions();
  const remote = useRemoteSessions();
  const remoteHost = useRemoteHost();
  const rdp = useRdpSessions();
  const vnc = useVncSessions();
  const vault = useVault();

  useVaultAutoLock(preferences, vault);

  useWindowTheme(findTheme(activeTheme).isDark);

  const [view, setView] = useState<ViewId>("connections");
  // A desktop-only view reached on mobile (stale state) snaps back home.
  useEffect(() => {
    if (onMobile && !visibleNavigation.some((entry) => entry.id === view)) {
      setView("connections");
    }
  }, [onMobile, view, visibleNavigation]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [remoteHostOpen, setRemoteHostOpen] = useState(false);
  const [drawer, setDrawer] = useState<{
    open: boolean;
    profileId: string | null;
  }>({ open: false, profileId: null });
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [profileDeleteError, setProfileDeleteError] = useState<string | null>(
    null,
  );
  const [connectTarget, setConnectTarget] = useState<ConnectionProfile | null>(
    null,
  );
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

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
  const deleteGuard = useCredentialDeleteGuard(deleting);

  const requestDelete = useCallback((id: string) => {
    setProfileDeleteError(null);
    setPendingDelete(id);
  }, []);

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
    const entries: Command[] = visibleNavigation.map((item) => ({
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
        run: () => {
          void loadSamples();
        },
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
  , visibleNavigation]);

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
  // Read resources only while the inspector can show them; passing null stops
  // the polling the moment the panel closes.
  const inspectorMetrics = useHostMetrics(
    showInspector ? selected : null,
    ssh.sessions,
  );

  return (
    <div className={`app${onMobile ? " app--mobile" : ""}`}>
      <NavRail current={view} onSelect={setView} items={visibleNavigation} />

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
            <>
              {!onMobile && (
                <button
                  type="button"
                  className={
                    remoteHost.status
                      ? "button button--secondary"
                      : "button button--ghost"
                  }
                  onClick={() => setRemoteHostOpen(true)}
                >
                  <ScreenShareIcon size={15} />
                  {t(
                    remoteHost.status
                      ? "remote.host.activeAction"
                      : "remote.host.action",
                  )}
                </button>
              )}
              {view === "connections" && profiles.length > 0 && (
                <button
                  type="button"
                  className="button button--primary"
                  onClick={openCreate}
                >
                  <PlusIcon size={15} />
                  {t("connections.add")}
                </button>
              )}
            </>
          }
        />

        <div className="workspace__body">
          <div className="workspace__content glass glass--sheen">
            {view === "connections" && (
              <ConnectionsView
                workspace={workspace}
                onCreate={openCreate}
                onEdit={openEdit}
                onDelete={requestDelete}
                onConnect={setConnectTarget}
              />
            )}
            {/* Sessions stay mounted while other views are open: a terminal
                or remote canvas that unmounts loses everything it has drawn,
                and nothing replays it. Hidden, not gone. */}
            <div
              hidden={view !== "terminal"}
              style={{ display: view === "terminal" ? "contents" : "none" }}
            >
              <SessionsView
                agents={agents}
                ssh={ssh}
                sftp={sftp}
                remote={remote}
                rdp={rdp}
                vnc={vnc}
                activeSessionId={activeSessionId}
                onSelect={setActiveSessionId}
                theme={activeTheme}
              />
            </div>
            {view === "agents" && (
              <AgentsView
                agents={agents}
                onOpen={(sessionId) => {
                  setActiveSessionId(sessionId);
                  setView("terminal");
                }}
              />
            )}
            {view === "tunnels" && (
              // Tunnels authenticate with a saved SSH password, so only SSH
              // profiles can serve as the gateway; offering an RDP or Lattice
              // profile here would fail at start every time.
              <TunnelsView
                profiles={profiles.filter((entry) => entry.protocol === "ssh")}
              />
            )}
            {view === "vault" && (
              <VaultView workspace={workspace} vault={vault} />
            )}
            {view === "activity" && <ActivityView workspace={workspace} />}
            {view === "settings" && (
              <SettingsView
                preferences={preferences}
                onChange={update}
                runtime={runtime}
                storage={storage}
              />
            )}
          </div>

          {showInspector && selected && (
            <ConnectionInspector
              profile={selected}
              metrics={inspectorMetrics}
              onClose={() => setSelectedId(null)}
              onEdit={() => openEdit(selected.id)}
              onDuplicate={() => duplicateProfile(selected.id)}
              onDelete={() => requestDelete(selected.id)}
            />
          )}
        </div>

        <StatusBar
          profileCount={profiles.length}
          visibleCount={visibleProfiles.length}
          filterActive={filterActive}
          vaultReady={runtime.summary?.credentialStorageReady ?? false}
          version={runtime.summary?.version ?? APP_VERSION}
          storage={storage}
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
          title={
            deleteGuard.mode === "saved"
              ? t("confirm.delete.credential.title", { name: deleting.name })
              : deleteGuard.mode === "unavailable" || profileDeleteError
                ? t("confirm.delete.credential.unavailable.title")
                : t("confirm.delete.title", { name: deleting.name })
          }
          body={
            deleteGuard.mode === "saved"
              ? t("confirm.delete.credential.body", {
                  provider: deleteGuard.provider,
                })
              : deleteGuard.mode === "unavailable" || profileDeleteError
                ? t("confirm.delete.credential.unavailable.body", {
                    detail:
                      profileDeleteError ??
                      (deleteGuard.mode === "unavailable"
                        ? deleteGuard.detail
                        : ""),
                  })
                : deleteGuard.mode === "loading"
                  ? t("confirm.delete.credential.loading")
                  : t("confirm.delete.body", { host: deleting.hostname })
          }
          confirmLabel={
            deleteGuard.mode === "saved"
              ? t("confirm.delete.credential.openVault")
              : deleteGuard.mode === "loading"
                ? t("confirm.delete.credential.checking")
                : deleteGuard.mode === "unavailable" || profileDeleteError
                  ? t("confirm.delete.credential.blocked")
                  : t("confirm.delete.confirm", { name: deleting.name })
          }
          confirmDisabled={
            deleteGuard.mode === "loading" ||
            deleteGuard.mode === "unavailable" ||
            profileDeleteError !== null
          }
          tone={deleteGuard.mode === "saved" ? "default" : "danger"}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            if (deleteGuard.mode === "saved") {
              setView("vault");
              setProfileDeleteError(null);
              setPendingDelete(null);
              return;
            }
            void removeProfile(deleting.id)
              .then(() => setPendingDelete(null))
              .catch((reason: unknown) => {
                setProfileDeleteError(
                  reason instanceof Error ? reason.message : String(reason),
                );
              });
          }}
          onCancel={() => {
            setProfileDeleteError(null);
            setPendingDelete(null);
          }}
        />
      )}

      {connectTarget?.protocol === "ssh" && (
        <ConnectFlow
          profile={connectTarget}
          ssh={ssh}
          onConnected={(sessionId) => {
            setConnectTarget(null);
            setActiveSessionId(sessionId);
            setView("terminal");
          }}
          onCancel={() => setConnectTarget(null)}
        />
      )}

      {connectTarget?.protocol === "lattice" && (
        <RemoteConnectFlow
          profile={connectTarget}
          remote={remote}
          onConnected={(sessionId) => {
            setConnectTarget(null);
            setActiveSessionId(sessionId);
            setView("terminal");
          }}
          onCancel={() => setConnectTarget(null)}
        />
      )}

      {connectTarget?.protocol === "sftp" && (
        <SftpConnectFlow
          profile={connectTarget}
          sftp={sftp}
          onConnected={(sessionId) => {
            setConnectTarget(null);
            setActiveSessionId(sessionId);
            setView("terminal");
          }}
          onCancel={() => setConnectTarget(null)}
        />
      )}

      {connectTarget && onMobile && (connectTarget.protocol === "rdp" || connectTarget.protocol === "vnc") && (
        <div className="scrim scrim--center" role="presentation" onMouseDown={() => setConnectTarget(null)}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="dialog__head">
              <h2 className="dialog__title">{t("mobile.desktopOnly.title")}</h2>
            </header>
            <div className="dialog__stack">
              <p className="dialog__body">{t("mobile.desktopOnly.body")}</p>
              <div className="dialog__actions">
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => setConnectTarget(null)}
                >
                  {t("common.close")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!onMobile && connectTarget?.protocol === "rdp" && (
        <RdpConnectFlow
          profile={connectTarget}
          rdp={rdp}
          onConnected={(sessionId) => {
            setConnectTarget(null);
            setActiveSessionId(sessionId);
            setView("terminal");
          }}
          onCancel={() => setConnectTarget(null)}
        />
      )}

      {!onMobile && connectTarget?.protocol === "vnc" && (
        <VncConnectFlow
          profile={connectTarget}
          vnc={vnc}
          onConnected={(sessionId) => {
            setConnectTarget(null);
            setActiveSessionId(sessionId);
            setView("terminal");
          }}
          onCancel={() => setConnectTarget(null)}
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

      {remoteHostOpen && (
        <RemoteHostDialog
          host={remoteHost}
          onClose={() => setRemoteHostOpen(false)}
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
