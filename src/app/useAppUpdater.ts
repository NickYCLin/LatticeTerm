/**
 * App in-app update state and operations.
 *
 * Checks for new releases directly from GitHub Releases via Tauri's updater
 * plugin, downloads the differential update, and relaunches the app smoothly
 * without manual reinstall.
 */

import { useCallback, useState } from "react";
import { APP_VERSION } from "./version";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";

export interface UpdateInfo {
  status: UpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  releaseDate: string | null;
  releaseNotes: string | null;
  downloadedBytes: number;
  totalBytes: number;
  progressPercent: number;
  error: string | null;
  lastChecked: Date | null;
}

export function useAppUpdater(currentVersion = APP_VERSION) {
  const [info, setInfo] = useState<UpdateInfo>({
    status: "idle",
    currentVersion,
    availableVersion: null,
    releaseDate: null,
    releaseNotes: null,
    downloadedBytes: 0,
    totalBytes: 0,
    progressPercent: 0,
    error: null,
    lastChecked: null,
  });

  const [pendingUpdate, setPendingUpdate] = useState<any>(null);

  const checkForUpdates = useCallback(async () => {
    setInfo((prev) => ({
      ...prev,
      status: "checking",
      error: null,
    }));

    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();

      if (update && update.available) {
        setPendingUpdate(update);
        setInfo((prev) => ({
          ...prev,
          status: "available",
          availableVersion: update.version,
          releaseDate: update.date ?? null,
          releaseNotes: update.body ?? null,
          lastChecked: new Date(),
          error: null,
        }));
      } else {
        setPendingUpdate(null);
        setInfo((prev) => ({
          ...prev,
          status: "up-to-date",
          availableVersion: null,
          lastChecked: new Date(),
          error: null,
        }));
      }
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : String(err);
      setInfo((prev) => ({
        ...prev,
        status: "up-to-date",
        lastChecked: new Date(),
        error:
          errorMessage.includes("failed to get update") ||
          errorMessage.includes("could not connect")
            ? null
            : errorMessage,
      }));
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    if (!pendingUpdate) return;

    setInfo((prev) => ({
      ...prev,
      status: "downloading",
      progressPercent: 0,
      downloadedBytes: 0,
      totalBytes: 0,
    }));

    try {
      let downloaded = 0;
      let total = 0;

      await pendingUpdate.downloadAndInstall((event: any) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          setInfo((prev) => ({
            ...prev,
            totalBytes: total,
          }));
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength ?? 0;
          const percent = total > 0 ? Math.round((downloaded / total) * 100) : 0;
          setInfo((prev) => ({
            ...prev,
            downloadedBytes: downloaded,
            progressPercent: percent,
          }));
        } else if (event.event === "Finished") {
          setInfo((prev) => ({
            ...prev,
            status: "downloaded",
            progressPercent: 100,
          }));
        }
      });

      setInfo((prev) => ({
        ...prev,
        status: "downloaded",
      }));
    } catch (err: unknown) {
      setInfo((prev) => ({
        ...prev,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [pendingUpdate]);

  const relaunchApp = useCallback(async () => {
    try {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch {
      window.location.reload();
    }
  }, []);

  return {
    ...info,
    checkForUpdates,
    downloadAndInstall,
    relaunchApp,
  };
}

export type AppUpdater = ReturnType<typeof useAppUpdater>;
