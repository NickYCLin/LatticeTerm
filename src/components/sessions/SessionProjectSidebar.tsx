import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { AgentDefinition } from "../../app/useAgentSessions";
import type { SessionSidebarStatus } from "../../app/sessionStatus";
import {
  sessionSidebarDropPlacement,
  sessionSidebarChildren,
  type SessionSidebarFolder,
  type SessionSidebarLayout,
} from "../../app/sessionSidebarLayout";
import { useI18n } from "../../i18n/context";
import type { MessageKey } from "../../i18n/messages/zh-TW";
import {
  AgentIcon,
  ChevronDownIcon,
  EditIcon,
  FolderIcon,
  PlusIcon,
  ScreenShareIcon,
  TerminalIcon,
  TransferIcon,
  TrashIcon,
} from "../icons";

export type SessionSidebarKind =
  | "agent"
  | "ssh"
  | "sftp"
  | "remote"
  | "rdp"
  | "vnc";

export interface SessionSidebarSessionItem {
  nodeId: string;
  sessionId: string;
  label: string;
  kind: SessionSidebarKind;
  status: SessionSidebarStatus;
}

export interface SessionSidebarProjectItem {
  nodeId: string;
  projectId: string;
  label: string;
  workingDirectory: string | null;
  sessions: SessionSidebarSessionItem[];
}

interface FloatingLaunchMenu {
  projectNodeId: string;
  anchor: DOMRect;
}

const statusKeys: Record<Exclude<SessionSidebarStatus, "connected">, MessageKey> = {
  working: "terminal.projects.status.working",
  attention: "terminal.projects.status.attention",
  idle: "terminal.projects.status.idle",
  done: "terminal.projects.status.done",
};

function glyphFor(kind: SessionSidebarKind) {
  if (kind === "agent") return AgentIcon;
  if (kind === "sftp") return TransferIcon;
  if (kind === "ssh") return TerminalIcon;
  return ScreenShareIcon;
}

function treeStyle(depth: number): CSSProperties {
  return { "--session-tree-depth": depth } as CSSProperties;
}

export function SessionProjectSidebar({
  projects,
  layout,
  activeSessionId,
  choosingProject,
  chooseError,
  installedAgents,
  mobileOpen = false,
  onChooseProject,
  onSelect,
  onRemove,
  onLaunch,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onToggleFolder,
  onMove,
}: {
  projects: SessionSidebarProjectItem[];
  layout: SessionSidebarLayout;
  activeSessionId: string;
  choosingProject: boolean;
  chooseError: boolean;
  installedAgents: AgentDefinition[];
  mobileOpen?: boolean;
  onChooseProject: () => void;
  onSelect: (sessionId: string) => void;
  onRemove: (session: SessionSidebarSessionItem) => void;
  onLaunch: (
    project: SessionSidebarProjectItem,
    definition: AgentDefinition,
  ) => void;
  onCreateFolder: (parentId: string | null) => void;
  onRenameFolder: (folder: SessionSidebarFolder) => void;
  onDeleteFolder: (folder: SessionSidebarFolder) => void;
  onToggleFolder: (folderId: string) => void;
  onMove: (
    nodeId: string,
    parentId: string | null,
    beforeNodeId?: string | null,
  ) => void;
}) {
  const { t } = useI18n();
  const folders = useMemo(
    () => new Map(layout.folders.map((folder) => [folder.id, folder])),
    [layout.folders],
  );
  const projectByNode = useMemo(
    () => new Map(projects.map((project) => [project.nodeId, project])),
    [projects],
  );
  const sessions = useMemo(
    () => projects.flatMap((project) => project.sessions),
    [projects],
  );
  const sessionByNode = useMemo(
    () => new Map(sessions.map((session) => [session.nodeId, session])),
    [sessions],
  );
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [dropTargetNodeId, setDropTargetNodeId] = useState<string | null>(null);
  const [launchMenu, setLaunchMenu] = useState<FloatingLaunchMenu | null>(null);
  const [movingSession, setMovingSession] =
    useState<SessionSidebarSessionItem | null>(null);
  const launchMenuRef = useRef<HTMLElement>(null);
  const menuAnchorRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!launchMenu) return;
    function close(event: PointerEvent) {
      const target = event.target as Node | null;
      if (
        target &&
        (launchMenuRef.current?.contains(target) || menuAnchorRef.current?.contains(target))
      ) {
        return;
      }
      setLaunchMenu(null);
    }
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") setLaunchMenu(null);
    }
    function reposition() {
      const anchor = menuAnchorRef.current;
      if (!anchor) {
        setLaunchMenu(null);
        return;
      }
      const bounds = anchor.getBoundingClientRect();
      setLaunchMenu((current) =>
        current ? { ...current, anchor: bounds } : null,
      );
    }
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", keydown, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", keydown, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [launchMenu]);

  useEffect(() => {
    if (!movingSession) return;
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") setMovingSession(null);
    }
    document.addEventListener("keydown", keydown, true);
    return () => document.removeEventListener("keydown", keydown, true);
  }, [movingSession]);

  const folderDestinations = useMemo(
    () =>
      layout.folders
        .map((folder) => {
          const path = [folder.name];
          const visited = new Set([folder.id]);
          let parentId = layout.placements[folder.id]?.parentId ?? null;
          while (parentId) {
            const parent = folders.get(parentId);
            if (!parent || visited.has(parent.id)) break;
            visited.add(parent.id);
            path.unshift(parent.name);
            parentId = layout.placements[parent.id]?.parentId ?? null;
          }
          return { id: folder.id, label: path.join(" / ") };
        })
        .sort((left, right) => left.label.localeCompare(right.label)),
    [folders, layout.folders, layout.placements],
  );

  function nodeKind(nodeId: string): "folder" | "project" | "session" | null {
    if (folders.has(nodeId)) return "folder";
    if (projectByNode.has(nodeId)) return "project";
    if (sessionByNode.has(nodeId)) return "session";
    return null;
  }

  function startDrag(event: DragEvent<HTMLElement>, nodeId: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/x-latticeterm-session-node", nodeId);
    // WebView2 reliably exposes text/plain during the whole drag lifecycle;
    // keep the custom type too so other browser engines stay unambiguous.
    event.dataTransfer.setData("text/plain", nodeId);
    setDraggedNodeId(nodeId);
  }

  function dragged(event: DragEvent<HTMLElement>): string | null {
    return (
      event.dataTransfer.getData("text/x-latticeterm-session-node") ||
      event.dataTransfer.getData("text/plain") ||
      draggedNodeId
    );
  }

  function dragOverNode(event: DragEvent<HTMLElement>, targetNodeId: string) {
    const sourceNodeId = dragged(event);
    if (!sourceNodeId || sourceNodeId === targetNodeId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetNodeId(targetNodeId);
  }

  function dragLeaveNode(event: DragEvent<HTMLElement>, targetNodeId: string) {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    setDropTargetNodeId((current) =>
      current === targetNodeId ? null : current,
    );
  }

  function dropOnNode(event: DragEvent<HTMLElement>, targetNodeId: string) {
    event.preventDefault();
    event.stopPropagation();
    const sourceNodeId = dragged(event);
    if (!sourceNodeId || sourceNodeId === targetNodeId) return;
    const targetKind = nodeKind(targetNodeId);
    const sourceKind = nodeKind(sourceNodeId);
    setDropTargetNodeId(null);
    // A folder/project row is an explicit container target. Requiring the
    // pointer to hit only its lower half made ordinary drops look ignored.
    const targetIsContainer =
      targetKind === "folder" ||
      (targetKind === "project" && sourceKind === "session");
    const bounds = event.currentTarget.getBoundingClientRect();
    const placement = sessionSidebarDropPlacement(
      layout,
      sourceNodeId,
      targetNodeId,
      targetIsContainer,
      event.clientY > bounds.top + bounds.height / 2,
    );
    if (!placement) return;
    onMove(sourceNodeId, placement.parentId, placement.beforeNodeId);
    if (targetIsContainer) {
      if (
        targetKind === "folder" &&
        layout.collapsedFolderIds.includes(targetNodeId)
      ) {
        onToggleFolder(targetNodeId);
      }
    }
    setDraggedNodeId(null);
  }

  function openLaunchMenu(
    event: MouseEvent<HTMLButtonElement>,
    projectNodeId: string,
  ) {
    const button = event.currentTarget;
    const anchor = button.getBoundingClientRect();
    menuAnchorRef.current = button;
    setLaunchMenu((current) =>
      current?.projectNodeId === projectNodeId
        ? null
        : { projectNodeId, anchor },
    );
  }

  function statusMark(session: SessionSidebarSessionItem) {
    if (session.status === "connected") return null;
    const label = t(statusKeys[session.status]);
    return (
      <span
        className={`session-tree__status status-${session.status}`}
        title={label}
        aria-label={label}
      >
        <span aria-hidden="true" />
        {(session.status === "done" || session.status === "attention") && label}
      </span>
    );
  }

  function renderSession(session: SessionSidebarSessionItem, depth: number) {
    const Glyph = glyphFor(session.kind);
    return (
      <div
        role="treeitem"
        className={`session-tree__session${
          session.sessionId === activeSessionId ? " is-active" : ""
        }${dropTargetNodeId === session.nodeId ? " is-drop-target" : ""}`}
        style={treeStyle(depth)}
        key={session.nodeId}
        draggable
        aria-grabbed={draggedNodeId === session.nodeId}
        onDragStart={(event) => startDrag(event, session.nodeId)}
        onDragEnd={() => {
          setDraggedNodeId(null);
          setDropTargetNodeId(null);
        }}
        onDragOver={(event) => dragOverNode(event, session.nodeId)}
        onDragLeave={(event) => dragLeaveNode(event, session.nodeId)}
        onDrop={(event) => dropOnNode(event, session.nodeId)}
      >
        <button
          type="button"
          className="session-tree__session-select"
          onClick={() => onSelect(session.sessionId)}
          title={`${session.label} · ${t("terminal.projects.dragHint")}`}
          draggable={false}
        >
          <Glyph size={12} />
          <span className="truncate">{session.label}</span>
          {statusMark(session)}
        </button>
        <span className="session-tree__session-actions">
          <button
            type="button"
            className="icon-button icon-button--sm session-tree__session-move"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              setLaunchMenu(null);
              setMovingSession(session);
            }}
            aria-label={t("terminal.projects.sessionMoveFor", {
              name: session.label,
            })}
            title={t("terminal.projects.sessionMove")}
            draggable={false}
          >
            <FolderIcon size={11} />
          </button>
          <button
            type="button"
            className="icon-button icon-button--sm icon-button--danger session-tree__session-remove"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onRemove(session);
            }}
            aria-label={t("terminal.projects.sessionRemoveFor", {
              name: session.label,
            })}
            title={t("terminal.projects.sessionRemove")}
            draggable={false}
          >
            <TrashIcon size={11} />
          </button>
        </span>
      </div>
    );
  }

  function renderProject(project: SessionSidebarProjectItem, depth: number) {
    const selected = project.sessions.some(
      (session) => session.sessionId === activeSessionId,
    );
    const menuOpen = launchMenu?.projectNodeId === project.nodeId;
    return (
      <div
        role="treeitem"
        className={`session-tree__project${selected ? " is-active" : ""}${
          dropTargetNodeId === project.nodeId ? " is-drop-target" : ""
        }`}
        style={treeStyle(depth)}
        key={project.nodeId}
        draggable
        aria-grabbed={draggedNodeId === project.nodeId}
        onDragStart={(event) => startDrag(event, project.nodeId)}
        onDragEnd={() => {
          setDraggedNodeId(null);
          setDropTargetNodeId(null);
        }}
        onDragOver={(event) => dragOverNode(event, project.nodeId)}
        onDragLeave={(event) => dragLeaveNode(event, project.nodeId)}
        onDrop={(event) => dropOnNode(event, project.nodeId)}
      >
        <button
          type="button"
          className="session-tree__project-select"
          onClick={() => project.sessions[0] && onSelect(project.sessions[0].sessionId)}
          title={project.workingDirectory ?? project.label}
        >
          <FolderIcon size={13} />
          <span className="truncate">{project.label}</span>
        </button>
        {project.workingDirectory && (
          <button
            type="button"
            className="icon-button icon-button--sm"
            onClick={(event) => openLaunchMenu(event, project.nodeId)}
            aria-label={t("terminal.projects.newSession")}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={t("terminal.projects.newSession")}
            draggable={false}
          >
            <PlusIcon size={12} />
          </button>
        )}
      </div>
    );
  }

  function renderFolder(folder: SessionSidebarFolder, depth: number) {
    const collapsed = layout.collapsedFolderIds.includes(folder.id);
    return (
      <div className="session-tree__folder" key={folder.id} role="treeitem" aria-expanded={!collapsed}>
        <div
          className={`session-tree__folder-row${
            dropTargetNodeId === folder.id ? " is-drop-target" : ""
          }`}
          style={treeStyle(depth)}
          draggable
          aria-grabbed={draggedNodeId === folder.id}
          onDragStart={(event) => startDrag(event, folder.id)}
          onDragEnd={() => {
            setDraggedNodeId(null);
            setDropTargetNodeId(null);
          }}
          onDragOver={(event) => dragOverNode(event, folder.id)}
          onDragLeave={(event) => dragLeaveNode(event, folder.id)}
          onDrop={(event) => dropOnNode(event, folder.id)}
        >
          <button
            type="button"
            className="session-tree__folder-select"
            onClick={() => onToggleFolder(folder.id)}
            title={`${folder.name} · ${t("terminal.projects.dragHint")}`}
          >
            <FolderIcon size={13} />
            <span className="truncate">{folder.name}</span>
          </button>
          <button
            type="button"
            className="icon-button icon-button--sm"
            onClick={() => onToggleFolder(folder.id)}
            aria-label={t("terminal.projects.toggle")}
            title={t("terminal.projects.toggle")}
            draggable={false}
          >
            <ChevronDownIcon size={12} className={collapsed ? "is-collapsed" : undefined} />
          </button>
          <div className="session-tree__folder-actions">
            <button
              type="button"
              className="icon-button icon-button--sm"
              onClick={() => onCreateFolder(folder.id)}
              aria-label={t("terminal.projects.addSubfolder")}
              title={t("terminal.projects.addSubfolder")}
              draggable={false}
            >
              <PlusIcon size={11} />
            </button>
            <button
              type="button"
              className="icon-button icon-button--sm"
              onClick={() => onRenameFolder(folder)}
              aria-label={t("terminal.projects.folderRename")}
              title={t("terminal.projects.folderRename")}
              draggable={false}
            >
              <EditIcon size={11} />
            </button>
            <button
              type="button"
              className="icon-button icon-button--sm icon-button--danger"
              onClick={() => onDeleteFolder(folder)}
              aria-label={t("terminal.projects.folderDelete")}
              title={t("terminal.projects.folderDelete")}
              draggable={false}
            >
              <TrashIcon size={11} />
            </button>
          </div>
        </div>
        {!collapsed && (
          <div role="group">
            {sessionSidebarChildren(layout, folder.id).map((id) => renderNode(id, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  function renderNode(nodeId: string, depth: number): ReactNode {
    const folder = folders.get(nodeId);
    if (folder) return renderFolder(folder, depth);
    const project = projectByNode.get(nodeId);
    if (project) return renderProject(project, depth);
    const session = sessionByNode.get(nodeId);
    if (session) return renderSession(session, depth);
    return null;
  }

  const launchProject = launchMenu
    ? projectByNode.get(launchMenu.projectNodeId)
    : null;
  const menuWidth = Math.min(240, Math.max(200, window.innerWidth - 24));
  const menuLeft = launchMenu
    ? launchMenu.anchor.right + 8 + menuWidth <= window.innerWidth
      ? launchMenu.anchor.right + 8
      : Math.max(12, launchMenu.anchor.left - menuWidth - 8)
    : 12;
  const menuTop = launchMenu
    ? Math.max(12, Math.min(launchMenu.anchor.top, window.innerHeight - 280))
    : 12;

  return (
    <aside
      className={`session-projects${mobileOpen ? " is-mobile-open" : ""}`}
      aria-label={t("terminal.projects")}
    >
      <div className="session-projects__title">
        <FolderIcon size={14} />
        <span>{t("terminal.projects")}</span>
        <button
          type="button"
          className="icon-button icon-button--sm session-projects__folder-add"
          onClick={() => onCreateFolder(null)}
          aria-label={t("terminal.projects.addFolder")}
          title={t("terminal.projects.addFolder")}
        >
          <FolderIcon size={11} />
          <PlusIcon size={8} />
        </button>
        <button
          type="button"
          className="icon-button icon-button--sm"
          disabled={choosingProject}
          onClick={onChooseProject}
          aria-label={t("terminal.projects.add")}
          title={t("terminal.projects.add")}
        >
          <PlusIcon size={12} />
        </button>
      </div>
      {chooseError && (
        <div className="session-projects__error" role="alert">
          {t("terminal.projects.chooseFailed")}
        </div>
      )}
      <div className="session-tree" role="tree">
        {sessionSidebarChildren(layout, null).map((id) => renderNode(id, 0))}
        <div
          className={`session-tree__root-drop${draggedNodeId ? " is-visible" : ""}`}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const sourceNodeId = dragged(event);
            if (sourceNodeId) onMove(sourceNodeId, null);
            setDraggedNodeId(null);
            setDropTargetNodeId(null);
          }}
        >
          {t("terminal.projects.moveToRoot")}
        </div>
      </div>

      {launchMenu && launchProject && launchProject.workingDirectory &&
        createPortal(
          <section
            ref={launchMenuRef}
            className="session-launch-menu"
            style={{ left: menuLeft, top: menuTop, width: menuWidth }}
            role="menu"
            aria-label={t("terminal.projects.newSession")}
          >
            <header>
              <span className="eyebrow">{t("terminal.projects.newSession")}</span>
              <strong className="truncate">{launchProject.label}</strong>
            </header>
            <div className="session-launch-menu__list">
              {installedAgents.map((definition) => (
                <button
                  type="button"
                  role="menuitem"
                  className="button button--ghost button--sm"
                  key={definition.id}
                  onClick={() => {
                    setLaunchMenu(null);
                    onLaunch(launchProject, definition);
                  }}
                >
                  <AgentIcon size={11} />
                  {definition.label}
                </button>
              ))}
              {installedAgents.length === 0 && (
                <small>{t("terminal.addCli.none")}</small>
              )}
            </div>
          </section>,
          document.body,
        )}
      {movingSession &&
        createPortal(
          <div
            className="scrim scrim--center"
            role="presentation"
            onMouseDown={() => setMovingSession(null)}
          >
            <div
              className="dialog session-move-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="session-move-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <header className="dialog__head">
                <span
                  className="dialog__icon dialog__icon--inline"
                  aria-hidden="true"
                >
                  <FolderIcon size={17} />
                </span>
                <h2 className="dialog__title" id="session-move-title">
                  {t("terminal.projects.sessionMoveTitle", {
                    name: movingSession.label,
                  })}
                </h2>
              </header>
              <div className="dialog__stack">
                <p className="dialog__body">
                  {t("terminal.projects.sessionMoveBody")}
                </p>
                <div className="session-move-dialog__destinations">
                  {[
                    {
                      id: null,
                      label: t("terminal.projects.sessionMoveRoot"),
                    },
                    ...folderDestinations,
                  ].map((destination) => {
                    const currentParentId =
                      layout.placements[movingSession.nodeId]?.parentId ?? null;
                    const current = currentParentId === destination.id;
                    return (
                      <button
                        type="button"
                        className="session-move-dialog__destination"
                        key={destination.id ?? "root"}
                        disabled={current}
                        onClick={() => {
                          onMove(movingSession.nodeId, destination.id);
                          setMovingSession(null);
                        }}
                      >
                        <FolderIcon size={13} />
                        <span className="truncate">{destination.label}</span>
                        {current && (
                          <small>{t("terminal.projects.sessionMoveCurrent")}</small>
                        )}
                      </button>
                    );
                  })}
                </div>
                {folderDestinations.length === 0 && (
                  <p className="dialog__body dialog__body--muted">
                    {t("terminal.projects.sessionMoveNoFolders")}
                  </p>
                )}
                <div className="dialog__actions">
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => setMovingSession(null)}
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </aside>
  );
}
