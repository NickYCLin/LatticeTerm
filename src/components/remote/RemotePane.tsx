import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, WheelEvent } from "react";
import type { RemoteApi, RemoteInput, RemoteSessionSummary } from "../../app/useRemoteSessions";
import { useI18n } from "../../i18n/context";
import { FolderIcon, ScreenShareIcon, ShieldIcon } from "../icons";
import { CanvasCaptureControls } from "./CanvasCaptureControls";
import { keysymFor } from "./keysym";
import { RemoteFilesPane } from "./RemoteFilesPane";

export function RemotePane({
  session,
  remote,
}: {
  session: RemoteSessionSummary;
  remote: RemoteApi;
}) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pendingMove = useRef<RemoteInput | null>(null);
  const moveFrame = useRef<number | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const interactive = !session.viewOnly;

  const send = useCallback(
    (request: RemoteInput) => {
      if (!interactive) return;
      void remote.input(session.sessionId, request).catch(() => undefined);
    },
    [interactive, remote, session.sessionId],
  );

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

  useEffect(
    () => () => {
      if (moveFrame.current !== null) cancelAnimationFrame(moveFrame.current);
      if (interactive) send({ kind: "releaseAll" });
    },
    [interactive, send],
  );

  function position(event: MouseEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          session.width - 1,
          Math.round(((event.clientX - bounds.left) / bounds.width) * session.width),
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          session.height - 1,
          Math.round(((event.clientY - bounds.top) / bounds.height) * session.height),
        ),
      ),
    };
  }

  function mouseMove(event: MouseEvent<HTMLCanvasElement>) {
    if (!interactive) return;
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
    if (!interactive) return;
    event.preventDefault();
    event.currentTarget.focus();
    send({ kind: "mouseMove", ...position(event) });
    send({ kind: "mouseButton", button: event.button, pressed });
  }

  function wheel(event: WheelEvent<HTMLCanvasElement>) {
    if (!interactive) return;
    event.preventDefault();
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    const delta = horizontal ? event.deltaX : event.deltaY;
    if (delta === 0) return;
    send({ kind: "wheel", horizontal, units: Math.sign(delta) });
  }

  function keyboard(event: KeyboardEvent<HTMLCanvasElement>, pressed: boolean) {
    if (!interactive) return;
    const keysym = keysymFor(event.key, event.code);
    if (keysym === null) return;
    event.preventDefault();
    send({ kind: "key", keysym, pressed });
  }

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
        {session.fileTransfer && (
          <button
            type="button"
            className={`capture-button${filesOpen ? " is-active" : ""}`}
            onClick={() => setFilesOpen((current) => !current)}
            aria-pressed={filesOpen}
          >
            <FolderIcon size={13} />
            <span className="capture-button__label">{t("remote.files.toggle")}</span>
          </button>
        )}
        <span className={interactive ? "badge tone-ok" : "badge tone-info"}>
          {interactive
            ? t("remote.session.interactive")
            : t("remote.session.viewOnly")}
        </span>
      </div>

      <div className={`remote-workspace${filesOpen ? " remote-workspace--files" : ""}`}>
        {filesOpen && session.fileTransfer && (
          <aside className="remote-workspace__files">
            <RemoteFilesPane session={session} remote={remote} />
          </aside>
        )}
        <div className="remote-canvas" aria-live="polite">
          <canvas
            ref={canvasRef}
            className={
              interactive ? "remote-frame-canvas rdp-canvas" : "remote-frame-canvas"
            }
            width={session.width}
            height={session.height}
            tabIndex={interactive ? 0 : undefined}
            role={interactive ? "application" : "img"}
            aria-label={t("remote.session.frameAlt", { name: session.agentName })}
            onMouseMove={interactive ? mouseMove : undefined}
            onMouseDown={interactive ? (event) => mouseButton(event, true) : undefined}
            onMouseUp={interactive ? (event) => mouseButton(event, false) : undefined}
            onMouseLeave={interactive ? () => send({ kind: "releaseAll" }) : undefined}
            onWheel={interactive ? wheel : undefined}
            onKeyDown={interactive ? (event) => keyboard(event, true) : undefined}
            onKeyUp={interactive ? (event) => keyboard(event, false) : undefined}
            onBlur={interactive ? () => send({ kind: "releaseAll" }) : undefined}
            onContextMenu={interactive ? (event) => event.preventDefault() : undefined}
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
    </div>
  );
}
