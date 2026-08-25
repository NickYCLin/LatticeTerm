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
import { useI18n } from "../../i18n/context";
import type { ThemeId } from "../../app/themes";
import { TerminalImeFallback } from "./terminalImeFallback";
import { terminalTheme } from "./terminalTheme";
import { attachTerminalClipboard } from "./terminalClipboard";

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
      // Force a readable contrast so no CLI can paint text that blends into
      // the dark background (e.g. black-on-black input).
      minimumContrastRatio: 4.5,
      theme: terminalTheme(),
    });

    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    fit.fit();

    termRef.current = terminal;
    fitRef.current = fit;

    attachTerminalClipboard(terminal);

    // Silence here is what made a broken session look like a dead keyboard:
    // say so once, in the terminal itself, rather than dropping keystrokes.
    let inputReported = false;
    const sendInput = (rawData: string) => {
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
        terminal.write(`\r\n\x1b[31m${messageRef.current}\x1b[0m\r\n`);
      });
    };
    const imeFallback = new TerminalImeFallback(sendInput);
    const typed = terminal.onData((rawData) => {
      imeFallback.recordTerminalData(rawData);
      sendInput(rawData);
    });
    const textarea = terminal.textarea;
    const handleInput = (event: Event) => {
      const inputEvent = event as InputEvent;
      imeFallback.recordInput(
        inputEvent.data,
        inputEvent.inputType,
        inputEvent.isComposing,
      );
    };
    textarea?.addEventListener("input", handleInput);

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
      textarea?.removeEventListener("input", handleInput);
      imeFallback.dispose();
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
      termRef.current.options.theme = terminalTheme();
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
