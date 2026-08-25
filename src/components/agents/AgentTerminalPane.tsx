import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { AgentApi } from "../../app/useAgentSessions";
import type { ThemeId } from "../../app/themes";
import { useI18n } from "../../i18n/context";
import { TerminalImeFallback } from "../terminal/terminalImeFallback";
import { terminalTheme } from "../terminal/terminalTheme";

export function AgentTerminalPane({
  sessionId,
  agents,
  theme,
  onClosed,
}: {
  sessionId: string;
  agents: AgentApi;
  theme: ThemeId;
  onClosed: (reason: string) => void;
}) {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const agentsRef = useRef(agents);
  const closedRef = useRef(onClosed);
  const errorRef = useRef(t("agents.terminal.inputFailed"));
  agentsRef.current = agents;
  closedRef.current = onClosed;
  errorRef.current = t("agents.terminal.inputFailed");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const terminal = new Terminal({
      fontFamily:
        'ui-monospace, "JetBrains Mono", "Cascadia Mono", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 10000,
      // Force a readable contrast so no CLI can paint text that blends into
      // the dark background (e.g. black-on-black input).
      minimumContrastRatio: 4.5,
      theme: terminalTheme(),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    fit.fit();
    terminalRef.current = terminal;

    let inputReported = false;
    const sendInput = (data: string) => {
      void agentsRef.current.send(sessionId, data).catch(() => {
        if (inputReported) return;
        inputReported = true;
        terminal.write(`\r\n\x1b[31m${errorRef.current}\x1b[0m\r\n`);
      });
    };
    const imeFallback = new TerminalImeFallback(sendInput);
    const typed = terminal.onData((data) => {
      imeFallback.recordTerminalData(data);
      sendInput(data);
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
    const stopData = agentsRef.current.onData(sessionId, (bytes) => {
      terminal.write(bytes);
    });
    const stopClosed = agentsRef.current.onClosed(sessionId, (reason) => {
      terminal.write(`\r\n\x1b[2m— ${reason} —\x1b[0m\r\n`);
      closedRef.current(reason);
    });

    void agentsRef.current
      .resize(sessionId, terminal.cols, terminal.rows)
      .catch(() => {});
    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
        void agentsRef.current
          .resize(sessionId, terminal.cols, terminal.rows)
          .catch(() => {});
      } catch {
        // Hidden panes cannot be measured; the next visible resize catches up.
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
      terminalRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = terminalTheme();
    }
  }, [theme]);

  return <div className="terminal-pane agent-terminal" ref={hostRef} />;
}
