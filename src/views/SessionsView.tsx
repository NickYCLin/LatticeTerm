/** Unified workspace for text terminals and graphical remote sessions. */

import { useEffect, useState } from "react";
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
import type { SshApi } from "../app/useSshSessions";
import type { SftpApi } from "../app/useSftpSessions";
import type { ThemeId } from "../app/themes";
import { useI18n } from "../i18n/context";
import { Callout, EmptyState } from "../components/common/Callout";
import {
  AgentIcon,
  CloseIcon,
  EditIcon,
  FolderIcon,
  PlusIcon,
  ScreenShareIcon,
  TerminalIcon,
  TransferIcon,
} from "../components/icons";
import { AgentTerminalPane } from "../components/agents/AgentTerminalPane";
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
  | { kind: "ssh"; sessionId: string; label: string }
  | { kind: "sftp"; sessionId: string; label: string }
  | { kind: "remote"; sessionId: string; label: string }
  | { kind: "rdp"; sessionId: string; label: string }
  | { kind: "vnc"; sessionId: string; label: string };

interface ClosedNoticeSource {
  notice: SessionClosedNotice;
  clear: () => void;
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
}) {
  const { t } = useI18n();

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
        label: member.label,
        groupId: group.groupId,
        members: group.members,
      };
    }),
    ...ssh.sessions.map((session) => ({
      kind: "ssh" as const,
      sessionId: session.sessionId,
      label: `${session.username}@${session.host}`,
    })),
    ...sftp.sessions
      .filter((session) => !pairedSftpIds.has(session.sessionId))
      .map((session) => ({
        kind: "sftp" as const,
        sessionId: session.sessionId,
        label: `${session.username}@${session.host}`,
      })),
    ...remote.sessions.map((session) => ({
      kind: "remote" as const,
      sessionId: session.sessionId,
      label: session.agentName,
    })),
    ...rdp.sessions.map((session) => ({
      kind: "rdp" as const,
      sessionId: session.sessionId,
      label: `${session.username}@${session.host}`,
    })),
    ...vnc.sessions.map((session) => ({
      kind: "vnc" as const,
      sessionId: session.sessionId,
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

  if (sessions.length === 0) {
    return (
      <div className="terminal-workspace">
        {closedCallout}
        <EmptyState
          icon={<TerminalIcon size={26} />}
          title={t("terminal.empty.title")}
          description={t("terminal.empty.body")}
        />
      </div>
    );
  }

  const active =
    sessions.find((session) => session.sessionId === activeSessionId) ?? sessions[0];

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

  return (
    <div className="terminal-workspace">
      {closedCallout}
      <div className="session-tabs" role="tablist">
        {sessions.map((session) => {
          const selected = session.sessionId === active.sessionId;
          const Glyph =
            session.kind === "agent"
              ? AgentIcon
              : session.kind === "ssh"
              ? TerminalIcon
              : session.kind === "sftp"
                ? TransferIcon
                : ScreenShareIcon;
          return (
            <div
              className={`session-tab${selected ? " is-active" : ""}`}
              key={session.sessionId}
            >
              {editingTab === session.sessionId ? (
                <span className="session-tab__label session-tab__label--editing">
                  <Glyph size={13} />
                  <input
                    className="session-tab__rename"
                    value={tabDraft}
                    autoFocus
                    maxLength={80}
                    onChange={(event) => setTabDraft(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void commitRename(session.sessionId);
                      else if (event.key === "Escape") setEditingTab(null);
                    }}
                    onBlur={() => void commitRename(session.sessionId)}
                    aria-label={t("terminal.rename")}
                  />
                </span>
              ) : (
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className="session-tab__label"
                  onClick={() => onSelect(session.sessionId)}
                  onDoubleClick={
                    session.kind === "agent"
                      ? () => beginRename(session.sessionId, session.label)
                      : undefined
                  }
                  title={session.kind === "agent" ? t("terminal.renameHint") : undefined}
                >
                  <Glyph size={13} />
                  <span className="truncate">{session.label}</span>
                </button>
              )}
              {session.kind === "agent" && editingTab !== session.sessionId && (
                <button
                  type="button"
                  className="icon-button icon-button--sm session-tab__rename-button"
                  onClick={() => beginRename(session.sessionId, session.label)}
                  aria-label={t("terminal.rename")}
                  data-tooltip={t("terminal.rename")}
                >
                  <EditIcon size={12} />
                </button>
              )}
              {session.kind === "ssh" && (
                <button
                  type="button"
                  className={`icon-button icon-button--sm session-tab__files-button${
                    filesOpen[session.sessionId] ? " is-active" : ""
                  }`}
                  onClick={() => void toggleFiles(session.sessionId)}
                  aria-pressed={!!filesOpen[session.sessionId]}
                  aria-label={t("terminal.openFiles")}
                  data-tooltip={t("terminal.openFiles")}
                >
                  <FolderIcon size={12} />
                </button>
              )}
              <button
                type="button"
                className="icon-button icon-button--sm"
                onClick={() => void close(session)}
                aria-label={t("terminal.disconnect")}
                data-tooltip={t("terminal.disconnect")}
              >
                <CloseIcon size={12} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="terminal-stack">
        {agentGroups.map((group) => {
          const memberId = activeMemberId(group);
          const groupActive = group.members.some(
            (member) => member.sessionId === active.sessionId,
          );
          const installed = agents.catalog.filter(
            (definition) => definition.installed,
          );
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
                        <AgentIcon size={12} />
                        <span className="truncate">{member.label}</span>
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
            <RemotePane session={session} remote={remote} />
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
    </div>
  );
}
