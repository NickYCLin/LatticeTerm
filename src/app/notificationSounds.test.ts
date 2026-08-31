import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  notificationToneSequence,
  playNotificationSound,
} from "./notificationSounds";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("notification sounds", () => {
  it("keeps off silent and gives every named sound a short sequence", () => {
    expect(notificationToneSequence("off")).toEqual([]);
    for (const sound of ["clear", "gentle", "double", "wood"] as const) {
      const tones = notificationToneSequence(sound);
      expect(tones.length).toBeGreaterThan(0);
      expect(Math.max(...tones.map((tone) => tone.delay + tone.duration))).toBeLessThan(
        0.75,
      );
    }
  });

  it("uses the native desktop player before Web Audio", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.mocked(invoke).mockResolvedValue(true);

    await expect(playNotificationSound("clear")).resolves.toBe("native");
    expect(invoke).toHaveBeenCalledWith("play_notification_sound", {
      sound: "clear",
    });
  });

  it("queues simultaneous native cues instead of overlapping them", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    let releaseFirst: ((value: boolean) => void) | undefined;
    vi.mocked(invoke)
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            releaseFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(true);

    const first = playNotificationSound("clear");
    const second = playNotificationSound("double");
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledTimes(1);

    releaseFirst?.(true);
    await expect(first).resolves.toBe("native");
    await expect(second).resolves.toBe("native");
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("reports when neither native nor Web Audio playback is available", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.mocked(invoke).mockResolvedValue(false);

    await expect(playNotificationSound("gentle")).resolves.toBe("unavailable");
  });
});
