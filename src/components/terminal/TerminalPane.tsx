/**
 * A live terminal bound to one SSH session.
 *
 * xterm.js owns the screen; this component only moves bytes. Input goes
 * straight to the session, output arrives as events, and the remote side is
 * told whenever the pane changes size so full-screen programs such as `top` or
 * an editor lay themselves out correctly.
 */

import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { SshApi } from "../../app/useSshSessions";
import { useI18n } from "../../i18n";
import type { ThemeId } from "../../app/themes";

/** Reads the current theme's colours so the terminal matches the app. */
function themeColours(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const value = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;

  const foreground = value("--text", "#e9f1f3");
  const background = value("--surface-solid", "#161f25");

  return {
    background,
    foreground,
    cursor: value("--accent", "#5fe3b0"),
    cursorAccent: background,
    selectionBackground: value("--accent-soft", "rgba(95,227,176,0.25)"),
    black: background,
    red: value("--danger", "#ff8087"),
    green: value("--ok", "#56d9a3"),
    yellow: value("--warn", "#f2b658"),
    blue: value("--info", "#6fbcf5"),
    magenta: value("--planned", "#b09cf5"),
    cyan: value("--accent", "#5fe3b0"),
    white: foreground,
  };
}

export function TerminalPane({
  sessionId,
  ssh,
  theme,
  onClosed,
}: {
  sessionId: string;
  ssh: SshApi;
  /** Only used to re-theme the terminal when the palette changes. */
  theme: ThemeId;
  onClosed: (reason: string) => void;
}) {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  // Kept in refs so the terminal is created once per session, not on every
  // render that happens to change a callback identity.
  const sshRef = useRef(ssh);
  sshRef.current = ssh;
  // A sticky Ctrl for touch keyboards that have none: arm it, and the next
  // typed character is sent as its control code.
  const [ctrlArmed, setCtrlArmed] = useState(false);
  const ctrlArmedRef = useRef(false);
  ctrlArmedRef.current = ctrlArmed;
  const closedRef = useRef(onClosed);
  closedRef.current = onClosed;
  const messageRef = useRef("");
  messageRef.current = t("terminal.inputFailed");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const terminal = new Terminal({
      fontFamily:
        'ui-monospace, "JetBrains Mono", "Cascadia Mono", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
      theme: themeColours(),
    });

    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    fit.fit();

    termRef.current = terminal;
    fitRef.current = fit;

    // Silence here is what made a broken session look like a dead keyboard:
    // say so once, in the terminal itself, rather than dropping keystrokes.
    let inputReported = false;
    const typed = terminal.onData((rawData) => {
      let data = rawData;
      if (ctrlArmedRef.current && data.length === 1) {
        const code = data.toUpperCase().charCodeAt(0);
        if (code >= 64 && code <= 95) {
          data = String.fromCharCode(code - 64);
        }
        setCtrlArmed(false);
      }
      void sshRef.current.send(sessionId, data).catch(() => {
        if (inputReported) return;
        inputReported = true;
        terminal.write(`
[31m${messageRef.current}[0m
`);
      });
    });

    const stopData = sshRef.current.onData(sessionId, (bytes) => {
      terminal.write(bytes);
    });

    const stopClosed = sshRef.current.onClosed(sessionId, (reason) => {
      terminal.write(`\r\n\x1b[2m— ${reason} —\x1b[0m\r\n`);
      closedRef.current(reason);
    });

    // Tell the remote side the real size, both now and on every later change.
    void sshRef.current
      .resize(sessionId, terminal.cols, terminal.rows)
      .catch(() => {});

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
        void sshRef.current
          .resize(sessionId, terminal.cols, terminal.rows)
          .catch(() => {});
      } catch {
        // A pane with no layout yet cannot be measured; the next change will.
      }
    });
    observer.observe(host);

    terminal.focus();

    return () => {
      observer.disconnect();
      stopData();
      stopClosed();
      typed.dispose();
      terminal.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [sessionId]);

  // Re-colour in place rather than rebuilding, so scrollback survives a theme
  // change mid-session.
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = themeColours();
    }
  }, [theme]);

  /** Sends bytes exactly as if they had been typed. */
  function tap(sequence: string) {
    termRef.current?.input(sequence);
    termRef.current?.focus();
  }

  const keybarKeys: Array<{ label: string; sequence: string }> = [
    { label: "Esc", sequence: "" },
    { label: "Tab", sequence: "	" },
    { label: "↑", sequence: "[A" },
    { label: "↓", sequence: "[B" },
    { label: "←", sequence: "[D" },
    { label: "→", sequence: "[C" },
    { label: "|", sequence: "|" },
    { label: "-", sequence: "-" },
    { label: "~", sequence: "~" },
  ];

  return (
    <div className="terminal-pane-wrap">
      <div className="terminal-pane" ref={hostRef} />
      {/* Touch helper row: keys a software keyboard hides or lacks. Hidden on
          fine-pointer desktops by the stylesheet. */}
      <div className="terminal-keybar" role="toolbar" aria-label="terminal keys">
        <button
          type="button"
          className={`terminal-keybar__key${ctrlArmed ? " is-armed" : ""}`}
          aria-pressed={ctrlArmed}
          onClick={() => {
            setCtrlArmed((armed) => !armed);
            termRef.current?.focus();
          }}
        >
          {t("terminal.keybar.ctrl")}
        </button>
        {keybarKeys.map((key) => (
          <button
            key={key.label}
            type="button"
            className="terminal-keybar__key"
            onClick={() => tap(key.sequence)}
          >
            {key.label}
          </button>
        ))}
      </div>
    </div>
  );
}
