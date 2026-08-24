/**
 * The workspace for open sessions: one tab per session, one live terminal.
 *
 * Panes for background sessions stay mounted and hidden rather than being torn
 * down, so switching tabs never loses scrollback or interrupts a running
 * command.
 */

import type { SshApi } from "../app/useSshSessions";
import type { ThemeId } from "../app/themes";
import { useI18n } from "../i18n/context";
import { TerminalPane } from "../components/terminal/TerminalPane";
import { EmptyState } from "../components/common/Callout";
import { CloseIcon, TerminalIcon } from "../components/icons";

export function TerminalView({
  ssh,
  activeSessionId,
  onSelect,
  theme,
}: {
  ssh: SshApi;
  activeSessionId: string | null;
  onSelect: (sessionId: string | null) => void;
  theme: ThemeId;
}) {
  const { t } = useI18n();

  if (ssh.sessions.length === 0) {
    return (
      <EmptyState
        icon={<TerminalIcon size={26} />}
        title={t("terminal.empty.title")}
        description={t("terminal.empty.body")}
      />
    );
  }

  const active =
    ssh.sessions.find((session) => session.sessionId === activeSessionId) ??
    ssh.sessions[0];

  return (
    <div className="terminal-workspace">
      <div className="session-tabs" role="tablist">
        {ssh.sessions.map((session) => {
          const selected = session.sessionId === active.sessionId;
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
                <TerminalIcon size={13} />
                <span className="truncate">
                  {session.username}@{session.host}
                </span>
              </button>
              <button
                type="button"
                className="icon-button icon-button--sm"
                onClick={() => void ssh.disconnect(session.sessionId)}
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
      </div>
    </div>
  );
}
