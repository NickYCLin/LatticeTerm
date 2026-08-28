/** Unified workspace for text terminals and graphical remote sessions. */

import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { homeDir } from "@tauri-apps/api/path";
import type { RemoteApi } from "../app/useRemoteSessions";
import type { RdpApi } from "../app/useRdpSessions";
import type { VncApi } from "../app/useVncSessions";
import {
  shouldClearSessionSelection,
  type SessionClosedNotice,
} from "../app/sessionSnapshot";
import type {
  AgentApi,
  AgentDefinition,
  AgentSessionSummary,
} from "../app/useAgentSessions";
import { agentCatalogForDisplay } from "../app/useAgentSessions";
import type { SshApi } from "../app/useSshSessions";
import type { SftpApi } from "../app/useSftpSessions";
import type { ThemeId } from "../app/themes";
import { agentGroupSidebarStatus } from "../app/sessionStatus";
import { disconnectAgentSessionMembers } from "../app/agentSessionRemoval";
import {
  relocateAgentSessionGroup,
  summarizeAgentRelocation,
} from "../app/agentSessionRelocation";
import {
  createSessionSidebarFolder,
  emptySessionSidebarLayout,
  loadSessionSidebarLayout,
  mergeSessionSidebarLayouts,
  moveSessionSidebarNode,
  reconcileSessionSidebarLayout,
  removeSessionSidebarFolder,
  renameSessionSidebarFolder,
  saveSessionSidebarLayout,
  sessionSidebarSessionNodeId,
  toggleSessionSidebarFolder,
  type LiveSessionSidebarNode,
  type SessionSidebarFolder,
} from "../app/sessionSidebarLayout";
import {
  MAX_WORKSPACE_TRANSFER_BYTES,
  parseWorkspaceTransfer,
  serializeWorkspaceTransfer,
  type PortableWorkspaceItem,
  type WorkspaceTransferFile,
} from "../app/workspaceTransfer";
import { useI18n } from "../i18n/context";
import { Callout, EmptyState } from "../components/common/Callout";
import { ConfirmDialog } from "../components/overlays/ConfirmDialog";
import {
  SessionProjectSidebar,
  type SessionSidebarProjectItem,
} from "../components/sessions/SessionProjectSidebar";
import { AgentSessionRelocationDialog } from "../components/sessions/AgentSessionRelocationDialog";
import { WorkspaceImportDialog } from "../components/sessions/WorkspaceImportDialog";
import {
  AgentIcon,
  CloseIcon,
  EditIcon,
  FolderIcon,
  ImportIcon,
  PlusIcon,
  ScreenShareIcon,
  TerminalIcon,
  TransferIcon,
} from "../components/icons";
import { AgentTerminalPane } from "../components/agents/AgentTerminalPane";
import { HostMetricsPanel } from "../components/connections/HostMetricsPanel";
import { useSessionHostMetrics } from "../app/useHostMetrics";
import { RemotePane } from "../components/remote/RemotePane";
import { RdpPane } from "../components/rdp/RdpPane";
import { VncPane } from "../components/vnc/VncPane";
import { SftpPane } from "../components/sftp/SftpPane";
import { TerminalPane } from "../components/terminal/TerminalPane";

type SessionRef =
  | {
      kind: "agent";
      sessionId: string;
      label: string;
      groupId: string;
      members: AgentSessionSummary[];
    }
  | { kind: "ssh"; sessionId: string; profileId: string; label: string }
  | { kind: "sftp"; sessionId: string; profileId: string; label: string }
  | { kind: "remote"; sessionId: string; profileId: string; label: string }
  | { kind: "rdp"; sessionId: string; profileId: string; label: string }
  | { kind: "vnc"; sessionId: string; profileId: string; label: string };

type AgentSessionRef = Extract<SessionRef, { kind: "agent" }>;

interface SessionRelocationDraft {
  session: AgentSessionRef;
  activeMemberId: string;
  fromDirectory: string;
  toDirectory: string;
}

interface WorkspaceTransferNotice {
  tone: "info" | "warn" | "danger";
  title: string;
  body: string;
}

function workspaceItemSignature(
  item: Pick<
    PortableWorkspaceItem,
    | "groupKey"
    | "definitionId"
    | "label"
    | "launchArguments"
    | "workingDirectory"
  >,
): string {
  return JSON.stringify([
    item.groupKey,
    item.definitionId,
    item.label,
    item.launchArguments,
    normalizeDirectory(item.workingDirectory),
  ]);
}

function downloadWorkspaceFile(content: string) {
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `latticeterm-workspace-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

interface ClosedNoticeSource {
  notice: SessionClosedNotice;
  clear: () => void;
}

interface SessionProject {
  id: string;
  label: string;
  workingDirectory: string | null;
  sessions: SessionRef[];
}

function localProjectId(workingDirectory: string): string {
  return `local:${workingDirectory.replace(/^\\\\\?\\/, "").toLocaleLowerCase()}`;
}

/** Comparable form for "is this the same folder" checks across separators. */
function normalizeDirectory(path: string): string {
  return path
    .replace(/^\\\\\?\\/, "")
    .replace(/[\\/]+$/, "")
    .toLocaleLowerCase();
}

function localProjectLabel(workingDirectory: string): string {
  const plain = workingDirectory.replace(/^\\\\\?\\/, "").replace(/[\\/]+$/, "");
  const segments = plain.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? plain;
}

function projectIdForSession(session: SessionRef): string {
  return session.kind === "agent"
    ? localProjectId(session.members[0]?.workingDirectory ?? session.groupId)
    : "remote-connections";
}

function sidebarProjectNodeId(projectId: string): string {
  return `project:${projectId}`;
}

function sidebarSessionNodeId(session: SessionRef): string {
  return sessionSidebarSessionNodeId(
    session.kind,
    session.sessionId,
    session.kind === "agent" ? session.groupId : session.profileId,
  );
}

export function SessionsView({
  agents,
  ssh,
  sftp,
  remote,
  rdp,
  vnc,
  activeSessionId,
  onSelect,
  theme,
  sessionRestoreComplete,
}: {
  agents: AgentApi;
  ssh: SshApi;
  sftp: SftpApi;
  remote: RemoteApi;
  rdp: RdpApi;
  vnc: VncApi;
  activeSessionId: string | null;
  onSelect: (sessionId: string | null) => void;
  theme: ThemeId;
  sessionRestoreComplete: boolean;
}) {
  const { t } = useI18n();

  // Quick chats launch in the user's home folder and group under a fixed
  // "general chats" project, so asking a CLI something never requires
  // picking a project directory first.
  const [homeDirectory, setHomeDirectory] = useState<string | null>(null);
  useEffect(() => {
    homeDir()
      .then(setHomeDirectory)
      .catch(() => {
        // Browser preview has no Tauri path API; quick chat stays hidden.
      });
  }, []);

  // MobaXterm-style pairing: each SSH tab can reveal a file browser docked
  // beside its terminal, served by an SFTP channel opened on that very SSH
  // session. `pairedSftp` maps the SSH session to its browser's SFTP id, and
  // `filesOpen` tracks which SSH tabs currently show the panel.
  const [pairedSftp, setPairedSftp] = useState<Record<string, string>>({});
  const [filesOpen, setFilesOpen] = useState<Record<string, boolean>>({});

  async function toggleFiles(sshSessionId: string) {
    const opening = !filesOpen[sshSessionId];
    setFilesOpen((prev) => ({ ...prev, [sshSessionId]: opening }));
    if (opening && !pairedSftp[sshSessionId]) {
      const outcome = await sftp.attachToSsh(sshSessionId);
      if (outcome.outcome === "connected") {
        setPairedSftp((prev) => ({
          ...prev,
          [sshSessionId]: outcome.session.sessionId,
        }));
      } else {
        // The channel could not open; leave the panel closed rather than blank.
        setFilesOpen((prev) => ({ ...prev, [sshSessionId]: false }));
      }
    }
  }

  // A fresh SSH tab opens with its file browser visible, so the remote
  // folders are on screen right after connecting; the header toggle still
  // remembers a manual close per tab. The ref guards against re-attaching
  // while the first toggle's state update is still in flight.
  const autoOpenedFilesRef = useRef(new Set<string>());
  useEffect(() => {
    for (const session of ssh.sessions) {
      if (
        filesOpen[session.sessionId] === undefined &&
        !autoOpenedFilesRef.current.has(session.sessionId)
      ) {
        autoOpenedFilesRef.current.add(session.sessionId);
        void toggleFiles(session.sessionId);
      }
    }
  }, [ssh.sessions, filesOpen]);

  // When an SSH tab goes away, tear down the browser channel it owned so the
  // panel and its SFTP session do not linger.
  useEffect(() => {
    const liveSsh = new Set(ssh.sessions.map((session) => session.sessionId));
    const stale = Object.entries(pairedSftp).filter(
      ([sshId]) => !liveSsh.has(sshId),
    );
    if (stale.length === 0) return;
    setPairedSftp((prev) => {
      const next = { ...prev };
      for (const [sshId] of stale) delete next[sshId];
      return next;
    });
    setFilesOpen((prev) => {
      const next = { ...prev };
      for (const [sshId] of stale) delete next[sshId];
      return next;
    });
    for (const [, sftpId] of stale) void sftp.disconnect(sftpId);
  }, [ssh.sessions, pairedSftp, sftp]);

  const pairedSftpIds = new Set(Object.values(pairedSftp));
  // Inline rename of a running agent tab: which session is being edited, and
  // the working text. Committing calls the persisted backend rename.
  const [editingTab, setEditingTab] = useState<string | null>(null);
  const [tabDraft, setTabDraft] = useState("");

  // Which CLI is shown for each multi-CLI tab, remembered so switching tabs
  // returns to the last CLI you used there. `addCliFor` holds the group whose
  // "add a CLI" picker is open.
  const [activeMemberByGroup, setActiveMemberByGroup] = useState<
    Record<string, string>
  >({});
  const [addCliFor, setAddCliFor] = useState<string | null>(null);
  const [carryContext, setCarryContext] = useState(true);
  const [sidebarLayout, setSidebarLayout] = useState(() =>
    loadSessionSidebarLayout(window.localStorage),
  );
  const [folderEditor, setFolderEditor] = useState<{
    parentId: string | null;
    folder: SessionSidebarFolder | null;
  } | null>(null);
  const [folderDraft, setFolderDraft] = useState("");
  const [pendingDeleteFolder, setPendingDeleteFolder] =
    useState<SessionSidebarFolder | null>(null);
  const [pendingRemoveSession, setPendingRemoveSession] =
    useState<SessionRef | null>(null);
  const [removingSession, setRemovingSession] = useState(false);
  const [removeSessionError, setRemoveSessionError] = useState<string | null>(
    null,
  );
  const [newProjectDirectory, setNewProjectDirectory] = useState<string | null>(
    null,
  );
  const [choosingProject, setChoosingProject] = useState(false);
  const [launchingProjectCli, setLaunchingProjectCli] = useState<string | null>(
    null,
  );
  const [newProjectError, setNewProjectError] = useState<string | null>(null);
  const [relocation, setRelocation] = useState<SessionRelocationDraft | null>(
    null,
  );
  const [choosingRelocation, setChoosingRelocation] = useState(false);
  const [relocating, setRelocating] = useState(false);
  const [relocationError, setRelocationError] = useState<string | null>(null);
  const [relocationNotice, setRelocationNotice] = useState<string | null>(null);
  const workspaceImportInputRef = useRef<HTMLInputElement>(null);
  const [workspaceImport, setWorkspaceImport] =
    useState<WorkspaceTransferFile | null>(null);
  const [workspaceImportError, setWorkspaceImportError] = useState<string | null>(
    null,
  );
  const [importingWorkspace, setImportingWorkspace] = useState(false);
  const [pendingClearWorkspace, setPendingClearWorkspace] = useState(false);
  const [clearingWorkspace, setClearingWorkspace] = useState(false);
  const [workspaceTransferNotice, setWorkspaceTransferNotice] =
    useState<WorkspaceTransferNotice | null>(null);
  // Mobile hides the sidebar; this opens it as an overlay drawer, the only
  // way to switch sessions there now that the tab strip is gone.
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);

  useEffect(() => {
    if (!mobileTreeOpen) return;
    function close(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileTreeOpen(false);
    }
    document.addEventListener("keydown", close, true);
    return () => document.removeEventListener("keydown", close, true);
  }, [mobileTreeOpen]);

  useEffect(() => {
    if (!folderEditor) return;
    function close(event: KeyboardEvent) {
      if (event.key === "Escape") setFolderEditor(null);
    }
    document.addEventListener("keydown", close, true);
    return () => document.removeEventListener("keydown", close, true);
  }, [folderEditor]);

  const displayAgentCatalog = agentCatalogForDisplay(agents.catalog);
  const installedAgents = displayAgentCatalog.filter(
    (definition) => definition.installed,
  );

  async function chooseProjectDirectory() {
    setChoosingProject(true);
    setNewProjectError(null);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("terminal.projects.choose"),
      });
      if (typeof selected === "string") setNewProjectDirectory(selected);
    } catch (reason) {
      setNewProjectError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setChoosingProject(false);
    }
  }

  async function chooseRelocationDirectory(session: AgentSessionRef) {
    setChoosingRelocation(true);
    setRelocationError(null);
    setRelocationNotice(null);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("terminal.directory.choose"),
      });
      const fromDirectory = session.members[0]?.workingDirectory ?? "";
      if (
        typeof selected !== "string" ||
        normalizeDirectory(selected) === normalizeDirectory(fromDirectory)
      ) {
        return;
      }
      setRelocation({
        session,
        activeMemberId: activeMemberId(session),
        fromDirectory,
        toDirectory: selected,
      });
    } catch (reason) {
      setRelocationError(
        t("terminal.directory.chooseFailed", {
          detail: reason instanceof Error ? reason.message : String(reason),
        }),
      );
    } finally {
      setChoosingRelocation(false);
    }
  }

  async function confirmRelocation() {
    const request = relocation;
    if (!request) return;
    setRelocating(true);
    setRelocationError(null);
    try {
      const outcome = await relocateAgentSessionGroup({
        sessions: request.session.members,
        definitions: agents.catalog,
        activeSessionId: request.activeMemberId,
        workingDirectory: request.toDirectory,
        formatHandoff: (transcript) =>
          t("terminal.handoff.frame", { transcript }),
        api: agents,
      });
      setActiveMemberByGroup((current) => ({
        ...current,
        [request.session.groupId]: outcome.selectedSessionId,
      }));
      onSelect(outcome.selectedSessionId);
      setRelocation(null);
      if (outcome.closeFailures.length > 0) {
        setRelocationNotice(
          t("terminal.directory.partialClose", {
            count: outcome.closeFailures.length,
          }),
        );
      }
    } catch (reason) {
      setRelocationError(
        t("terminal.directory.failed", {
          detail: reason instanceof Error ? reason.message : String(reason),
        }),
      );
    } finally {
      setRelocating(false);
    }
  }

  function classifyWorkspaceImport(transfer: WorkspaceTransferFile) {
    const existingCounts = new Map<string, number>();
    for (const session of agents.sessions) {
      const signature = workspaceItemSignature({
        groupKey: session.groupId || session.sessionId,
        definitionId: session.definitionId,
        label: session.label,
        launchArguments: session.launchArguments,
        workingDirectory: session.workingDirectory,
      });
      existingCounts.set(signature, (existingCounts.get(signature) ?? 0) + 1);
    }

    const pending: PortableWorkspaceItem[] = [];
    let unavailableCount = 0;
    let existingCount = 0;
    for (const item of transfer.items) {
      const definition = agents.catalog.find(
        (candidate) => candidate.id === item.definitionId,
      );
      if (item.definitionId === "custom" || !definition?.installed) {
        unavailableCount += 1;
        continue;
      }
      const signature = workspaceItemSignature(item);
      const count = existingCounts.get(signature) ?? 0;
      if (count > 0) {
        existingCount += 1;
        existingCounts.set(signature, count - 1);
        continue;
      }
      pending.push(item);
    }
    return { pending, unavailableCount, existingCount };
  }

  function exportWorkspaceItems() {
    setWorkspaceTransferNotice(null);
    if (agents.sessions.length === 0 && reconciledSidebarLayout.folders.length === 0) {
      setWorkspaceTransferNotice({
        tone: "warn",
        title: t("terminal.projects.export"),
        body: t("terminal.projects.exportEmpty"),
      });
      return;
    }
    downloadWorkspaceFile(
      serializeWorkspaceTransfer(agents.sessions, reconciledSidebarLayout),
    );
    setWorkspaceTransferNotice({
      tone: "info",
      title: t("terminal.projects.exportedTitle"),
      body: t("terminal.projects.exported", {
        projects: new Set(
          agents.sessions.map((session) =>
            normalizeDirectory(session.workingDirectory),
          ),
        ).size,
        sessions: agents.sessions.length,
        folders: reconciledSidebarLayout.folders.length,
      }),
    });
  }

  async function readWorkspaceImport(file: File) {
    setWorkspaceTransferNotice(null);
    setWorkspaceImportError(null);
    try {
      if (file.size > MAX_WORKSPACE_TRANSFER_BYTES) {
        throw new Error(t("terminal.projects.importInvalid"));
      }
      const transfer = parseWorkspaceTransfer(await file.text());
      if (!transfer) throw new Error(t("terminal.projects.importInvalid"));
      setWorkspaceImport(transfer);
    } catch (reason) {
      setWorkspaceTransferNotice({
        tone: "danger",
        title: t("terminal.projects.importFailedTitle"),
        body:
          reason instanceof Error
            ? reason.message
            : t("terminal.projects.importReadFailed", {
                detail: String(reason),
              }),
      });
    }
  }

  async function confirmWorkspaceImport() {
    const transfer = workspaceImport;
    if (!transfer) return;
    const classification = classifyWorkspaceImport(transfer);
    setImportingWorkspace(true);
    setWorkspaceImportError(null);
    const renamedGroups = new Set<string>();
    const failures: string[] = [];
    const launched: AgentSessionSummary[] = [];
    try {
      for (const item of classification.pending) {
        try {
          const session = await agents.launch({
            definitionId: item.definitionId,
            label: item.label,
            executable: item.executable,
            arguments: item.launchArguments,
            resumeSessionId: null,
            groupId: item.groupKey,
            seedInput: null,
            restoreExistingSession: false,
            workingDirectory: item.workingDirectory,
            cols: 120,
            rows: 32,
          });
          launched.push(session);
          if (!renamedGroups.has(item.groupKey)) {
            renamedGroups.add(item.groupKey);
            try {
              await agents.rename(session.sessionId, item.groupLabel);
            } catch {
              // The imported CLI is usable even if its display name stays local.
            }
          }
        } catch (reason) {
          failures.push(
            `${item.groupLabel}: ${
              reason instanceof Error ? reason.message : String(reason)
            }`,
          );
        }
      }
      setSidebarLayout(
        mergeSessionSidebarLayouts(reconciledSidebarLayout, transfer.sidebar),
      );
      setWorkspaceImport(null);
      const skipped =
        classification.unavailableCount + classification.existingCount;
      setWorkspaceTransferNotice({
        tone: failures.length > 0 ? "warn" : "info",
        title: t("terminal.projects.importedTitle"),
        body: `${t("terminal.projects.imported", {
          imported: launched.length,
          skipped,
          failed: failures.length,
        })}${failures.length > 0 ? ` ${failures.slice(0, 3).join("；")}` : ""}`,
      });
      if (launched[0]) onSelect(launched[0].sessionId);
    } catch (reason) {
      setWorkspaceImportError(
        reason instanceof Error ? reason.message : String(reason),
      );
    } finally {
      setImportingWorkspace(false);
    }
  }

  async function clearWorkspaceItems() {
    setClearingWorkspace(true);
    setWorkspaceTransferNotice(null);
    try {
      await disconnectAgentSessionMembers(
        agents.sessions.map((session) => session.sessionId),
        agents.disconnect,
      );
      if (
        agents.sessions.some((session) => session.sessionId === activeSessionId)
      ) {
        onSelect(null);
      }
      setSidebarLayout({
        ...emptySessionSidebarLayout,
        folders: [],
        placements: {},
        collapsedFolderIds: [],
      });
      setPendingClearWorkspace(false);
      setWorkspaceTransferNotice({
        tone: "info",
        title: t("terminal.projects.clearedTitle"),
        body: t("terminal.projects.cleared"),
      });
    } catch (reason) {
      setPendingClearWorkspace(false);
      setWorkspaceTransferNotice({
        tone: "danger",
        title: t("terminal.projects.clearFailedTitle"),
        body: t("terminal.projects.clearFailed", {
          detail: reason instanceof Error ? reason.message : String(reason),
        }),
      });
    } finally {
      setClearingWorkspace(false);
    }
  }

  function closeNewProjectDialog() {
    if (launchingProjectCli) return;
    setNewProjectDirectory(null);
    setNewProjectError(null);
  }

  useEffect(() => {
    if (!newProjectDirectory) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !launchingProjectCli) {
        event.stopPropagation();
        setNewProjectDirectory(null);
        setNewProjectError(null);
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [newProjectDirectory, launchingProjectCli]);

  function beginRename(sessionId: string, label: string) {
    setEditingTab(sessionId);
    setTabDraft(label);
  }

  async function commitRename(sessionId: string) {
    const label = tabDraft.trim();
    setEditingTab(null);
    if (label.length > 0) {
      try {
        await agents.rename(sessionId, label);
      } catch {
        // A rejected label just leaves the previous name in place.
      }
    }
  }

  function selectMember(groupId: string, sessionId: string) {
    setActiveMemberByGroup((prev) => ({ ...prev, [groupId]: sessionId }));
    onSelect(sessionId);
  }

  async function addCli(
    group: { groupId: string; members: AgentSessionSummary[] },
    definition: AgentDefinition,
    carryContext: boolean,
  ) {
    setAddCliFor(null);
    const workingDirectory = group.members[0]?.workingDirectory ?? "";
    let seedInput: string | null = null;
    if (carryContext) {
      // Read the CLI you are leaving and hand its conversation to the new one.
      const sourceId = activeMemberId(group);
      try {
        const transcript = await agents.exportTranscript(sourceId);
        if (transcript) {
          seedInput = t("terminal.handoff.frame", { transcript });
        }
      } catch {
        // No transcript available; fall through to a clean launch.
      }
    }
    try {
      const session = await agents.launch({
        definitionId: definition.id,
        label: "",
        executable: "",
        arguments: [],
        resumeSessionId: null,
        groupId: group.groupId,
        seedInput,
        workingDirectory,
        cols: 80,
        rows: 24,
      });
      selectMember(group.groupId, session.sessionId);
    } catch {
      // A failed launch leaves the current CLIs untouched.
    }
  }

  // Collapse agent CLIs that share a groupId into one tab, first-seen order.
  const agentGroups: { groupId: string; members: AgentSessionSummary[] }[] = [];
  const groupIndex = new Map<string, number>();
  for (const session of agents.sessions) {
    const gid = session.groupId || session.sessionId;
    const existing = groupIndex.get(gid);
    if (existing === undefined) {
      groupIndex.set(gid, agentGroups.length);
      agentGroups.push({ groupId: gid, members: [session] });
    } else {
      agentGroups[existing].members.push(session);
    }
  }

  const activeMemberId = (group: {
    groupId: string;
    members: AgentSessionSummary[];
  }): string => {
    if (
      activeSessionId &&
      group.members.some((member) => member.sessionId === activeSessionId)
    ) {
      return activeSessionId;
    }
    const remembered = activeMemberByGroup[group.groupId];
    if (remembered && group.members.some((m) => m.sessionId === remembered)) {
      return remembered;
    }
    return group.members[0].sessionId;
  };

  const sessions: SessionRef[] = [
    ...agentGroups.map((group) => {
      const memberId = activeMemberId(group);
      const member =
        group.members.find((entry) => entry.sessionId === memberId) ??
        group.members[0];
      return {
        kind: "agent" as const,
        sessionId: memberId,
        label: member.groupLabel,
        groupId: group.groupId,
        members: group.members,
      };
    }),
    ...ssh.sessions.map((session) => ({
      kind: "ssh" as const,
      sessionId: session.sessionId,
      profileId: session.profileId,
      label: `${session.username}@${session.host}`,
    })),
    ...sftp.sessions
      .filter((session) => !pairedSftpIds.has(session.sessionId))
      .map((session) => ({
        kind: "sftp" as const,
        sessionId: session.sessionId,
        profileId: session.profileId,
        label: `${session.username}@${session.host}`,
      })),
    ...remote.sessions.map((session) => ({
      kind: "remote" as const,
      sessionId: session.sessionId,
      profileId: session.profileId,
      label: session.agentName,
    })),
    ...rdp.sessions.map((session) => ({
      kind: "rdp" as const,
      sessionId: session.sessionId,
      profileId: session.profileId,
      label: `${session.username}@${session.host}`,
    })),
    ...vnc.sessions.map((session) => ({
      kind: "vnc" as const,
      sessionId: session.sessionId,
      profileId: session.profileId,
      label: `${session.host}:${session.port}`,
    })),
  ];

  const closedNotices: ClosedNoticeSource[] = [];
  if (agents.lastClosed) {
    closedNotices.push({
      notice: agents.lastClosed,
      clear: agents.clearLastClosed,
    });
  }
  if (ssh.lastClosed) {
    closedNotices.push({ notice: ssh.lastClosed, clear: ssh.clearLastClosed });
  }
  if (remote.lastClosed) {
    closedNotices.push({
      notice: remote.lastClosed,
      clear: remote.clearLastClosed,
    });
  }
  if (rdp.lastClosed) {
    closedNotices.push({ notice: rdp.lastClosed, clear: rdp.clearLastClosed });
  }
  if (vnc.lastClosed) {
    closedNotices.push({ notice: vnc.lastClosed, clear: vnc.clearLastClosed });
  }
  const latestClosed = closedNotices.sort(
    (left, right) => right.notice.at - left.notice.at,
  )[0];
  const closedCallout = latestClosed ? (
    <div className="session-notice">
      <Callout
        tone="warn"
        title={t("terminal.sessionClosed.title")}
        actions={
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={latestClosed.clear}
          >
            {t("common.close")}
          </button>
        }
      >
        {t("terminal.sessionClosed.body", {
          name: latestClosed.notice.label,
          reason: latestClosed.notice.reason,
        })}
      </Callout>
    </div>
  ) : null;

  async function launchNewProject(definition: AgentDefinition) {
    if (!newProjectDirectory) return;
    setLaunchingProjectCli(definition.id);
    setNewProjectError(null);
    try {
      const launched = await agents.launch({
        definitionId: definition.id,
        label: "",
        executable: "",
        arguments: [],
        resumeSessionId: null,
        groupId: null,
        seedInput: null,
        workingDirectory: newProjectDirectory,
        cols: 120,
        rows: 32,
      });
      setNewProjectDirectory(null);
      onSelect(launched.sessionId);
    } catch (reason) {
      setNewProjectError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLaunchingProjectCli(null);
    }
  }

  const newProjectDialog = newProjectDirectory ? (
    <div
      className="scrim scrim--center"
      role="presentation"
      onMouseDown={closeNewProjectDialog}
    >
      <div
        className="dialog dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog__head">
          <span className="dialog__icon dialog__icon--inline" aria-hidden="true">
            <FolderIcon size={18} />
          </span>
          <h2 className="dialog__title" id="new-project-title">
            {t("terminal.projects.launchTitle")}
          </h2>
        </header>
        <div className="dialog__stack">
          <div>
            <span className="field__label">{t("terminal.projects.directory")}</span>
            <p className="dialog__body mono project-launcher__path">
              {newProjectDirectory}
            </p>
          </div>
          <div>
            <span className="field__label">{t("terminal.projects.cli")}</span>
            <div className="project-launcher__cli-list">
              {installedAgents.map((definition) => (
                <button
                  key={definition.id}
                  type="button"
                  className="button button--ghost project-launcher__cli"
                  disabled={launchingProjectCli !== null}
                  onClick={() => void launchNewProject(definition)}
                >
                  <AgentIcon size={15} />
                  <span>{definition.label}</span>
                  {launchingProjectCli === definition.id && (
                    <span className="project-launcher__status">
                      {t("terminal.projects.launching")}
                    </span>
                  )}
                </button>
              ))}
              {installedAgents.length === 0 && (
                <p className="dialog__body">{t("terminal.addCli.none")}</p>
              )}
            </div>
          </div>
          {newProjectError && (
            <Callout tone="danger" title={t("terminal.projects.launchFailed")}>
              <span className="mono">{newProjectError}</span>
            </Callout>
          )}
          <div className="dialog__actions">
            <button
              type="button"
              className="button button--ghost"
              disabled={launchingProjectCli !== null}
              onClick={closeNewProjectDialog}
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  const relocationSummary = relocation
    ? summarizeAgentRelocation(relocation.session.members, agents.catalog)
    : null;
  const relocationDialog = relocation && relocationSummary ? (
    <AgentSessionRelocationDialog
      name={relocation.session.label}
      sessionCount={relocation.session.members.length}
      fromDirectory={relocation.fromDirectory}
      toDirectory={relocation.toDirectory}
      summary={relocationSummary}
      busy={relocating}
      error={relocationError}
      onConfirm={() => void confirmRelocation()}
      onCancel={() => setRelocation(null)}
    />
  ) : null;

  const active =
    sessions.find((session) => session.sessionId === activeSessionId) ??
    sessions[0] ??
    null;
  // Live host readings for the active SSH tab, polled only while its files
  // sidebar is on screen.
  const activeSshSessionId =
    active?.kind === "ssh" && filesOpen[active.sessionId]
      ? active.sessionId
      : null;
  const sshHostMetrics = useSessionHostMetrics(activeSshSessionId);
  const projectMap = new Map<string, SessionProject>();
  for (const session of sessions) {
    const id = projectIdForSession(session);
    const existing = projectMap.get(id);
    if (existing) {
      existing.sessions.push(session);
      continue;
    }
    const workingDirectory =
      session.kind === "agent"
        ? session.members[0]?.workingDirectory ?? null
        : null;
    const isGeneralChat =
      !!workingDirectory &&
      !!homeDirectory &&
      normalizeDirectory(workingDirectory) === normalizeDirectory(homeDirectory);
    projectMap.set(id, {
      id,
      label: workingDirectory
        ? isGeneralChat
          ? t("terminal.projects.generalChat")
          : localProjectLabel(workingDirectory)
        : t("terminal.projects.remote"),
      workingDirectory,
      sessions: [session],
    });
  }
  const projects = [...projectMap.values()];
  const activeProjectId = active ? projectIdForSession(active) : null;
  const activeProject =
    projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? null;
  const sidebarProjects: SessionSidebarProjectItem[] = projects.map((project) => ({
    nodeId: sidebarProjectNodeId(project.id),
    projectId: project.id,
    label: project.label,
    workingDirectory: project.workingDirectory,
    sessions: project.sessions.map((session) => ({
      nodeId: sidebarSessionNodeId(session),
      sessionId: session.sessionId,
      label: session.label,
      kind: session.kind,
      searchText:
        session.kind === "agent"
          ? session.members
              .flatMap((member) => [
                member.label,
                member.definitionId,
                member.model ?? "",
              ])
              .join(" ")
          : session.label,
      status:
        session.kind === "agent"
          ? agentGroupSidebarStatus(session.members)
          : "connected",
    })),
  }));
  const liveSidebarNodes: LiveSessionSidebarNode[] = sidebarProjects.flatMap(
    (project) => [
      { id: project.nodeId, defaultParentId: null },
      ...project.sessions.map((session) => ({
        id: session.nodeId,
        defaultParentId: project.nodeId,
      })),
    ],
  );
  const reconciledSidebarLayout = reconcileSessionSidebarLayout(
    sidebarLayout,
    liveSidebarNodes,
  );
  const liveSidebarKey = liveSidebarNodes
    .map((node) => `${node.id}>${node.defaultParentId ?? "root"}`)
    .join("|");
  useEffect(() => {
    if (!sessionRestoreComplete) return;
    setSidebarLayout((current) => {
      const next = reconcileSessionSidebarLayout(current, liveSidebarNodes);
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  }, [liveSidebarKey, sessionRestoreComplete]);
  useEffect(() => {
    if (!sessionRestoreComplete) return;
    try {
      saveSessionSidebarLayout(window.localStorage, sidebarLayout);
    } catch {
      // Sidebar organization is a convenience and must not interrupt sessions.
    }
  }, [sessionRestoreComplete, sidebarLayout]);

  function openFolderEditor(
    parentId: string | null,
    folder: SessionSidebarFolder | null = null,
  ) {
    setFolderDraft(folder?.name ?? "");
    setFolderEditor({ parentId, folder });
  }

  function saveFolder() {
    if (!folderEditor || !folderDraft.trim()) return;
    if (folderEditor.folder) {
      setSidebarLayout(
        renameSessionSidebarFolder(
          reconciledSidebarLayout,
          folderEditor.folder.id,
          folderDraft,
        ),
      );
    } else {
      const suffix =
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setSidebarLayout(
        createSessionSidebarFolder(
          reconciledSidebarLayout,
          { id: `folder:${suffix}`, name: folderDraft },
          folderEditor.parentId,
        ),
      );
    }
    setFolderEditor(null);
  }

  const folderDialog = folderEditor ? (
    <div
      className="scrim scrim--center"
      role="presentation"
      onMouseDown={() => setFolderEditor(null)}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-folder-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog__head">
          <span className="dialog__icon dialog__icon--inline" aria-hidden="true">
            <FolderIcon size={17} />
          </span>
          <h2 className="dialog__title" id="session-folder-title">
            {t(
              folderEditor.folder
                ? "terminal.projects.folderRename"
                : "terminal.projects.folderTitle",
            )}
          </h2>
        </header>
        <form
          className="dialog__stack"
          onSubmit={(event) => {
            event.preventDefault();
            saveFolder();
          }}
        >
          <label className="field">
            <span className="field__label">{t("terminal.projects.folderName")}</span>
            <input
              className="input"
              autoFocus
              maxLength={80}
              value={folderDraft}
              onChange={(event) => setFolderDraft(event.currentTarget.value)}
              placeholder={t("terminal.projects.folderNamePlaceholder")}
            />
          </label>
          <div className="dialog__actions">
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setFolderEditor(null)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="button button--primary"
              disabled={!folderDraft.trim()}
            >
              {t(
                folderEditor.folder
                  ? "terminal.projects.folderSave"
                  : "terminal.projects.folderCreate",
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  ) : null;

  const workspaceImportClassification = workspaceImport
    ? classifyWorkspaceImport(workspaceImport)
    : null;
  const workspaceImportDialog =
    workspaceImport && workspaceImportClassification ? (
      <WorkspaceImportDialog
        transfer={workspaceImport}
        unavailableCount={workspaceImportClassification.unavailableCount}
        existingCount={workspaceImportClassification.existingCount}
        busy={importingWorkspace}
        error={workspaceImportError}
        onConfirm={() => void confirmWorkspaceImport()}
        onCancel={() => {
          if (importingWorkspace) return;
          setWorkspaceImport(null);
          setWorkspaceImportError(null);
        }}
      />
    ) : null;
  const workspaceFilePicker = (
    <input
      ref={workspaceImportInputRef}
      type="file"
      accept=".json,application/json"
      className="visually-hidden"
      tabIndex={-1}
      onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file) void readWorkspaceImport(file);
      }}
    />
  );
  const workspaceTransferCallout = workspaceTransferNotice ? (
    <div className="session-notice">
      <Callout
        tone={workspaceTransferNotice.tone}
        title={workspaceTransferNotice.title}
        actions={
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={() => setWorkspaceTransferNotice(null)}
          >
            {t("common.close")}
          </button>
        }
      >
        {workspaceTransferNotice.body}
      </Callout>
    </div>
  ) : null;
  const clearWorkspaceDialog = pendingClearWorkspace ? (
    <ConfirmDialog
      title={t("terminal.projects.clearTitle")}
      body={t("terminal.projects.clearBody", {
        sessions: agents.sessions.length,
      })}
      confirmLabel={t(
        clearingWorkspace
          ? "terminal.projects.clearing"
          : "terminal.projects.clearAction",
      )}
      cancelLabel={t("common.cancel")}
      confirmDisabled={clearingWorkspace}
      onCancel={() => {
        if (!clearingWorkspace) setPendingClearWorkspace(false);
      }}
      onConfirm={() => {
        if (!clearingWorkspace) void clearWorkspaceItems();
      }}
    />
  ) : null;

  if (!active || !activeProject) {
    return (
      <div className="terminal-workspace">
        {workspaceFilePicker}
        {closedCallout}
        {workspaceTransferCallout}
        {newProjectError && !newProjectDialog && (
          <div className="session-notice">
            <Callout tone="danger" title={t("terminal.projects.chooseFailed")}>
              <span className="mono">{newProjectError}</span>
            </Callout>
          </div>
        )}
        <EmptyState
          icon={<TerminalIcon size={26} />}
          title={t("terminal.empty.title")}
          description={t("terminal.empty.body")}
          actions={
            <>
              <button
                type="button"
                className="button button--primary"
                disabled={choosingProject}
                onClick={() => void chooseProjectDirectory()}
              >
                <FolderIcon size={14} />
                {t(
                  choosingProject
                    ? "terminal.projects.choosing"
                    : "terminal.projects.add",
                )}
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => workspaceImportInputRef.current?.click()}
              >
                <ImportIcon size={14} />
                {t("terminal.projects.import")}
              </button>
              {homeDirectory && installedAgents.length > 0 && (
                  <div className="terminal-empty-quick">
                    <small>{t("terminal.empty.quickChat")}</small>
                    <div className="terminal-empty-quick__list">
                      {installedAgents.map((definition) => (
                          <button
                            type="button"
                            className="button button--ghost button--sm"
                            key={definition.id}
                            onClick={() => void launchQuickChat(definition)}
                          >
                            <AgentIcon size={12} />
                            {definition.label}
                          </button>
                        ))}
                    </div>
                  </div>
                )}
            </>
          }
        />
        {newProjectDialog}
        {folderDialog}
        {workspaceImportDialog}
        {clearWorkspaceDialog}
      </div>
    );
  }

  async function launchQuickChat(definition: AgentDefinition) {
    try {
      const home = homeDirectory ?? (await homeDir());
      const launched = await agents.launch({
        definitionId: definition.id,
        label: "",
        executable: "",
        arguments: [],
        resumeSessionId: null,
        groupId: null,
        seedInput: null,
        workingDirectory: home,
        cols: 120,
        rows: 32,
      });
      onSelect(launched.sessionId);
    } catch {
      // A failed quick chat leaves the workspace untouched.
    }
  }

  async function closeAgentMember(
    members: AgentSessionSummary[],
    sessionId: string,
  ) {
    await agents.disconnect(sessionId);
    // Closing the visible CLI hands focus to a sibling if the tab still has
    // one, so the whole tab only disappears once its last CLI is gone.
    if (sessionId === active.sessionId) {
      const sibling = members.find((member) => member.sessionId !== sessionId);
      onSelect(sibling?.sessionId ?? null);
    }
  }

  async function close(session: SessionRef) {
    if (session.kind === "agent") {
      await closeAgentMember(session.members, session.sessionId);
      return;
    }
    if (session.kind === "ssh") await ssh.disconnect(session.sessionId);
    else if (session.kind === "sftp") await sftp.disconnect(session.sessionId);
    else if (session.kind === "remote") await remote.disconnect(session.sessionId);
    else if (session.kind === "rdp") await rdp.disconnect(session.sessionId);
    else await vnc.disconnect(session.sessionId);
    if (session.sessionId === active.sessionId) onSelect(null);
  }

  async function removeSession(session: SessionRef) {
    if (session.kind !== "agent") {
      await close(session);
      return;
    }
    const wasActive = session.members.some(
      (member) => member.sessionId === active.sessionId,
    );
    await disconnectAgentSessionMembers(
      session.members.map((member) => member.sessionId),
      agents.disconnect,
    );
    if (wasActive) onSelect(null);
  }

  return (
    <div className="terminal-workspace">
      {workspaceFilePicker}
      {closedCallout}
      {workspaceTransferCallout}
      {relocationNotice && (
        <div className="session-notice">
          <Callout
            tone="warn"
            title={t("terminal.directory.partialCloseTitle")}
            actions={
              <button
                type="button"
                className="button button--ghost button--sm"
                onClick={() => setRelocationNotice(null)}
              >
                {t("common.close")}
              </button>
            }
          >
            {relocationNotice}
          </Callout>
        </div>
      )}
      {relocationError && !relocation && (
        <div className="session-notice">
          <Callout
            tone="danger"
            title={t("terminal.directory.failedTitle")}
            actions={
              <button
                type="button"
                className="button button--ghost button--sm"
                onClick={() => setRelocationError(null)}
              >
                {t("common.close")}
              </button>
            }
          >
            <span className="mono">{relocationError}</span>
          </Callout>
        </div>
      )}
      <div className="terminal-workspace__body">
        {mobileTreeOpen && (
          <div
            className="session-projects-scrim"
            role="presentation"
            onClick={() => setMobileTreeOpen(false)}
          />
        )}
        <SessionProjectSidebar
          projects={sidebarProjects}
          layout={reconciledSidebarLayout}
          activeSessionId={active.sessionId}
          choosingProject={choosingProject}
          chooseError={Boolean(newProjectError && !newProjectDialog)}
          installedAgents={installedAgents}
          mobileOpen={mobileTreeOpen}
          onChooseProject={() => void chooseProjectDirectory()}
          onSelect={(sessionId) => {
            setMobileTreeOpen(false);
            onSelect(sessionId);
          }}
          onRemove={(sidebarSession) => {
            const session = sessions.find(
              (candidate) =>
                sidebarSessionNodeId(candidate) === sidebarSession.nodeId,
            );
            if (!session) return;
            setRemoveSessionError(null);
            setPendingRemoveSession(session);
          }}
          onQuickLaunch={(definition) => {
            setMobileTreeOpen(false);
            void launchQuickChat(definition);
          }}
          onExportWorkspace={() => {
            setMobileTreeOpen(false);
            exportWorkspaceItems();
          }}
          onImportWorkspace={() => {
            setMobileTreeOpen(false);
            workspaceImportInputRef.current?.click();
          }}
          onClearWorkspace={() => {
            setMobileTreeOpen(false);
            setPendingClearWorkspace(true);
          }}
          onCreateFolder={(parentId) => openFolderEditor(parentId)}
          onRenameFolder={(folder) =>
            openFolderEditor(
              reconciledSidebarLayout.placements[folder.id]?.parentId ?? null,
              folder,
            )
          }
          onDeleteFolder={setPendingDeleteFolder}
          onToggleFolder={(folderId) =>
            setSidebarLayout(
              toggleSessionSidebarFolder(reconciledSidebarLayout, folderId),
            )
          }
          onMove={(nodeId, parentId, beforeNodeId) =>
            setSidebarLayout(
              moveSessionSidebarNode(
                reconciledSidebarLayout,
                nodeId,
                parentId,
                beforeNodeId,
              ),
            )
          }
        />

        <section className="terminal-project-workspace">
          {(() => {
            const ActiveGlyph =
              active.kind === "agent"
                ? AgentIcon
                : active.kind === "ssh"
                  ? TerminalIcon
                  : active.kind === "sftp"
                    ? TransferIcon
                    : ScreenShareIcon;
            return (
              <header className="session-header">
                <button
                  type="button"
                  className="icon-button icon-button--sm session-header__tree-toggle"
                  onClick={() => setMobileTreeOpen(true)}
                  aria-label={t("terminal.projects")}
                  title={t("terminal.projects")}
                >
                  <FolderIcon size={14} />
                </button>
                <div className="session-header__crumbs">
                  <span
                    className="session-header__project truncate"
                    title={activeProject.workingDirectory ?? activeProject.label}
                  >
                    {activeProject.label}
                  </span>
                  <span className="session-header__sep" aria-hidden="true">
                    ›
                  </span>
                  {editingTab === active.sessionId ? (
                    <span className="session-header__label">
                      <ActiveGlyph size={13} />
                      <input
                        className="session-header__rename"
                        value={tabDraft}
                        autoFocus
                        maxLength={80}
                        onChange={(event) => setTabDraft(event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void commitRename(active.sessionId);
                          else if (event.key === "Escape") setEditingTab(null);
                        }}
                        onBlur={() => void commitRename(active.sessionId)}
                        aria-label={t("terminal.rename")}
                      />
                    </span>
                  ) : (
                    <span
                      className="session-header__label"
                      onDoubleClick={
                        active.kind === "agent"
                          ? () => beginRename(active.sessionId, active.label)
                          : undefined
                      }
                      title={active.kind === "agent" ? t("terminal.renameHint") : undefined}
                    >
                      <ActiveGlyph size={13} />
                      <span className="truncate">{active.label}</span>
                    </span>
                  )}
                </div>
                <div className="session-header__actions">
                  {active.kind === "agent" && editingTab !== active.sessionId && (
                    <>
                      <button
                        type="button"
                        className="icon-button icon-button--sm"
                        disabled={choosingRelocation}
                        onClick={() => void chooseRelocationDirectory(active)}
                        aria-label={t("terminal.directory.change")}
                        data-tooltip={t("terminal.directory.change")}
                      >
                        <FolderIcon size={12} />
                      </button>
                      <button
                        type="button"
                        className="icon-button icon-button--sm"
                        onClick={() => beginRename(active.sessionId, active.label)}
                        aria-label={t("terminal.rename")}
                        data-tooltip={t("terminal.rename")}
                      >
                        <EditIcon size={12} />
                      </button>
                    </>
                  )}
                  {active.kind === "ssh" && (
                    <button
                      type="button"
                      className={`icon-button icon-button--sm session-header__files-button${
                        filesOpen[active.sessionId] ? " is-active" : ""
                      }`}
                      onClick={() => void toggleFiles(active.sessionId)}
                      aria-pressed={!!filesOpen[active.sessionId]}
                      aria-label={t("terminal.openFiles")}
                      data-tooltip={t("terminal.openFiles")}
                    >
                      <FolderIcon size={12} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-button icon-button--sm"
                    onClick={() => void close(active)}
                    aria-label={t("terminal.disconnect")}
                    data-tooltip={t("terminal.disconnect")}
                  >
                    <CloseIcon size={12} />
                  </button>
                </div>
              </header>
            );
          })()}

          <div className="terminal-stack">
        {agentGroups.map((group) => {
          const memberId = activeMemberId(group);
          const runningCount = group.members.filter(
            (member) => member.state === "working",
          ).length;
          const groupActive = group.members.some(
            (member) => member.sessionId === active.sessionId,
          );
          const installed = installedAgents;
          return (
            <div
              className="terminal-slot terminal-slot--cli"
              key={group.groupId}
              hidden={!groupActive}
            >
              <div
                className="cli-switch"
                role="tablist"
                aria-label={t("terminal.cliSwitch")}
              >
                {group.members.map((member) => {
                  const selected = member.sessionId === memberId;
                  const memberStatus = agentGroupSidebarStatus([member]);
                  const memberStatusLabel =
                    memberStatus === "working"
                      ? t("terminal.projects.status.working")
                      : memberStatus === "attention"
                        ? t("terminal.projects.status.attention")
                        : memberStatus === "done"
                          ? t("terminal.projects.status.done")
                          : memberStatus === "idle"
                            ? t("terminal.projects.status.idle")
                            : null;
                  return (
                    <span
                      key={member.sessionId}
                      className={`cli-switch__pill${selected ? " is-active" : ""}`}
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        className="cli-switch__select"
                        onClick={() =>
                          selectMember(group.groupId, member.sessionId)
                        }
                      >
                        {memberStatusLabel && (
                          <span
                            className={`cli-switch__status status-${memberStatus}`}
                            title={memberStatusLabel}
                            aria-label={memberStatusLabel}
                          />
                        )}
                        <AgentIcon size={12} />
                        <span className="cli-switch__identity">
                          <span className="truncate">{member.label}</span>
                          <span className="cli-switch__model truncate">
                            {member.model ?? t("terminal.model.pending")}
                          </span>
                        </span>
                      </button>
                      {group.members.length > 1 && (
                        <button
                          type="button"
                          className="cli-switch__close"
                          onClick={() =>
                            void closeAgentMember(group.members, member.sessionId)
                          }
                          aria-label={t("terminal.disconnect")}
                        >
                          <CloseIcon size={10} />
                        </button>
                      )}
                    </span>
                  );
                })}
                <div className="cli-switch__add-wrap">
                  <button
                    type="button"
                    className="cli-switch__add"
                    onClick={() =>
                      setAddCliFor((current) =>
                        current === group.groupId ? null : group.groupId,
                      )
                    }
                    aria-haspopup="menu"
                    aria-expanded={addCliFor === group.groupId}
                  >
                    <PlusIcon size={12} />
                    <span>{t("terminal.addCli")}</span>
                  </button>
                  {addCliFor === group.groupId &&
                    (() => {
                      const source = group.members.find(
                        (member) => member.sessionId === memberId,
                      );
                      const canCarry = agents.catalog.some(
                        (definition) =>
                          definition.id === source?.definitionId &&
                          definition.transcriptSupported,
                      );
                      const carry = canCarry && carryContext;
                      return (
                        <div className="cli-switch__menu" role="menu">
                          {canCarry ? (
                            <label className="cli-switch__carry">
                              <input
                                type="checkbox"
                                checked={carryContext}
                                onChange={(event) =>
                                  setCarryContext(event.currentTarget.checked)
                                }
                              />
                              <span>{t("terminal.handoff.carry")}</span>
                            </label>
                          ) : (
                            <span className="cli-switch__menu-empty">
                              {t("terminal.handoff.unsupported")}
                            </span>
                          )}
                          <div className="cli-switch__menu-sep" />
                          {installed.map((definition) => (
                            <button
                              key={definition.id}
                              type="button"
                              role="menuitem"
                              className="cli-switch__menu-item"
                              onClick={() => void addCli(group, definition, carry)}
                            >
                              {definition.label}
                            </button>
                          ))}
                          {installed.length === 0 && (
                            <span className="cli-switch__menu-empty">
                              {t("terminal.addCli.none")}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                </div>
                {group.members.length > 1 && (
                  <span className="cli-switch__summary">
                    {t("terminal.cliSummary", {
                      count: group.members.length,
                      running: runningCount,
                    })}
                  </span>
                )}
              </div>
              <div className="cli-panes">
                {group.members.map((member) => (
                  <div
                    className="cli-pane-slot"
                    key={member.sessionId}
                    hidden={member.sessionId !== memberId}
                  >
                    <AgentTerminalPane
                      sessionId={member.sessionId}
                      agents={agents}
                      theme={theme}
                      onClosed={() => {
                        if (
                          shouldClearSessionSelection(
                            active.sessionId,
                            member.sessionId,
                          )
                        ) {
                          onSelect(null);
                        }
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {ssh.sessions.map((session) => {
          const isActive = session.sessionId === active.sessionId;
          const sftpId = pairedSftp[session.sessionId];
          const sftpSession = sftpId
            ? sftp.sessions.find((entry) => entry.sessionId === sftpId)
            : undefined;
          const showFiles = !!filesOpen[session.sessionId] && !!sftpSession;
          return (
            <div
              className="terminal-slot"
              key={session.sessionId}
              hidden={!isActive}
            >
              <div
                className={`ssh-split${showFiles ? " ssh-split--files" : ""}`}
              >
                {showFiles && sftpSession && (
                  <aside className="ssh-split__files">
                    <SftpPane
                      session={sftpSession}
                      sftp={sftp}
                      active={isActive}
                    />
                    {isActive && (
                      <div className="ssh-split__metrics">
                        <HostMetricsPanel
                          state={sshHostMetrics}
                          variant="compact"
                        />
                      </div>
                    )}
                  </aside>
                )}
                <div className="ssh-split__term">
                  <TerminalPane
                    sessionId={session.sessionId}
                    ssh={ssh}
                    theme={theme}
                    onClosed={() => {
                      if (
                        shouldClearSessionSelection(
                          active.sessionId,
                          session.sessionId,
                        )
                      ) {
                        onSelect(null);
                      }
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
        {sftp.sessions
          .filter((session) => !pairedSftpIds.has(session.sessionId))
          .map((session) => (
            <div
              className="terminal-slot"
              key={session.sessionId}
              hidden={session.sessionId !== active.sessionId}
            >
              <SftpPane
                session={session}
                sftp={sftp}
                active={session.sessionId === active.sessionId}
              />
            </div>
          ))}
        {remote.sessions.map((session) => (
          <div
            className="terminal-slot"
            key={session.sessionId}
            hidden={session.sessionId !== active.sessionId}
          >
            <RemotePane session={session} remote={remote} theme={theme} />
          </div>
        ))}
        {rdp.sessions.map((session) => (
          <div
            className="terminal-slot"
            key={session.sessionId}
            hidden={session.sessionId !== active.sessionId}
          >
            <RdpPane session={session} rdp={rdp} />
          </div>
        ))}
        {vnc.sessions.map((session) => (
          <div
            className="terminal-slot"
            key={session.sessionId}
            hidden={session.sessionId !== active.sessionId}
          >
            <VncPane session={session} vnc={vnc} />
          </div>
        ))}
          </div>
        </section>
      </div>
      {newProjectDialog}
      {folderDialog}
      {relocationDialog}
      {workspaceImportDialog}
      {clearWorkspaceDialog}
      {pendingDeleteFolder && (
        <ConfirmDialog
          title={t("terminal.projects.folderDeleteTitle", {
            name: pendingDeleteFolder.name,
          })}
          body={t("terminal.projects.folderDeleteBody")}
          confirmLabel={t("terminal.projects.folderDeleteAction")}
          cancelLabel={t("common.cancel")}
          onCancel={() => setPendingDeleteFolder(null)}
          onConfirm={() => {
            setSidebarLayout(
              removeSessionSidebarFolder(
                reconciledSidebarLayout,
                pendingDeleteFolder.id,
              ),
            );
            setPendingDeleteFolder(null);
          }}
        />
      )}
      {pendingRemoveSession && (
        <ConfirmDialog
          title={t("terminal.projects.sessionRemoveTitle", {
            name: pendingRemoveSession.label,
          })}
          body={
            removeSessionError
              ? t("terminal.projects.sessionRemoveFailed", {
                  detail: removeSessionError,
                })
              : t("terminal.projects.sessionRemoveBody")
          }
          confirmLabel={t("terminal.projects.sessionRemoveAction")}
          cancelLabel={t("common.cancel")}
          confirmDisabled={removingSession}
          onCancel={() => {
            if (removingSession) return;
            setPendingRemoveSession(null);
            setRemoveSessionError(null);
          }}
          onConfirm={() => {
            if (removingSession) return;
            setRemovingSession(true);
            setRemoveSessionError(null);
            void removeSession(pendingRemoveSession)
              .then(() => setPendingRemoveSession(null))
              .catch((reason) =>
                setRemoveSessionError(
                  reason instanceof Error ? reason.message : String(reason),
                ),
              )
              .finally(() => setRemovingSession(false));
          }}
        />
      )}
    </div>
  );
}
