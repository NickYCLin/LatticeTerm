import { describe, expect, it, vi } from "vitest";

import {
  installUpdateAndRelaunch,
  nextDownloadProgress,
  type UpdaterDownloadEvent,
} from "./useAppUpdater";

describe("nextDownloadProgress", () => {
  it("tracks download bytes and never reports more than 100 percent", () => {
    let progress = nextDownloadProgress(
      {
        status: "downloading",
        downloadedBytes: 99,
        totalBytes: 0,
        progressPercent: 0,
      },
      { event: "Started", data: { contentLength: 100 } },
    );
    progress = nextDownloadProgress(progress, {
      event: "Progress",
      data: { chunkLength: 120 },
    });

    expect(progress).toEqual({
      status: "downloading",
      downloadedBytes: 120,
      totalBytes: 100,
      progressPercent: 100,
    });
  });

  it("treats download completion as installation in progress", () => {
    const progress = nextDownloadProgress(
      {
        status: "downloading",
        downloadedBytes: 80,
        totalBytes: 100,
        progressPercent: 80,
      },
      { event: "Finished" },
    );

    expect(progress.status).toBe("installing");
    expect(progress.progressPercent).toBe(100);
  });
});

describe("installUpdateAndRelaunch", () => {
  it("relaunches only after the updater finished installing", async () => {
    const order: string[] = [];
    const events: UpdaterDownloadEvent[] = [];
    const update = {
      version: "1.2.3",
      async downloadAndInstall(onEvent?: (event: UpdaterDownloadEvent) => void) {
        order.push("install");
        onEvent?.({ event: "Finished" });
      },
    };

    await installUpdateAndRelaunch(
      update,
      async () => {
        order.push("relaunch");
      },
      (event) => events.push(event),
    );

    expect(order).toEqual(["install", "relaunch"]);
    expect(events).toEqual([{ event: "Finished" }]);
  });

  it("does not relaunch when download or installation fails", async () => {
    const relaunch = vi.fn(async () => undefined);
    const update = {
      version: "1.2.3",
      downloadAndInstall: vi.fn(async () => {
        throw new Error("signature rejected");
      }),
    };

    await expect(
      installUpdateAndRelaunch(update, relaunch, () => undefined),
    ).rejects.toThrow("signature rejected");
    expect(relaunch).not.toHaveBeenCalled();
  });
});
