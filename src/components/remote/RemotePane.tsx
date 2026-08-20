import { useEffect, useRef } from "react";
import type { RemoteSessionSummary } from "../../app/useRemoteSessions";
import { useI18n } from "../../i18n";
import { ScreenShareIcon, ShieldIcon } from "../icons";
import { CanvasCaptureControls } from "./CanvasCaptureControls";

export function RemotePane({ session }: { session: RemoteSessionSummary }) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const frame = session.frame;
    const canvas = canvasRef.current;
    if (!frame || !canvas) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;
      canvas.width = frame.width;
      canvas.height = frame.height;
      context.drawImage(image, 0, 0, frame.width, frame.height);
    };
    image.src = frame.dataUrl;
    return () => {
      cancelled = true;
    };
  }, [session.frame]);

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
        <CanvasCaptureControls
          canvasRef={canvasRef}
          ready={session.frame !== null}
          label={session.agentName}
        />
        <span className="badge tone-info">{t("remote.session.viewOnly")}</span>
      </div>

      <div className="remote-canvas" aria-live="polite">
        <canvas
          ref={canvasRef}
          className="remote-frame-canvas"
          width={session.width}
          height={session.height}
          role="img"
          aria-label={t("remote.session.frameAlt", { name: session.agentName })}
        />
        {!session.frame && (
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
