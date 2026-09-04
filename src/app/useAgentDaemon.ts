/**
 * The background service that keeps detached Agent Fleet sessions alive
 * after the window closes.  The interface only needs to know whether it is
 * running, how many sessions it holds, and how to end it on request.
 */
import { useCallback, useEffect, useState } from "react";
import { hasDesktopBackend } from "./nativeRuntime";

export interface AgentDaemonStatus {
  running: boolean;
  sessions: number;
}

const POLL_MS = 10_000;

export function useAgentDaemon(sessionsHint: number): {
  status: AgentDaemonStatus;
  refresh: () => Promise<void>;
  stop: () => Promise<boolean>;
} {
  const [status, setStatus] = useState<AgentDaemonStatus>({ running: false, sessions: 0 });

  const refresh = useCallback(async () => {
    if (!hasDesktopBackend()) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      setStatus(await invoke<AgentDaemonStatus>("agent_daemon_status"));
    } catch {
      setStatus({ running: false, sessions: 0 });
    }
  }, []);

  // Re-read whenever the session list changes shape, and on a slow tick so
  // a daemon that exited by itself stops being shown as running.
  useEffect(() => {
    void refresh();
  }, [refresh, sessionsHint]);
  useEffect(() => {
    if (!hasDesktopBackend()) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const stop = useCallback(async () => {
    if (!hasDesktopBackend()) return false;
    const { invoke } = await import("@tauri-apps/api/core");
    const stopped = await invoke<boolean>("agent_daemon_stop");
    await refresh();
    return stopped;
  }, [refresh]);

  return { status, refresh, stop };
}
