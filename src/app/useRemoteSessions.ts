/** Lattice Remote sessions and their latest encrypted-stream frame. */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  reconcileSessionSnapshot,
  type SessionClosedNotice,
} from "./sessionSnapshot";

export interface RemoteFrame {
  frameId: number;
  width: number;
  height: number;
  dataUrl: string;
}

export interface RemoteSessionSummary {
  sessionId: string;
  profileId: string;
  host: string;
  port: number;
  /** True when the session reached the host by device ID over a relay. */
  viaRelay: boolean;
  agentName: string;
  width: number;
  height: number;
  viewOnly: boolean;
  fileTransfer: boolean;
  fileRootLabel: string;
  frame: RemoteFrame | null;
}

export interface RemoteFileEntry {
  name: string;
  path: string;
  kind: "directory" | "file" | "symlink" | "other";
  size: number;
  modifiedAt: number | null;
}

export interface RemoteDirectory {
  path: string;
  entries: RemoteFileEntry[];
}

export interface RemoteFileTransfer {
  transferId: string;
  sessionId: string;
  kind: "download" | "upload";
  name: string;
  remotePath: string;
  localPath: string | null;
  bytesDone: number;
  totalBytes: number | null;
  state: "running" | "done" | "error" | "cancelled";
  detail: string | null;
}

export interface RemoteConnectRequest {
  profileId: string;
  hostname: string;
  port: number;
  /** One-time secret passed to one IPC call and never retained here. */
  pairingCode: string;
  /** When set, the backend dials this nine-digit ID through the relay. */
  deviceId?: string;
  relayAddress?: string;
}

export type RemoteConnectOutcome =
  | ({ outcome: "connected" } & Omit<RemoteSessionSummary, "frame">)
  | { outcome: "failed"; stage: string; detail: string };

/** One control action sent to an interactive (non view-only) session. */
export type RemoteInput =
  | { kind: "mouseMove"; x: number; y: number }
  | { kind: "mouseButton"; button: number; pressed: boolean }
  | { kind: "wheel"; horizontal: boolean; units: number }
  | { kind: "key"; keysym: number; pressed: boolean }
  | { kind: "releaseAll" };

interface FrameEvent {
  sessionId: string;
  frameId: number;
  width: number;
  height: number;
  mimeType: string;
  base64: string;
}

export interface RemoteApi {
  sessions: RemoteSessionSummary[];
  transfers: Record<string, RemoteFileTransfer>;
  lastClosed: SessionClosedNotice | null;
  connect: (request: RemoteConnectRequest) => Promise<RemoteConnectOutcome>;
  disconnect: (sessionId: string) => Promise<void>;
  input: (sessionId: string, request: RemoteInput) => Promise<void>;
  listFiles: (sessionId: string, path: string) => Promise<RemoteDirectory>;
  downloadFile: (sessionId: string, path: string) => Promise<RemoteFileTransfer>;
  uploadFile: (
    sessionId: string,
    parent: string,
    file: File,
    overwrite: boolean,
  ) => Promise<void>;
  cancelFileTransfer: (sessionId: string, transferId: string) => Promise<void>;
  dismissFileTransfer: (sessionId: string, transferId: string) => Promise<void>;
  clearLastClosed: () => void;
}

const REMOTE_UPLOAD_CHUNK_BYTES = 48 * 1024;

type RemoteInvoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

export function encodeRemoteFilePayload(bytes: Uint8Array): string {
  let binary = "";
  const slice = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += slice) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + slice));
  }
  return btoa(binary);
}

export function reconcileRemoteFileTransfer(
  current: RemoteFileTransfer | undefined,
  candidate: RemoteFileTransfer,
): RemoteFileTransfer {
  if (!current) return candidate;
  const currentEnded = current.state !== "running";
  const candidateEnded = candidate.state !== "running";
  if (currentEnded !== candidateEnded) return currentEnded ? current : candidate;
  if (!currentEnded && candidate.bytesDone < current.bytesDone) return current;
  return candidate;
}

export async function streamRemoteFileUpload(
  file: Pick<File, "stream">,
  sessionId: string,
  transferId: string,
  invoke: RemoteInvoke,
): Promise<void> {
  const reader = file.stream().getReader();
  let pending = new Uint8Array(0);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length > 0) {
        const merged = new Uint8Array(pending.length + value.length);
        merged.set(pending);
        merged.set(value, pending.length);
        pending = merged;
      }
      while (pending.length >= REMOTE_UPLOAD_CHUNK_BYTES) {
        await invoke("remote_file_upload_chunk", {
          sessionId,
          transferId,
          data: encodeRemoteFilePayload(
            pending.subarray(0, REMOTE_UPLOAD_CHUNK_BYTES),
          ),
        });
        pending = pending.slice(REMOTE_UPLOAD_CHUNK_BYTES);
      }
    }
    if (pending.length > 0) {
      await invoke("remote_file_upload_chunk", {
        sessionId,
        transferId,
        data: encodeRemoteFilePayload(pending),
      });
    }
    await invoke("remote_file_upload_finish", { sessionId, transferId });
  } catch (reason) {
    try {
      await reader.cancel(reason);
    } catch {
      // The backend cancellation below owns authoritative remote cleanup.
    }
    try {
      await invoke("remote_file_transfer_cancel", { sessionId, transferId });
    } catch {
      // Preserve the original local read or transport error.
    }
    throw reason;
  } finally {
    reader.releaseLock();
  }
}

async function core() {
  return import("@tauri-apps/api/core");
}

export function useRemoteSessions(): RemoteApi {
  const [sessions, setSessions] = useState<RemoteSessionSummary[]>([]);
  const [transfers, setTransfers] = useState<
    Record<string, RemoteFileTransfer>
  >({});
  const [lastClosed, setLastClosed] = useState<SessionClosedNotice | null>(null);
  const sessionsRef = useRef(sessions);
  const intentionalDisconnects = useRef(new Set<string>());
  sessionsRef.current = sessions;

  useEffect(() => {
    const disposers: Array<() => void> = [];
    let cancelled = false;
    let hydrating = true;
    const closedDuringHydration = new Set<string>();
    const pendingFrames = new Map<string, RemoteFrame>();

    function keep(dispose: () => void): boolean {
      if (cancelled) {
        dispose();
        return false;
      }
      disposers.push(dispose);
      return true;
    }

    async function subscribe() {
      try {
        const [{ invoke }, { listen }] = await Promise.all([
          core(),
          import("@tauri-apps/api/event"),
        ]);

        const stopClosed = await listen<{ sessionId: string; reason: string }>(
          "remote://closed",
          (event) => {
            const sessionId = event.payload.sessionId;
            if (hydrating) closedDuringHydration.add(sessionId);
            pendingFrames.delete(sessionId);
            const intentional = intentionalDisconnects.current.delete(sessionId);
            if (!intentional) {
              const session = sessionsRef.current.find(
                (current) => current.sessionId === sessionId,
              );
              setLastClosed({
                sessionId,
                label: session?.agentName ?? sessionId,
                reason: event.payload.reason,
                at: Date.now(),
              });
            }
            setSessions((current) =>
              current.filter((session) => session.sessionId !== sessionId),
            );
          },
        );
        if (!keep(stopClosed)) return;

        const stopFrames = await listen<FrameEvent>("remote://frame", (event) => {
          const frame: RemoteFrame = {
            frameId: event.payload.frameId,
            width: event.payload.width,
            height: event.payload.height,
            dataUrl: `data:${event.payload.mimeType};base64,${event.payload.base64}`,
          };
          if (hydrating) pendingFrames.set(event.payload.sessionId, frame);
          setSessions((current) =>
            current.map((session) =>
              session.sessionId === event.payload.sessionId
                ? { ...session, width: frame.width, height: frame.height, frame }
                : session,
            ),
          );
        });
        if (!keep(stopFrames)) return;

        const stopTransfers = await listen<RemoteFileTransfer>(
          "remote://file-transfer",
          (event) => {
            setTransfers((current) => ({
              ...current,
              [event.payload.transferId]: reconcileRemoteFileTransfer(
                current[event.payload.transferId],
                event.payload,
              ),
            }));
          },
        );
        if (!keep(stopTransfers)) return;

        const [existing, existingTransfers] = await Promise.all([
          invoke<Array<Omit<RemoteSessionSummary, "frame">>>("remote_sessions"),
          invoke<RemoteFileTransfer[]>("remote_file_transfers"),
        ]);
        if (!cancelled) {
          const restored = existing.map<RemoteSessionSummary>((session) => {
            const frame = pendingFrames.get(session.sessionId) ?? null;
            return frame
              ? { ...session, width: frame.width, height: frame.height, frame }
              : { ...session, frame: null };
          });
          setSessions((current) =>
            reconcileSessionSnapshot(
              current,
              restored,
              closedDuringHydration,
            ),
          );
          setTransfers((current) => {
            const next = { ...current };
            for (const transfer of existingTransfers) {
              next[transfer.transferId] = reconcileRemoteFileTransfer(
                next[transfer.transferId],
                transfer,
              );
            }
            return next;
          });
          hydrating = false;
          closedDuringHydration.clear();
          pendingFrames.clear();
        }
      } catch {
        hydrating = false;
        closedDuringHydration.clear();
        pendingFrames.clear();
        // Browser preview has no Tauri event source and intentionally stays empty.
      }
    }

    void subscribe();
    return () => {
      cancelled = true;
      for (const dispose of disposers) dispose();
    };
  }, []);

  const connect = useCallback(
    async (request: RemoteConnectRequest): Promise<RemoteConnectOutcome> => {
      try {
        const { invoke } = await core();
        const outcome = await invoke<RemoteConnectOutcome>("remote_connect", {
          request,
        });
        if (outcome.outcome === "connected") {
          const { outcome: _outcome, ...summary } = outcome;
          setSessions((current) => [
            ...current.filter(
              (session) => session.sessionId !== summary.sessionId,
            ),
            { ...summary, frame: null },
          ]);
        }
        return outcome;
      } catch (error) {
        return {
          outcome: "failed",
          stage: "invoke",
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },
    [],
  );

  const disconnect = useCallback(async (sessionId: string) => {
    intentionalDisconnects.current.add(sessionId);
    try {
      const { invoke } = await core();
      await invoke("remote_disconnect", { sessionId });
    } catch (reason) {
      intentionalDisconnects.current.delete(sessionId);
      throw reason;
    } finally {
      setSessions((current) =>
        current.filter((session) => session.sessionId !== sessionId),
      );
    }
  }, []);

  const input = useCallback(
    async (sessionId: string, request: RemoteInput) => {
      const { invoke } = await core();
      await invoke("remote_input", { sessionId, request });
    },
    [],
  );

  const listFiles = useCallback(async (sessionId: string, path: string) => {
    const { invoke } = await core();
    return invoke<RemoteDirectory>("remote_file_list", { sessionId, path });
  }, []);

  const downloadFile = useCallback(async (sessionId: string, path: string) => {
    const { invoke } = await core();
    const transfer = await invoke<RemoteFileTransfer>(
      "remote_file_download_start",
      { sessionId, path },
    );
    setTransfers((current) => ({
      ...current,
      [transfer.transferId]: reconcileRemoteFileTransfer(
        current[transfer.transferId],
        transfer,
      ),
    }));
    return transfer;
  }, []);

  const uploadFile = useCallback(
    async (
      sessionId: string,
      parent: string,
      file: File,
      overwrite: boolean,
    ) => {
      const { invoke } = await core();
      const transfer = await invoke<RemoteFileTransfer>(
        "remote_file_upload_begin",
        {
          sessionId,
          parent,
          name: file.name,
          size: file.size,
          overwrite,
        },
      );
      setTransfers((current) => ({
        ...current,
        [transfer.transferId]: reconcileRemoteFileTransfer(
          current[transfer.transferId],
          transfer,
        ),
      }));
      await streamRemoteFileUpload(
        file,
        sessionId,
        transfer.transferId,
        invoke as RemoteInvoke,
      );
    },
    [],
  );

  const cancelFileTransfer = useCallback(
    async (sessionId: string, transferId: string) => {
      const { invoke } = await core();
      await invoke("remote_file_transfer_cancel", { sessionId, transferId });
    },
    [],
  );

  const dismissFileTransfer = useCallback(
    async (sessionId: string, transferId: string) => {
      const { invoke } = await core();
      await invoke("remote_file_transfer_dismiss", { sessionId, transferId });
      setTransfers((current) => {
        const next = { ...current };
        delete next[transferId];
        return next;
      });
    },
    [],
  );

  const clearLastClosed = useCallback(() => setLastClosed(null), []);

  return {
    sessions,
    transfers,
    lastClosed,
    connect,
    disconnect,
    input,
    listFiles,
    downloadFile,
    uploadFile,
    cancelFileTransfer,
    dismissFileTransfer,
    clearLastClosed,
  };
}
