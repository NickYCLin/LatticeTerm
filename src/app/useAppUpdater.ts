/**
 * App in-app update state and operations.
 *
 * Checks for new releases directly from GitHub Releases via Tauri's updater
 * plugin, downloads the differential update, and relaunches the app smoothly
 * without manual reinstall.
 */

import { useCallback, useState } from "react";
import { APP_VERSION } from "./version";

export type UpdaterDownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

interface InstallableUpdate {
  version: string;
  date?: string;
  body?: string;
  downloadAndInstall: (
    onEvent?: (event: UpdaterDownloadEvent) => void,
  ) => Promise<void>;
}

export interface UpdateDownloadProgress {
  status: "downloading" | "installing";
  downloadedBytes: number;
  totalBytes: number;
  progressPercent: number;
}

export function nextDownloadProgress(
  current: UpdateDownloadProgress,
  event: UpdaterDownloadEvent,
): UpdateDownloadProgress {
  if (event.event === "Started") {
    return {
      status: "downloading",
      downloadedBytes: 0,
      totalBytes: Math.max(0, event.data.contentLength ?? 0),
      progressPercent: 0,
    };
  }
  if (event.event === "Finished") {
    return {
      ...current,
      status: "installing",
      progressPercent: 100,
    };
  }

  const downloadedBytes =
    current.downloadedBytes + Math.max(0, event.data.chunkLength);
  const progressPercent =
    current.totalBytes > 0
      ? Math.min(100, Math.round((downloadedBytes / current.totalBytes) * 100))
      : 0;
  return { ...current, downloadedBytes, progressPercent };
}

export async function installUpdateAndRelaunch(
  update: InstallableUpdate,
  relaunch: () => Promise<void>,
  onEvent: (event: UpdaterDownloadEvent) => void,
): Promise<void> {
  await update.downloadAndInstall(onEvent);
  await relaunch();
}

/**
 * Lets the Rust shell seal and clear tracked sensitive clipboard content
 * before Tauri requests its otherwise-unpreventable restart exit code.
 */
async function restartAppSafely(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("app_restart_safely");
}

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

  const [pendingUpdate, setPendingUpdate] =
    useState<InstallableUpdate | null>(null);

  const checkForUpdates = useCallback(async () => {
    setInfo((prev) => ({
      ...prev,
      status: "checking",
      error: null,
    }));

    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();

      if (update) {
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
          releaseDate: null,
          releaseNotes: null,
          lastChecked: new Date(),
          error: null,
        }));
      }
    } catch (err: unknown) {
      setPendingUpdate(null);
      setInfo((prev) => ({
        ...prev,
        status: "error",
        availableVersion: null,
        releaseDate: null,
        releaseNotes: null,
        lastChecked: new Date(),
        error: err instanceof Error ? err.message : String(err),
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

    let installed = false;
    let progress: UpdateDownloadProgress = {
      status: "downloading",
      downloadedBytes: 0,
      totalBytes: 0,
      progressPercent: 0,
    };

    try {
      await installUpdateAndRelaunch(
        pendingUpdate,
        async () => {
          // downloadAndInstall resolves only after installation. Mark this
          // before asking the Rust shell to restart so a restart failure
          // offers a safe manual retry instead of claiming the install failed.
          installed = true;
          setInfo((prev) => ({
            ...prev,
            status: "installing",
            progressPercent: 100,
          }));
          await restartAppSafely();
        },
        (event) => {
          progress = nextDownloadProgress(progress, event);
          setInfo((prev) => ({ ...prev, ...progress }));
        },
      );
    } catch (err: unknown) {
      setInfo((prev) => ({
        ...prev,
        status: installed ? "downloaded" : "error",
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [pendingUpdate]);

  const relaunchApp = useCallback(async () => {
    setInfo((prev) => ({ ...prev, status: "installing", error: null }));
    try {
      await restartAppSafely();
    } catch (err: unknown) {
      setInfo((prev) => ({
        ...prev,
        status: "downloaded",
        error: err instanceof Error ? err.message : String(err),
      }));
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
