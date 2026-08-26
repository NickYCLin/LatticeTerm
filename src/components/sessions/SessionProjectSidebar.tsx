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

interface FloatingProjectCard {
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
  onChooseProject,
  onSelect,
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
  onChooseProject: () => void;
  onSelect: (sessionId: string) => void;
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
  const [projectCard, setProjectCard] = useState<FloatingProjectCard | null>(null);
  const projectCardRef = useRef<HTMLElement>(null);
  const cardAnchorRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!projectCard) return;
    function close(event: PointerEvent) {
      const target = event.target as Node | null;
      if (
        target &&
        (projectCardRef.current?.contains(target) || cardAnchorRef.current?.contains(target))
      ) {
        return;
      }
      setProjectCard(null);
    }
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") setProjectCard(null);
    }
    function reposition() {
      const anchor = cardAnchorRef.current;
      if (!anchor) {
        setProjectCard(null);
        return;
      }
      const bounds = anchor.getBoundingClientRect();
      setProjectCard((current) =>
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
  }, [projectCard]);

  function nodeKind(nodeId: string): "folder" | "project" | "session" | null {
    if (folders.has(nodeId)) return "folder";
    if (projectByNode.has(nodeId)) return "project";
    if (sessionByNode.has(nodeId)) return "session";
    return null;
  }

  function startDrag(event: DragEvent<HTMLElement>, nodeId: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/x-latticeterm-session-node", nodeId);
    setDraggedNodeId(nodeId);
  }

  function dragged(event: DragEvent<HTMLElement>): string | null {
    return (
      event.dataTransfer.getData("text/x-latticeterm-session-node") ||
      draggedNodeId
    );
  }

  function dropOnNode(event: DragEvent<HTMLElement>, targetNodeId: string) {
    event.preventDefault();
    event.stopPropagation();
    const sourceNodeId = dragged(event);
    if (!sourceNodeId || sourceNodeId === targetNodeId) return;
    const targetKind = nodeKind(targetNodeId);
    const sourceKind = nodeKind(sourceNodeId);
    const bounds = event.currentTarget.getBoundingClientRect();
    const lowerHalf = event.clientY > bounds.top + bounds.height * 0.46;
    const canNest =
      targetKind === "folder" ||
      (targetKind === "project" && sourceKind === "session");
    if (canNest && lowerHalf) {
      onMove(sourceNodeId, targetNodeId);
    } else {
      onMove(
        sourceNodeId,
        layout.placements[targetNodeId]?.parentId ?? null,
        targetNodeId,
      );
    }
    setDraggedNodeId(null);
  }

  function openProjectCard(
    event: MouseEvent<HTMLButtonElement>,
    projectNodeId: string,
  ) {
    const button = event.currentTarget;
    const anchor = button.getBoundingClientRect();
    cardAnchorRef.current = button;
    setProjectCard((current) =>
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
      <button
        type="button"
        role="treeitem"
        className={`session-tree__session${
          session.sessionId === activeSessionId ? " is-active" : ""
        }`}
        style={treeStyle(depth)}
        key={session.nodeId}
        draggable
        aria-grabbed={draggedNodeId === session.nodeId}
        onDragStart={(event) => startDrag(event, session.nodeId)}
        onDragEnd={() => setDraggedNodeId(null)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => dropOnNode(event, session.nodeId)}
        onClick={() => onSelect(session.sessionId)}
        title={`${session.label} · ${t("terminal.projects.dragHint")}`}
      >
        <Glyph size={12} />
        <span className="truncate">{session.label}</span>
        {statusMark(session)}
      </button>
    );
  }

  function renderProject(project: SessionSidebarProjectItem, depth: number) {
    const selected = project.sessions.some(
      (session) => session.sessionId === activeSessionId,
    );
    const cardOpen = projectCard?.projectNodeId === project.nodeId;
    return (
      <div
        role="treeitem"
        aria-expanded={cardOpen}
        className={`session-tree__project${selected ? " is-active" : ""}`}
        style={treeStyle(depth)}
        key={project.nodeId}
        draggable
        aria-grabbed={draggedNodeId === project.nodeId}
        onDragStart={(event) => startDrag(event, project.nodeId)}
        onDragEnd={() => setDraggedNodeId(null)}
        onDragOver={(event) => event.preventDefault()}
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
        <button
          type="button"
          className="icon-button icon-button--sm"
          onClick={(event) => openProjectCard(event, project.nodeId)}
          aria-label={t("terminal.projects.sessionCard", { name: project.label })}
          aria-expanded={cardOpen}
          title={t("terminal.projects.sessionCard", { name: project.label })}
          draggable={false}
        >
          <ChevronDownIcon size={12} className={cardOpen ? "is-open" : undefined} />
        </button>
        {project.workingDirectory && (
          <button
            type="button"
            className="icon-button icon-button--sm"
            onClick={(event) => openProjectCard(event, project.nodeId)}
            aria-label={t("terminal.projects.newSession")}
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
          className="session-tree__folder-row"
          style={treeStyle(depth)}
          draggable
          aria-grabbed={draggedNodeId === folder.id}
          onDragStart={(event) => startDrag(event, folder.id)}
          onDragEnd={() => setDraggedNodeId(null)}
          onDragOver={(event) => event.preventDefault()}
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

  const floatingProject = projectCard
    ? projectByNode.get(projectCard.projectNodeId)
    : null;
  const cardSessions = floatingProject
    ? sessionSidebarChildren(layout, floatingProject.nodeId)
        .map((id) => sessionByNode.get(id))
        .filter((session): session is SessionSidebarSessionItem => Boolean(session))
    : [];
  const cardWidth = Math.min(320, Math.max(240, window.innerWidth - 24));
  const cardLeft = projectCard
    ? projectCard.anchor.right + 8 + cardWidth <= window.innerWidth
      ? projectCard.anchor.right + 8
      : Math.max(12, projectCard.anchor.left - cardWidth - 8)
    : 12;
  const cardTop = projectCard
    ? Math.max(12, Math.min(projectCard.anchor.top, window.innerHeight - 420))
    : 12;

  return (
    <aside className="session-projects" aria-label={t("terminal.projects")}>
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
          }}
        >
          {t("terminal.projects.moveToRoot")}
        </div>
      </div>

      {projectCard && floatingProject &&
        createPortal(
          <section
            ref={projectCardRef}
            className="session-project-card"
            style={{ left: cardLeft, top: cardTop, width: cardWidth }}
            aria-label={t("terminal.projects.sessionCard", {
              name: floatingProject.label,
            })}
          >
            <header>
              <div>
                <span className="eyebrow">{t("terminal.projects")}</span>
                <strong>{floatingProject.label}</strong>
              </div>
              <FolderIcon size={16} />
            </header>
            <div className="session-project-card__sessions">
              {cardSessions.map((session) => renderSession(session, 0))}
              {cardSessions.length === 0 && (
                <span className="session-project-card__empty">
                  {t("terminal.empty.title")}
                </span>
              )}
            </div>
            {floatingProject.workingDirectory && (
              <div className="session-project-card__launch">
                <span>{t("terminal.projects.newSession")}</span>
                <div>
                  {installedAgents.map((definition) => (
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      key={definition.id}
                      onClick={() => {
                        setProjectCard(null);
                        onLaunch(floatingProject, definition);
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
              </div>
            )}
          </section>,
          document.body,
        )}
    </aside>
  );
}
