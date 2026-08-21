/**
 * SSH Tunnels management hook.
 *
 * Persists user tunnel configurations, provides CRUD operations, and manages
 * live tunnel runtime execution (start/stop/stats) via Tauri IPC.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createTunnelFromDraft,
  validateTunnelDraft,
  type TunnelConfig,
  type TunnelDraft,
  type TunnelStats,
  type TunnelStatus,
  type TunnelValidationError,
} from "../domain/tunnel";
import type { ConnectionProfile } from "../domain/connection";

const TUNNELS_STORAGE_KEY = "latticeterm.tunnels.v1";

function errorDetail(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return "The tunnel runtime did not provide an error detail.";
}

const DEFAULT_SAMPLE_TUNNELS: TunnelConfig[] = [
  {
    id: "tunnel-postgres-sample",
    name: "Production PostgreSQL (Internal)",
    type: "local",
    profileId: "sample-prod",
    localHost: "127.0.0.1",
    localPort: 5432,
    remoteHost: "postgres.internal.net",
    remotePort: 5432,
    description: "Forward local port 5432 to internal DB through production gateway",
    createdAt: Date.now() - 3600000,
    updatedAt: Date.now() - 3600000,
  },
  {
    id: "tunnel-socks5-sample",
    name: "Staging SOCKS5 Dynamic Proxy",
    type: "dynamic",
    profileId: "sample-staging",
    localHost: "127.0.0.1",
    localPort: 1080,
    remoteHost: "",
    remotePort: 0,
    description: "Local SOCKS5 proxy for testing staging environment APIs",
    createdAt: Date.now() - 7200000,
    updatedAt: Date.now() - 7200000,
  },
];

export interface LiveTunnelState extends TunnelStats {
  status: TunnelStatus;
}

export interface UseTunnelsResult {
  tunnels: TunnelConfig[];
  states: Record<string, LiveTunnelState>;
  addTunnel: (draft: TunnelDraft) => { success: boolean; errors?: TunnelValidationError[]; tunnel?: TunnelConfig };
  updateTunnel: (id: string, draft: TunnelDraft) => { success: boolean; errors?: TunnelValidationError[]; tunnel?: TunnelConfig };
  deleteTunnel: (id: string) => void;
  duplicateTunnel: (id: string) => void;
  startTunnel: (id: string) => Promise<{ success: boolean; error?: string }>;
  stopTunnel: (id: string) => Promise<void>;
  startAll: () => Promise<void>;
  stopAll: () => Promise<void>;
}

export function useTunnels(
  profiles: ConnectionProfile[],
  onActivity?: (type: string, detail: string) => void,
): UseTunnelsResult {
  const autoStartAttempted = useRef(false);
  const [tunnels, setTunnels] = useState<TunnelConfig[]>(() => {
    try {
      const raw = localStorage.getItem(TUNNELS_STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw) as TunnelConfig[];
      }
    } catch {
      // Fallback
    }
    return DEFAULT_SAMPLE_TUNNELS;
  });

  const [states, setStates] = useState<Record<string, LiveTunnelState>>({});

  // Persist to storage
  useEffect(() => {
    try {
      localStorage.setItem(TUNNELS_STORAGE_KEY, JSON.stringify(tunnels));
    } catch {
      // Ignore
    }
  }, [tunnels]);

  // Poll status from Tauri backend periodically
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const list = await invoke<
          {
            tunnel_id: string;
            status: TunnelStatus;
            bytes_uploaded: number;
            bytes_downloaded: number;
            active_connections: number;
            started_at?: number;
            last_error?: string;
          }[]
        >("tunnel_list");

        if (!cancelled && Array.isArray(list)) {
          setStates((prev) => {
            const next = { ...prev };
            for (const item of list) {
              next[item.tunnel_id] = {
                status: item.status,
                bytesUploaded: item.bytes_uploaded,
                bytesDownloaded: item.bytes_downloaded,
                activeConnections: item.active_connections,
                startedAt: item.started_at ? item.started_at * 1000 : undefined,
                lastError: item.last_error,
              };
            }
            return next;
          });
        }
      } catch {
        // Outside Tauri desktop or IPC not ready
      }
    }

    const interval = setInterval(() => {
      void poll();
    }, 2000);

    void poll();

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const addTunnel = useCallback(
    (draft: TunnelDraft) => {
      const errors = validateTunnelDraft(draft);
      if (errors.length > 0) {
        return { success: false, errors };
      }

      const created = createTunnelFromDraft(draft);
      setTunnels((prev) => [created, ...prev]);
      onActivity?.("tunnel_create", created.name);
      return { success: true, tunnel: created };
    },
    [onActivity],
  );

  const updateTunnel = useCallback(
    (id: string, draft: TunnelDraft) => {
      const errors = validateTunnelDraft(draft);
      if (errors.length > 0) {
        return { success: false, errors };
      }

      const updated = createTunnelFromDraft(draft, id);
      setTunnels((prev) => prev.map((t) => (t.id === id ? updated : t)));
      onActivity?.("tunnel_update", updated.name);
      return { success: true, tunnel: updated };
    },
    [onActivity],
  );

  const deleteTunnel = useCallback(
    (id: string) => {
      const target = tunnels.find((t) => t.id === id);
      setTunnels((prev) => prev.filter((t) => t.id !== id));
      setStates((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });

      // If in Tauri, tell backend to stop
      void (async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("tunnel_stop", { tunnelId: id });
        } catch {
          // Ignore
        }
      })();

      if (target) {
        onActivity?.("tunnel_delete", target.name);
      }
    },
    [tunnels, onActivity],
  );

  const duplicateTunnel = useCallback(
    (id: string) => {
      const target = tunnels.find((t) => t.id === id);
      if (!target) return;

      const duplicated: TunnelConfig = {
        ...target,
        id: `tunnel-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: `${target.name} (Copy)`,
        localPort: target.localPort < 65535 ? target.localPort + 1 : target.localPort,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      setTunnels((prev) => [duplicated, ...prev]);
      onActivity?.("tunnel_duplicate", duplicated.name);
    },
    [tunnels, onActivity],
  );

  const startTunnel = useCallback(
    async (id: string): Promise<{ success: boolean; error?: string }> => {
      const target = tunnels.find((t) => t.id === id);
      if (!target) return { success: false, error: "Tunnel not found." };

      const profile = profiles.find((p) => p.id === target.profileId);
      if (!profile) {
        const error = "The selected SSH gateway profile no longer exists.";
        setStates((prev) => ({
          ...prev,
          [id]: {
            status: "error",
            bytesUploaded: prev[id]?.bytesUploaded ?? 0,
            bytesDownloaded: prev[id]?.bytesDownloaded ?? 0,
            activeConnections: 0,
            lastError: error,
          },
        }));
        return { success: false, error };
      }
      if (profile.protocol !== "ssh") {
        const error = "SSH tunnels require an SSH connection profile.";
        setStates((prev) => ({
          ...prev,
          [id]: {
            status: "error",
            bytesUploaded: prev[id]?.bytesUploaded ?? 0,
            bytesDownloaded: prev[id]?.bytesDownloaded ?? 0,
            activeConnections: 0,
            lastError: error,
          },
        }));
        return { success: false, error };
      }

      setStates((prev) => ({
        ...prev,
        [id]: {
          status: "starting",
          bytesUploaded: prev[id]?.bytesUploaded ?? 0,
          bytesDownloaded: prev[id]?.bytesDownloaded ?? 0,
          activeConnections: 0,
        },
      }));

      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("tunnel_start", {
          request: {
            tunnel_id: target.id,
            tunnel_type: target.type,
            profile_id: target.profileId,
            local_host: target.localHost,
            local_port: target.localPort,
            remote_host: target.remoteHost,
            remote_port: target.remotePort,
          },
        });

        setStates((prev) => ({
          ...prev,
          [id]: {
            status: "active",
            bytesUploaded: 0,
            bytesDownloaded: 0,
            activeConnections: 0,
            startedAt: Date.now(),
          },
        }));
        onActivity?.("tunnel_start", target.name);
        return { success: true };
      } catch (invokeError) {
        const error = errorDetail(invokeError);
        setStates((prev) => ({
          ...prev,
          [id]: {
            status: "error",
            bytesUploaded: prev[id]?.bytesUploaded ?? 0,
            bytesDownloaded: prev[id]?.bytesDownloaded ?? 0,
            activeConnections: 0,
            lastError: error,
          },
        }));
        onActivity?.("tunnel_error", `${target.name}: ${error}`);
        return { success: false, error };
      }
    },
    [tunnels, profiles, onActivity],
  );

  useEffect(() => {
    if (autoStartAttempted.current || profiles.length === 0) {
      return;
    }
    autoStartAttempted.current = true;
    for (const tunnel of tunnels) {
      if (tunnel.autoStart) {
        void startTunnel(tunnel.id);
      }
    }
  }, [profiles.length, tunnels, startTunnel]);

  const stopTunnel = useCallback(
    async (id: string) => {
      const target = tunnels.find((t) => t.id === id);
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("tunnel_stop", { tunnelId: id });
      } catch {
        // Ignore
      }

      setStates((prev) => ({
        ...prev,
        [id]: {
          ...prev[id],
          status: "stopped",
          activeConnections: 0,
        },
      }));

      if (target) {
        onActivity?.("tunnel_stop", target.name);
      }
    },
    [tunnels, onActivity],
  );

  const startAll = useCallback(async () => {
    for (const t of tunnels) {
      if (states[t.id]?.status !== "active") {
        await startTunnel(t.id);
      }
    }
  }, [tunnels, states, startTunnel]);

  const stopAll = useCallback(async () => {
    for (const t of tunnels) {
      if (states[t.id]?.status === "active") {
        await stopTunnel(t.id);
      }
    }
  }, [tunnels, states, stopTunnel]);

  return {
    tunnels,
    states,
    addTunnel,
    updateTunnel,
    deleteTunnel,
    duplicateTunnel,
    startTunnel,
    stopTunnel,
    startAll,
    stopAll,
  };
}
