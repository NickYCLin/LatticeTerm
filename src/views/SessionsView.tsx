/** Unified workspace for text terminals and graphical remote sessions. */

import type { RemoteApi } from "../app/useRemoteSessions";
import type { RdpApi } from "../app/useRdpSessions";
import type { AgentApi } from "../app/useAgentSessions";
import type { SshApi } from "../app/useSshSessions";
import type { SftpApi } from "../app/useSftpSessions";
import type { ThemeId } from "../app/themes";
import { useI18n } from "../i18n";
import { EmptyState } from "../components/common/Callout";
import {
  AgentIcon,
  CloseIcon,
  ScreenShareIcon,
  TerminalIcon,
  TransferIcon,
} from "../components/icons";
import { AgentTerminalPane } from "../components/agents/AgentTerminalPane";
import { RemotePane } from "../components/remote/RemotePane";
import { RdpPane } from "../components/rdp/RdpPane";
import { SftpPane } from "../components/sftp/SftpPane";
import { TerminalPane } from "../components/terminal/TerminalPane";

type SessionRef =
  | { kind: "agent"; sessionId: string; label: string }
  | { kind: "ssh"; sessionId: string; label: string }
  | { kind: "sftp"; sessionId: string; label: string }
  | { kind: "remote"; sessionId: string; label: string }
  | { kind: "rdp"; sessionId: string; label: string };

export function SessionsView({
  agents,
  ssh,
  sftp,
  remote,
  rdp,
  activeSessionId,
  onSelect,
  theme,
}: {
  agents: AgentApi;
  ssh: SshApi;
  sftp: SftpApi;
  remote: RemoteApi;
  rdp: RdpApi;
  activeSessionId: string | null;
  onSelect: (sessionId: string | null) => void;
  theme: ThemeId;
}) {
  const { t } = useI18n();
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
  ];

  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={<TerminalIcon size={26} />}
        title={t("terminal.empty.title")}
        description={t("terminal.empty.body")}
      />
    );
  }

  const active =
    sessions.find((session) => session.sessionId === activeSessionId) ?? sessions[0];

  async function close(session: SessionRef) {
    if (session.kind === "agent") await agents.disconnect(session.sessionId);
    else if (session.kind === "ssh") await ssh.disconnect(session.sessionId);
    else if (session.kind === "sftp") await sftp.disconnect(session.sessionId);
    else if (session.kind === "remote") await remote.disconnect(session.sessionId);
    else await rdp.disconnect(session.sessionId);
    if (session.sessionId === active.sessionId) onSelect(null);
  }

  return (
    <div className="terminal-workspace">
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
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                className="session-tab__label"
                onClick={() => onSelect(session.sessionId)}
              >
                <Glyph size={13} />
                <span className="truncate">{session.label}</span>
              </button>
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
              onClosed={() => onSelect(null)}
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
              onClosed={() => onSelect(null)}
            />
          </div>
        ))}
        {sftp.sessions.map((session) => (
          <div
            className="terminal-slot"
            key={session.sessionId}
            hidden={session.sessionId !== active.sessionId}
          >
            <SftpPane session={session} sftp={sftp} />
          </div>
        ))}
        {remote.sessions.map((session) => (
          <div
            className="terminal-slot"
            key={session.sessionId}
            hidden={session.sessionId !== active.sessionId}
          >
            <RemotePane session={session} />
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
      </div>
    </div>
  );
}
