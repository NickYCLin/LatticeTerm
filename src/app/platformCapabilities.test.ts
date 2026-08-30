import { describe, expect, it } from "vitest";
import {
  canUseInAppUpdater,
  workspaceHeaderCapabilities,
} from "./platformCapabilities";

describe("platform capabilities", () => {
  it("keeps the Remote viewer reachable on mobile without offering hosting", () => {
    expect(workspaceHeaderCapabilities("android")).toEqual({
      remoteQuickConnect: true,
      remoteHost: false,
    });
    expect(workspaceHeaderCapabilities("ios")).toEqual({
      remoteQuickConnect: true,
      remoteHost: false,
    });
    expect(workspaceHeaderCapabilities("linux")).toEqual({
      remoteQuickConnect: true,
      remoteHost: true,
    });
    expect(workspaceHeaderCapabilities(undefined)).toEqual({
      remoteQuickConnect: true,
      remoteHost: false,
    });
  });

  it("offers in-app updates only in a desktop Tauri build", () => {
    expect(canUseInAppUpdater("tauri", "linux")).toBe(true);
    expect(canUseInAppUpdater("tauri", "windows")).toBe(true);
    expect(canUseInAppUpdater("tauri", "android")).toBe(false);
    expect(canUseInAppUpdater("tauri", "ios")).toBe(false);
    expect(canUseInAppUpdater("tauri", "future-os")).toBe(false);
    expect(canUseInAppUpdater("tauri", undefined)).toBe(false);
    expect(canUseInAppUpdater("browser", "browser")).toBe(false);
    expect(canUseInAppUpdater("unknown", undefined)).toBe(false);
  });
});
