/**
 * Where connection data is being kept, according to the backend.
 *
 * The interface must not claim data is saved when it is not: in a browser
 * preview there is no backend and nothing survives a reload, so the hook
 * reports `browser` and the status bar says so instead of promising storage
 * that does not exist.
 */

import { useCallback, useEffect, useState } from "react";

export interface StorageStatus {
  path: string;
  profileCount: number;
  /** Set only when an unreadable file had to be set aside at startup. */
  recoveredReason?: string | null;
  recoveredBackupPath?: string | null;
}

export interface StorageState {
  status: StorageStatus | null;
  /** `persistent` means the desktop store answered; `browser` means it did not. */
  mode: "persistent" | "browser" | "unknown";
  refresh: () => void;
}

export function useStorageStatus(): StorageState {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [mode, setMode] = useState<StorageState["mode"]>("unknown");
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await invoke<StorageStatus>("storage_status");
        if (!cancelled) {
          setStatus(result);
          setMode("persistent");
        }
      } catch {
        if (!cancelled) {
          setStatus(null);
          setMode("browser");
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { status, mode, refresh };
}
