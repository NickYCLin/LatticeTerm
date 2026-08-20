/** User-controlled lifecycle for sharing this device through Lattice Remote. */

import { useCallback, useEffect, useState } from "react";

export interface RemoteHostStatus {
  hostId: string;
  address: string;
  pairingCode: string;
  expiresAt: number;
  viewOnly: boolean;
  state: "waiting" | "pairing" | "streaming";
  peer?: string;
  attemptsRemaining: number;
}

export interface RemoteHostStartRequest {
  bindAddress: string;
  port: number;
  fps: number;
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

  useEffect(() => {
    let cancelled = false;
    let disposers: Array<() => void> = [];

    async function initialize() {
      try {
        const [{ invoke }, { listen }] = await Promise.all([
          core(),
          import("@tauri-apps/api/event"),
        ]);
        const stopStatus = await listen<RemoteHostStatus>(
          "remote-host://status",
          (event) => setStatus(event.payload),
        );
        const stopClosed = await listen<{ hostId: string; reason: string }>(
          "remote-host://closed",
          (event) => {
            setStatus((current) =>
              current?.hostId === event.payload.hostId ? null : current,
            );
            setClosedReason(event.payload.reason);
          },
        );
        const current = await invoke<RemoteHostStatus | null>(
          "remote_host_status",
        );
        if (cancelled) {
          stopStatus();
          stopClosed();
          return;
        }
        disposers = [stopStatus, stopClosed];
        setStatus(current);
      } catch {
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
    setStatus(started);
    return started;
  }, []);

  const stop = useCallback(async () => {
    const { invoke } = await core();
    await invoke("remote_host_stop");
    setStatus(null);
  }, []);

  const clearClosedReason = useCallback(() => setClosedReason(null), []);

  return { status, closedReason, start, stop, clearClosedReason };
}
