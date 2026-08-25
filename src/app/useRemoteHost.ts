/** User-controlled lifecycle for sharing this device through Lattice Remote. */

import { useCallback, useEffect, useRef, useState } from "react";
import { reconcileSingletonSnapshot } from "./sessionSnapshot";

export interface RemoteHostStatus {
  hostId: string;
  address: string;
  pairingCode: string;
  expiresAt: number;
  viewOnly: boolean;
  fileTransfer: boolean;
  fileRoot?: string;
  state: "waiting" | "pairing" | "streaming";
  peer?: string;
  attemptsRemaining: number;
}

export interface RemoteHostStartRequest {
  bindAddress: string;
  port: number;
  fps: number;
  /** Let the paired viewer control this machine. Defaults to view-only. */
  allowInput: boolean;
  /** Independently authorises access to one shared folder. */
  allowFiles: boolean;
  /** Empty selects the current user's home folder in the native backend. */
  fileRoot: string;
}

export interface RemoteHostApi {
  status: RemoteHostStatus | null;
  closedReason: string | null;
  start: (request: RemoteHostStartRequest) => Promise<RemoteHostStatus>;
  stop: () => Promise<void>;
  clearClosedReason: () => void;
}

async function core() {
  return import("@tauri-apps/api/core");
}

export function useRemoteHost(): RemoteHostApi {
  const [status, setStatus] = useState<RemoteHostStatus | null>(null);
  const [closedReason, setClosedReason] = useState<string | null>(null);
  const intentionalStops = useRef(new Set<string>());
  const statusRevision = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const disposers: Array<() => void> = [];
    let hydrating = true;
    const closedDuringHydration = new Set<string>();
    const hydrationRevision = statusRevision.current;

    function keep(dispose: () => void): boolean {
      if (cancelled) {
        dispose();
        return false;
      }
      disposers.push(dispose);
      return true;
    }

    async function initialize() {
      try {
        const [{ invoke }, { listen }] = await Promise.all([
          core(),
          import("@tauri-apps/api/event"),
        ]);
        const stopStatus = await listen<RemoteHostStatus>(
          "remote-host://status",
          (event) => {
            statusRevision.current += 1;
            setStatus(event.payload);
          },
        );
        if (!keep(stopStatus)) return;

        const stopClosed = await listen<{ hostId: string; reason: string }>(
          "remote-host://closed",
          (event) => {
            if (hydrating) closedDuringHydration.add(event.payload.hostId);
            statusRevision.current += 1;
            setStatus((current) =>
              current?.hostId === event.payload.hostId ? null : current,
            );
            if (!intentionalStops.current.delete(event.payload.hostId)) {
              setClosedReason(event.payload.reason);
            }
          },
        );
        if (!keep(stopClosed)) return;

        const current = await invoke<RemoteHostStatus | null>(
          "remote_host_status",
        );
        if (!cancelled) {
          setStatus((latest) => {
            if (statusRevision.current === hydrationRevision) return current;
            return reconcileSingletonSnapshot(
              latest,
              current,
              (entry) => entry.hostId,
              closedDuringHydration,
            );
          });
          hydrating = false;
          closedDuringHydration.clear();
        }
      } catch {
        hydrating = false;
        closedDuringHydration.clear();
        // Browser preview has no native Agent process.
      }
    }

    void initialize();
    return () => {
      cancelled = true;
      for (const dispose of disposers) dispose();
    };
  }, []);

  const start = useCallback(async (request: RemoteHostStartRequest) => {
    const { invoke } = await core();
    setClosedReason(null);
    const started = await invoke<RemoteHostStatus>("remote_host_start", {
      request,
    });
    statusRevision.current += 1;
    setStatus(started);
    return started;
  }, []);

  const stop = useCallback(async () => {
    const { invoke } = await core();
    const hostId = status?.hostId;
    if (hostId) intentionalStops.current.add(hostId);
    try {
      await invoke("remote_host_stop");
      statusRevision.current += 1;
      setStatus(null);
    } catch (reason) {
      if (hostId) intentionalStops.current.delete(hostId);
      throw reason;
    }
  }, [status?.hostId]);

  const clearClosedReason = useCallback(() => setClosedReason(null), []);

  return { status, closedReason, start, stop, clearClosedReason };
}
