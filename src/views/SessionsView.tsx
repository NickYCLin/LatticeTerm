/** Unified workspace for text terminals and graphical remote sessions. */

import { useState } from "react";
import type { RemoteApi } from "../app/useRemoteSessions";
import type { RdpApi } from "../app/useRdpSessions";
import type { VncApi } from "../app/useVncSessions";
import {
  shouldClearSessionSelection,
  type SessionClosedNotice,
} from "../app/sessionSnapshot";
import type { AgentApi } from "../app/useAgentSessions";
import type { SshApi } from "../app/useSshSessions";
import type { SftpApi } from "../app/useSftpSessions";
import type { ThemeId } from "../app/themes";
import { useI18n } from "../i18n/context";
import { Callout, EmptyState } from "../components/common/Callout";
import {
  AgentIcon,
  CloseIcon,
  EditIcon,
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
  | { kind: "agent"; sessionId: string; label: string }
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
  // Inline rename of a running agent tab: which session is being edited, and
  // the working text. Committing calls the persisted backend rename.
  const [editingTab, setEditingTab] = useState<string | null>(null);
  const [tabDraft, setTabDraft] = useState("");

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

  const sessions: SessionRef[] = [
    ...agents.sessions.map((session) => ({
      kind: "agent" as const,
      sessionId: session.sessionId,
      label: session.label,
    })),
    ...ssh.sessions.map((session) => ({
      kind: "ssh" as const,
      sessionId: session.sessionId,
      label: `${session.username}@${session.host}`,
    })),
    ...sftp.sessions.map((session) => ({
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

  async function close(session: SessionRef) {
    if (session.kind === "agent") await agents.disconnect(session.sessionId);
    else if (session.kind === "ssh") await ssh.disconnect(session.sessionId);
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
        {agents.sessions.map((session) => (
          <div
            className="terminal-slot"
            key={session.sessionId}
            hidden={session.sessionId !== active.sessionId}
          >
            <AgentTerminalPane
              sessionId={session.sessionId}
              agents={agents}
              theme={theme}
              onClosed={() => {
                if (
                  shouldClearSessionSelection(active.sessionId, session.sessionId)
                ) {
                  onSelect(null);
                }
              }}
            />
          </div>
        ))}
        {ssh.sessions.map((session) => (
          <div
            className="terminal-slot"
            key={session.sessionId}
            hidden={session.sessionId !== active.sessionId}
          >
            <TerminalPane
              sessionId={session.sessionId}
              ssh={ssh}
              theme={theme}
              onClosed={() => {
                if (
                  shouldClearSessionSelection(active.sessionId, session.sessionId)
                ) {
                  onSelect(null);
                }
              }}
            />
          </div>
        ))}
        {sftp.sessions.map((session) => (
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
