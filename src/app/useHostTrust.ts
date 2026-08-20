/**
 * Real trusted-host state backed by the Rust `known_hosts.json` store.
 *
 * Browser previews deliberately report `browser` and show no sample entries:
 * a security screen must never make demonstration data look like persisted
 * trust decisions.
 */

import { useCallback, useEffect, useState } from "react";
import type { HostKeyRecord } from "../domain/security";
import { hostTargetKey } from "../domain/security";

export type HostTrustMode = "loading" | "ready" | "browser" | "error";

export interface HostTrustState {
  knownHosts: HostKeyRecord[];
  mode: HostTrustMode;
  error: string | null;
  refresh: () => void;
  trustHost: (
    host: string,
    port: number,
    algorithm: string,
    fingerprint: string,
  ) => Promise<HostKeyRecord>;
  forgetHost: (host: string, port: number) => Promise<boolean>;
}

function sortRecords(records: HostKeyRecord[]): HostKeyRecord[] {
  return [...records].sort((left, right) =>
    hostTargetKey(left.host, left.port).localeCompare(
      hostTargetKey(right.host, right.port),
    ),
  );
}

async function desktopCore() {
  const core = await import("@tauri-apps/api/core");
  return core.isTauri() ? core : null;
}

export function useHostTrust(): HostTrustState {
  const [knownHosts, setKnownHosts] = useState<HostKeyRecord[]>([]);
  const [mode, setMode] = useState<HostTrustMode>("loading");
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setMode("loading");
      setError(null);

      try {
        const core = await desktopCore();
        if (!core) {
          if (!cancelled) {
            setKnownHosts([]);
            setMode("browser");
          }
          return;
        }

        const records = await core.invoke<HostKeyRecord[]>("ssh_known_hosts");
        if (!cancelled) {
          setKnownHosts(sortRecords(records));
          setMode("ready");
        }
      } catch (reason) {
        if (!cancelled) {
          setKnownHosts([]);
          setError(reason instanceof Error ? reason.message : String(reason));
          setMode("error");
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const trustHost = useCallback(
    async (
      host: string,
      port: number,
      algorithm: string,
      fingerprint: string,
    ) => {
      const core = await desktopCore();
      if (!core) throw new Error("desktop backend unavailable");

      const record = await core.invoke<HostKeyRecord>("ssh_trust_host", {
        host,
        port,
        algorithm,
        fingerprint,
      });
      setKnownHosts((current) =>
        sortRecords([
          ...current.filter(
            (entry) =>
              hostTargetKey(entry.host, entry.port) !== hostTargetKey(host, port),
          ),
          record,
        ]),
      );
      return record;
    },
    [],
  );

  const forgetHost = useCallback(async (host: string, port: number) => {
    const core = await desktopCore();
    if (!core) throw new Error("desktop backend unavailable");

    const removed = await core.invoke<boolean>("ssh_forget_host", { host, port });
    if (removed) {
      setKnownHosts((current) =>
        current.filter(
          (entry) =>
            hostTargetKey(entry.host, entry.port) !== hostTargetKey(host, port),
        ),
      );
    }
    return removed;
  }, []);

  return { knownHosts, mode, error, refresh, trustHost, forgetHost };
}
