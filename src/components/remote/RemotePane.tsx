import type { RemoteSessionSummary } from "../../app/useRemoteSessions";
import { useI18n } from "../../i18n";
import { ScreenShareIcon, ShieldIcon } from "../icons";

export function RemotePane({ session }: { session: RemoteSessionSummary }) {
  const { t } = useI18n();

  return (
    <div className="remote-pane">
      <div className="remote-toolbar">
        <span className="remote-toolbar__identity truncate">
          <ScreenShareIcon size={14} />
          {session.agentName}
        </span>
        <span className="remote-toolbar__status">
          <ShieldIcon size={13} />
          {t("remote.session.encrypted")}
        </span>
        <span className="remote-toolbar__resolution mono">
          {session.width} × {session.height}
        </span>
        <span className="badge tone-info">{t("remote.session.viewOnly")}</span>
      </div>

      <div className="remote-canvas" aria-live="polite">
        {session.frame ? (
          <img
            src={session.frame.dataUrl}
            alt={t("remote.session.frameAlt", { name: session.agentName })}
            width={session.frame.width}
            height={session.frame.height}
            draggable={false}
          />
        ) : (
          <div className="remote-canvas__waiting">
            <span className="remote-canvas__pulse" aria-hidden="true">
              <ScreenShareIcon size={28} />
            </span>
            <strong>{t("remote.session.waitingTitle")}</strong>
            <span>{t("remote.session.waitingBody")}</span>
          </div>
        )}
      </div>
    </div>
  );
}
