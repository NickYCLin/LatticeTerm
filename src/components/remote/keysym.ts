/**
 * Maps a browser keyboard event to an X11 keysym.
 *
 * The VNC and Lattice Remote panes both send keys as X11 keysyms (RFC 6143
 * §7.5.4 and the X11 keysymdef). Printable characters map to their Latin-1
 * code point or the Unicode range; named and modifier keys use fixed keysyms.
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

/** Maps one browser keyboard event to the keysym a remote server expects. */
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
