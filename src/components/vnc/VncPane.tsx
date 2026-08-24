import { useCallback, useEffect, useRef } from "react";
import type { KeyboardEvent, MouseEvent, WheelEvent } from "react";
import type { VncApi, VncInput, VncSessionSummary } from "../../app/useVncSessions";
import { useI18n } from "../../i18n/context";
import { ScreenShareIcon } from "../icons";
import { CanvasCaptureControls } from "../remote/CanvasCaptureControls";
import { keysymFor } from "../remote/keysym";

export function VncPane({ session, vnc }: { session: VncSessionSummary; vnc: VncApi }) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pendingMove = useRef<VncInput | null>(null);
  const moveFrame = useRef<number | null>(null);
  const lastFrame = useRef(0);

  const send = useCallback(
    (request: VncInput) => {
      void vnc.input(session.sessionId, request).catch(() => undefined);
    },
    [vnc, session.sessionId],
  );

  useEffect(() => {
    const frame = session.frame;
    const canvas = canvasRef.current;
    if (!frame || !canvas || frame.frameId < lastFrame.current) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled || frame.frameId < lastFrame.current) return;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;
      canvas.width = frame.width;
      canvas.height = frame.height;
      context.drawImage(image, 0, 0, frame.width, frame.height);
      lastFrame.current = frame.frameId;
    };
    image.src = frame.dataUrl;
    return () => {
      cancelled = true;
    };
  }, [session.frame]);

  useEffect(
    () => () => {
      if (moveFrame.current !== null) cancelAnimationFrame(moveFrame.current);
      send({ kind: "releaseAll" });
    },
    [send],
  );

  function position(event: MouseEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(session.width - 1, Math.round(((event.clientX - bounds.left) / bounds.width) * session.width)),
      ),
      y: Math.max(
        0,
        Math.min(session.height - 1, Math.round(((event.clientY - bounds.top) / bounds.height) * session.height)),
      ),
    };
  }

  function mouseMove(event: MouseEvent<HTMLCanvasElement>) {
    const point = position(event);
    pendingMove.current = { kind: "mouseMove", ...point };
    if (moveFrame.current !== null) return;
    moveFrame.current = requestAnimationFrame(() => {
      moveFrame.current = null;
      if (pendingMove.current) send(pendingMove.current);
      pendingMove.current = null;
    });
  }

  function mouseButton(event: MouseEvent<HTMLCanvasElement>, pressed: boolean) {
    event.preventDefault();
    event.currentTarget.focus();
    send({ kind: "mouseMove", ...position(event) });
    send({ kind: "mouseButton", button: event.button, pressed });
  }

  function wheel(event: WheelEvent<HTMLCanvasElement>) {
    event.preventDefault();
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    const delta = horizontal ? event.deltaX : event.deltaY;
    if (delta === 0) return;
    send({
      kind: "wheel",
      horizontal,
      units: Math.sign(delta),
    });
  }

  function keyboard(event: KeyboardEvent<HTMLCanvasElement>, pressed: boolean) {
    const keysym = keysymFor(event.key, event.code);
    if (keysym === null) return;
    event.preventDefault();
    send({ kind: "key", keysym, pressed });
  }

  return (
    <div className="remote-pane rdp-pane">
      <div className="remote-toolbar">
        <span className="remote-toolbar__identity truncate">
          <ScreenShareIcon size={14} />
          {session.host}:{session.port}
        </span>
        <span className="remote-toolbar__resolution mono">
          {session.width} × {session.height}
        </span>
        <CanvasCaptureControls
          canvasRef={canvasRef}
          ready={session.frame !== null}
          label={session.host + ":" + String(session.port)}
        />
        <span className="badge tone-ok">{t("vnc.session.interactive")}</span>
      </div>

      <div className="remote-canvas">
        <canvas
          ref={canvasRef}
          className="rdp-canvas"
          width={session.width}
          height={session.height}
          tabIndex={0}
          role="application"
          aria-label={t("vnc.session.canvasLabel", { host: session.host })}
          onMouseMove={mouseMove}
          onMouseDown={(event) => mouseButton(event, true)}
          onMouseUp={(event) => mouseButton(event, false)}
          onMouseLeave={() => send({ kind: "releaseAll" })}
          onWheel={wheel}
          onKeyDown={(event) => keyboard(event, true)}
          onKeyUp={(event) => keyboard(event, false)}
          onBlur={() => send({ kind: "releaseAll" })}
          onContextMenu={(event) => event.preventDefault()}
        />
        {!session.frame && (
          <div className="remote-canvas__waiting">
            <span className="remote-canvas__pulse" aria-hidden="true">
              <ScreenShareIcon size={28} />
            </span>
            <strong>{t("vnc.session.waitingTitle")}</strong>
            <span>{t("vnc.session.waitingBody")}</span>
          </div>
        )}
      </div>
    </div>
  );
}
