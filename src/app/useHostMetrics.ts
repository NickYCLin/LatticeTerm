/**
 * Live host resources for the selected connection.
 *
 * A reading needs an established SSH session, so the hook first finds one for
 * the profile; without one the state stays honestly `unavailable`. With one,
 * the backend probe runs immediately and then on an interval — each run takes
 * about a second, because processor usage is measured between two samples
 * rather than invented from a single glance.
 */

import { useEffect, useState } from "react";
import type { ConnectionProfile } from "../domain/connection";
import { initialMetricsState, type HostMetrics, type MetricsState } from "../domain/metrics";
import type { SessionSummary } from "./useSshSessions";

/** How often an open panel refreshes its reading. */
const REFRESH_MS = 15_000;

export function useHostMetrics(
  profile: ConnectionProfile | null,
  sessions: SessionSummary[],
): MetricsState {
  // Only SSH sessions can host the probe; the panel needs one for *this*
  // profile specifically, not any open session.
  const sessionId =
    profile && profile.protocol === "ssh"
      ? (sessions.find((session) => session.profileId === profile.id)
          ?.sessionId ?? null)
      : null;
  const supported = profile?.protocol === "ssh";
  return useSessionHostMetrics(supported ? sessionId : null, supported);
}

/**
 * Polls the probe over one specific SSH session. Passing `null` stops the
 * polling, so callers hand in the id only while their panel is visible.
 */
export function useSessionHostMetrics(
  sessionId: string | null,
  supported = true,
): MetricsState {
  const [state, setState] = useState<MetricsState>(initialMetricsState);

  useEffect(() => {
    if (!supported) {
      setState({ status: "unavailable", reason: "not-supported" });
      return;
    }
    if (!sessionId) {
      setState({ status: "unavailable", reason: "not-connected" });
      return;
    }

    let cancelled = false;
    // Loading is shown only before the first answer; afterwards the previous
    // reading stays on screen while the next one is measured.
    setState({ status: "loading" });

    async function read() {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const metrics = await invoke<HostMetrics>("host_metrics", {
          sessionId,
        });
        if (!cancelled) {
          setState({ status: "ready", metrics });
        }
      } catch (reason) {
        if (!cancelled) {
          setState({
            status: "error",
            detail: reason instanceof Error ? reason.message : String(reason),
          });
        }
      }
    }

    void read();
    const interval = setInterval(() => void read(), REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sessionId, supported]);

  return state;
}
