/**
 * Runtime facts read from the Rust side.
 *
 * The interface must not claim a capability the backend has not reported, so
 * the credential-store state shown in Settings and the status bar comes from
 * `runtime_summary` rather than from copy written by hand. Outside a Tauri
 * window (plain `npm run dev`) the invoke fails and the hook reports browser
 * mode instead of inventing an answer.
 */

import { useEffect, useState } from "react";
import { APP_VERSION } from "./version";

export interface RuntimeSummary {
  appName: string;
  version: string;
  supportedProtocols: string[];
  credentialStorageReady: boolean;
  /** "windows" | "macos" | "linux" | "android" | "ios". */
  platform: string;
}

export interface RuntimeState {
  summary: RuntimeSummary | null;
  host: "tauri" | "browser" | "unknown";
}

const fallback: RuntimeSummary = {
  appName: "LatticeTerm",
  version: APP_VERSION,
  supportedProtocols: ["ssh", "rdp", "lattice"],
  credentialStorageReady: false,
  platform: "browser",
};

export function useRuntimeSummary(): RuntimeState {
  const [state, setState] = useState<RuntimeState>({
    summary: null,
    host: "unknown",
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const summary = await invoke<RuntimeSummary>("runtime_summary");
        if (!cancelled) setState({ summary, host: "tauri" });
      } catch {
        if (!cancelled) setState({ summary: fallback, host: "browser" });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
