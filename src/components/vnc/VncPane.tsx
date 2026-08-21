import { useCallback, useEffect, useRef } from "react";
import type { KeyboardEvent, MouseEvent, WheelEvent } from "react";
import type { VncApi, VncInput, VncSessionSummary } from "../../app/useVncSessions";
import { useI18n } from "../../i18n";
import { ScreenShareIcon } from "../icons";
import { CanvasCaptureControls } from "../remote/CanvasCaptureControls";

/**
 * X11 keysyms for the keys a browser names rather than types, per RFC 6143
 * §7.5.4 and the X11 keysymdef. Printable characters are handled separately:
 * Latin-1 keysyms equal their code points, everything else is
 * `0x01000000 + code point`.
 */
const namedKeysyms: Record<string, number> = {
  Backspace: 0xff08,
  Tab: 0xff09,
  Enter: 0xff0d,
  Pause: 0xff13,
  ScrollLock: 0xff14,
  Escape: 0xff1b,
  Home: 0xff50,
  ArrowLeft: 0xff51,
  ArrowUp: 0xff52,
  ArrowRight: 0xff53,
  ArrowDown: 0xff54,
  PageUp: 0xff55,
  PageDown: 0xff56,
  End: 0xff57,
  PrintScreen: 0xff61,
  Insert: 0xff63,
  ContextMenu: 0xff67,
  NumLock: 0xff7f,
  F1: 0xffbe,
  F2: 0xffbf,
  F3: 0xffc0,
  F4: 0xffc1,
  F5: 0xffc2,
  F6: 0xffc3,
  F7: 0xffc4,
  F8: 0xffc5,
  F9: 0xffc6,
  F10: 0xffc7,
  F11: 0xffc8,
  F12: 0xffc9,
  CapsLock: 0xffe5,
  Delete: 0xffff,
};

/** Modifier keysyms depend on which side of the keyboard was pressed. */
const sidedKeysyms: Record<string, [number, number]> = {
  Shift: [0xffe1, 0xffe2],
  Control: [0xffe3, 0xffe4],
  Alt: [0xffe9, 0xffea],
  Meta: [0xffeb, 0xffec],
};

/** Maps one browser keyboard event to the keysym the VNC server expects. */
export function keysymFor(key: string, code: string): number | null {
  const sided = sidedKeysyms[key];
  if (sided) {
    return code.endsWith("Right") ? sided[1] : sided[0];
  }
  if (code === "NumpadEnter") return 0xff8d;
  const named = namedKeysyms[key];
  if (named !== undefined) return named;
  if ([...key].length === 1) {
    const codePoint = key.codePointAt(0) ?? 0;
    // Latin-1 keysyms are their code points; the rest use the Unicode range.
    return codePoint <= 0xff ? codePoint : 0x01000000 + codePoint;
  }
  return null;
}

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
