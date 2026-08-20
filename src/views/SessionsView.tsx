/** Unified workspace for text terminals and graphical remote sessions. */

import type { RemoteApi } from "../app/useRemoteSessions";
import type { RdpApi } from "../app/useRdpSessions";
import type { SshApi } from "../app/useSshSessions";
import type { ThemeId } from "../app/themes";
import { useI18n } from "../i18n";
import { EmptyState } from "../components/common/Callout";
import { CloseIcon, ScreenShareIcon, TerminalIcon } from "../components/icons";
import { RemotePane } from "../components/remote/RemotePane";
import { RdpPane } from "../components/rdp/RdpPane";
import { TerminalPane } from "../components/terminal/TerminalPane";

type SessionRef =
  | { kind: "ssh"; sessionId: string; label: string }
  | { kind: "remote"; sessionId: string; label: string }
  | { kind: "rdp"; sessionId: string; label: string };

export function SessionsView({
  ssh,
  remote,
  rdp,
  activeSessionId,
  onSelect,
  theme,
}: {
  ssh: SshApi;
  remote: RemoteApi;
  rdp: RdpApi;
  activeSessionId: string | null;
  onSelect: (sessionId: string | null) => void;
  theme: ThemeId;
}) {
  const { t } = useI18n();
  const sessions: SessionRef[] = [
    ...ssh.sessions.map((session) => ({
      kind: "ssh" as const,
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
    if (session.kind === "ssh") await ssh.disconnect(session.sessionId);
    else if (session.kind === "remote") await remote.disconnect(session.sessionId);
    else await rdp.disconnect(session.sessionId);
    if (session.sessionId === active.sessionId) onSelect(null);
  }

  return (
    <div className="terminal-workspace">
      <div className="session-tabs" role="tablist">
        {sessions.map((session) => {
          const selected = session.sessionId === active.sessionId;
          const Glyph = session.kind === "ssh" ? TerminalIcon : ScreenShareIcon;
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
