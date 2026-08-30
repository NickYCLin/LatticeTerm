import { isMobilePlatform } from "./navigation";
import type { RuntimeState } from "./useRuntimeSummary";

/** Header actions that the current operating system can actually perform. */
export function workspaceHeaderCapabilities(platform: string | undefined): {
  remoteQuickConnect: boolean;
  remoteHost: boolean;
} {
  return {
    // The viewer and relay client are pure Rust and run on Android/iOS.
    remoteQuickConnect: true,
    // Sharing needs the desktop capture/terminal sidecar.
    remoteHost: platform !== undefined && !isMobilePlatform(platform),
  };
}

/** Mobile packages intentionally do not register Tauri's updater plugin. */
export function canUseInAppUpdater(
  host: RuntimeState["host"],
  platform: string | undefined,
): boolean {
  return (
    host === "tauri" &&
    (platform === "linux" || platform === "windows" || platform === "macos")
  );
}
