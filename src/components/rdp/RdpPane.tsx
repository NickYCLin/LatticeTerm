import { useCallback, useEffect, useRef } from "react";
import type { KeyboardEvent, MouseEvent, WheelEvent } from "react";
import type { RdpApi, RdpInput, RdpSessionSummary } from "../../app/useRdpSessions";
import { useI18n } from "../../i18n/context";
import { ScreenShareIcon, ShieldIcon } from "../icons";
import {
  CanvasSoftKeyboard,
  CanvasInputSequence,
  canvasTextTokens,
  isCanvasImeKey,
  isCanvasTextKey,
} from "../remote/CanvasSoftKeyboard";
import { CanvasCaptureControls } from "../remote/CanvasCaptureControls";

const extended = (code: number) => 0xe000 | code;

// PC/AT Set 1 scancodes used by RDP fast-path keyboard input.
const scanCodes: Record<string, number> = {
  Escape: 0x01,
  Digit1: 0x02,
  Digit2: 0x03,
  Digit3: 0x04,
  Digit4: 0x05,
  Digit5: 0x06,
  Digit6: 0x07,
  Digit7: 0x08,
  Digit8: 0x09,
  Digit9: 0x0a,
  Digit0: 0x0b,
  Minus: 0x0c,
  Equal: 0x0d,
  Backspace: 0x0e,
  Tab: 0x0f,
  KeyQ: 0x10,
  KeyW: 0x11,
  KeyE: 0x12,
  KeyR: 0x13,
  KeyT: 0x14,
  KeyY: 0x15,
  KeyU: 0x16,
  KeyI: 0x17,
  KeyO: 0x18,
  KeyP: 0x19,
  BracketLeft: 0x1a,
  BracketRight: 0x1b,
  Enter: 0x1c,
  ControlLeft: 0x1d,
  KeyA: 0x1e,
  KeyS: 0x1f,
  KeyD: 0x20,
  KeyF: 0x21,
  KeyG: 0x22,
  KeyH: 0x23,
  KeyJ: 0x24,
  KeyK: 0x25,
  KeyL: 0x26,
  Semicolon: 0x27,
  Quote: 0x28,
  Backquote: 0x29,
  ShiftLeft: 0x2a,
  Backslash: 0x2b,
  KeyZ: 0x2c,
  KeyX: 0x2d,
  KeyC: 0x2e,
  KeyV: 0x2f,
  KeyB: 0x30,
  KeyN: 0x31,
  KeyM: 0x32,
  Comma: 0x33,
  Period: 0x34,
  Slash: 0x35,
  ShiftRight: 0x36,
  NumpadMultiply: 0x37,
  AltLeft: 0x38,
  Space: 0x39,
  CapsLock: 0x3a,
  F1: 0x3b,
  F2: 0x3c,
  F3: 0x3d,
  F4: 0x3e,
  F5: 0x3f,
  F6: 0x40,
  F7: 0x41,
  F8: 0x42,
  F9: 0x43,
  F10: 0x44,
  NumLock: 0x45,
  ScrollLock: 0x46,
  Numpad7: 0x47,
  Numpad8: 0x48,
  Numpad9: 0x49,
  NumpadSubtract: 0x4a,
  Numpad4: 0x4b,
  Numpad5: 0x4c,
  Numpad6: 0x4d,
  NumpadAdd: 0x4e,
  Numpad1: 0x4f,
  Numpad2: 0x50,
  Numpad3: 0x51,
  Numpad0: 0x52,
  NumpadDecimal: 0x53,
  F11: 0x57,
  F12: 0x58,
  NumpadEnter: extended(0x1c),
  ControlRight: extended(0x1d),
  NumpadDivide: extended(0x35),
  AltRight: extended(0x38),
  Home: extended(0x47),
  ArrowUp: extended(0x48),
  PageUp: extended(0x49),
  ArrowLeft: extended(0x4b),
  ArrowRight: extended(0x4d),
  End: extended(0x4f),
  ArrowDown: extended(0x50),
  PageDown: extended(0x51),
  Insert: extended(0x52),
  Delete: extended(0x53),
  MetaLeft: extended(0x5b),
  MetaRight: extended(0x5c),
  ContextMenu: extended(0x5d),
};

export function RdpPane({ session, rdp }: { session: RdpSessionSummary; rdp: RdpApi }) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pendingMove = useRef<RdpInput | null>(null);
  const moveFrame = useRef<number | null>(null);
  const lastFrame = useRef(0);
  const keyboardInputSequence = useRef(new CanvasInputSequence());

  const send = useCallback(
    (request: RdpInput) => {
      void rdp.input(session.sessionId, request).catch(() => undefined);
    },
    [rdp, session.sessionId],
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
    send({
      kind: "wheel",
      horizontal,
      units: delta === 0 ? 0 : -Math.sign(delta) * 120,
    });
  }

  function keyboard(event: KeyboardEvent<HTMLCanvasElement>, pressed: boolean) {
    if (isCanvasImeKey(event.key, event.nativeEvent.isComposing)) return;
    const scancode = scanCodes[event.code];
    if (scancode !== undefined) {
      event.preventDefault();
      send({ kind: "key", scancode, pressed });
    } else if (isCanvasTextKey(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      send({ kind: "unicode", character: event.key, pressed });
    }
  }

  function tapKeyboardKey(_key: string, code: string): boolean {
    const scancode = scanCodes[code];
    if (scancode === undefined) return false;
    sendKeyboard({ kind: "key", scancode, pressed: true });
    sendKeyboard({ kind: "key", scancode, pressed: false });
    return true;
  }

  function sendKeyboard(request: RdpInput) {
    keyboardInputSequence.current.enqueue(() =>
      rdp.input(session.sessionId, request),
    );
  }

  function typeKeyboardText(text: string) {
    for (const token of canvasTextTokens(text)) {
      if (token.kind === "key") {
        tapKeyboardKey(token.key, token.code);
      } else {
        sendKeyboard({
          kind: "unicode",
          character: token.character,
          pressed: true,
        });
        sendKeyboard({
          kind: "unicode",
          character: token.character,
          pressed: false,
        });
      }
    }
  }

  return (
    <div className="remote-pane rdp-pane">
      <div className="remote-toolbar">
        <span className="remote-toolbar__identity truncate">
          <ScreenShareIcon size={14} />
          {session.username}@{session.host}
        </span>
        <span className="remote-toolbar__status">
          <ShieldIcon size={13} />
          {t("rdp.session.secure")}
        </span>
        <span className="remote-toolbar__resolution mono">
          {session.width} × {session.height}
        </span>
        <CanvasCaptureControls
          canvasRef={canvasRef}
          ready={session.frame !== null}
          label={session.username + "@" + session.host}
        />
        <CanvasSoftKeyboard
          buttonLabel={t("remote.keyboard.open")}
          closeButtonLabel={t("remote.keyboard.close")}
          inputLabel={t("remote.keyboard.input")}
          onText={typeKeyboardText}
          onKeyTap={tapKeyboardKey}
          onReleaseAll={() => sendKeyboard({ kind: "releaseAll" })}
        />
        <span className="badge tone-ok">{t("rdp.session.interactive")}</span>
      </div>

      <div className="remote-canvas">
        <canvas
          ref={canvasRef}
          className="rdp-canvas"
          width={session.width}
          height={session.height}
          tabIndex={0}
          role="application"
          aria-label={t("rdp.session.canvasLabel", { host: session.host })}
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
            <strong>{t("rdp.session.waitingTitle")}</strong>
            <span>{t("rdp.session.waitingBody")}</span>
          </div>
        )}
      </div>
    </div>
  );
}
