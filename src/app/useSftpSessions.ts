import { useCallback, useEffect, useState } from "react";
import type { HostKeyRecord } from "../domain/security";
import { reconcileSessionSnapshot } from "./sessionSnapshot";

export const SFTP_MAX_TRANSFER_BYTES = 32 * 1024 * 1024;

export interface SftpSessionSummary {
  sessionId: string;
  profileId: string;
  host: string;
  port: number;
  username: string;
  currentPath: string;
}

export interface SftpEntry {
  name: string;
  path: string;
  kind: "directory" | "file" | "symlink" | "other";
  size: number;
  modifiedAt: number | null;
  permissions: string;
}

export interface SftpDirectory {
  path: string;
  entries: SftpEntry[];
}

/** One queued transfer, as reported by the streaming engine. */
export interface SftpTransfer {
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

/** Upload chunk size: large enough to move fast, bounded enough for memory. */
const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;

export interface SftpConnectRequest {
  profileId: string;
  hostname: string;
  port: number;
  username: string;
  auth: { kind: "password"; password: string };
  useSavedPassword: boolean;
  rememberPassword: boolean;
}

export type SftpConnectOutcome =
  | { outcome: "connected"; session: SftpSessionSummary }
  | {
      outcome: "hostUnknown";
      host: string;
      port: number;
      algorithm: string;
      fingerprint: string;
    }
  | {
      outcome: "hostChanged";
      host: string;
      port: number;
      algorithm: string;
      receivedFingerprint: string;
      expected: HostKeyRecord;
    }
  | { outcome: "authFailed" }
  | { outcome: "failed"; stage: string; detail: string };

async function core() {
  return import("@tauri-apps/api/core");
}

export function encodeSftpPayload(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function decodeSftpPayload(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

type SftpInvoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

/**
 * Feeds one browser file stream into an already-created backend transfer.
 * Any local read or IPC failure explicitly cancels the backend transfer so a
 * remote staging file cannot keep running after the WebView has stopped.
 */
export async function streamSftpUpload(
  file: Pick<File, "stream">,
  transferId: string,
  invoke: SftpInvoke,
): Promise<void> {
  const reader = file.stream().getReader();
  let pending = new Uint8Array(0);

  async function sendChunk(bytes: Uint8Array) {
    await invoke("sftp_upload_chunk", {
      transferId,
      data: encodeSftpPayload(bytes),
    });
  }

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
      while (pending.length >= UPLOAD_CHUNK_BYTES) {
        await sendChunk(pending.subarray(0, UPLOAD_CHUNK_BYTES));
        pending = pending.slice(UPLOAD_CHUNK_BYTES);
      }
    }
    if (pending.length > 0) {
      await sendChunk(pending);
    }
    await invoke("sftp_upload_finish", { transferId });
  } catch (reason) {
    try {
      await reader.cancel(reason);
    } catch {
      // The backend cancellation below is the authoritative cleanup path.
    }

    let cleanupProblem: unknown = null;
    try {
      await invoke("sftp_transfer_cancel", { transferId });
    } catch (cleanupReason) {
      cleanupProblem = cleanupReason;
    }

    const message = reason instanceof Error ? reason.message : String(reason);
    if (message.trim().toLowerCase() === "cancelled" && cleanupProblem === null) {
      return;
    }
    if (cleanupProblem !== null) {
      const cleanupMessage =
        cleanupProblem instanceof Error
          ? cleanupProblem.message
          : String(cleanupProblem);
      throw new Error(`${message}; transfer cleanup failed: ${cleanupMessage}`);
    }
    throw reason;
  } finally {
    reader.releaseLock();
  }
}

export interface SftpApi {
  sessions: SftpSessionSummary[];
  connect: (request: SftpConnectRequest) => Promise<SftpConnectOutcome>;
  disconnect: (sessionId: string) => Promise<void>;
  list: (sessionId: string, path: string) => Promise<SftpDirectory>;
  createDirectory: (
    sessionId: string,
    parent: string,
    name: string,
  ) => Promise<void>;
  rename: (sessionId: string, path: string, newName: string) => Promise<void>;
  remove: (
    sessionId: string,
    path: string,
    directory: boolean,
  ) => Promise<void>;
  readFile: (sessionId: string, path: string) => Promise<Uint8Array>;
  writeFile: (
    sessionId: string,
    parent: string,
    file: File,
    overwrite: boolean,
  ) => Promise<void>;
  /** Live transfer queue, keyed by transfer id. */
  transfers: Record<string, SftpTransfer>;
  /** Streams a remote file into the OS download folder. */
  downloadToDisk: (sessionId: string, remotePath: string) => Promise<SftpTransfer>;
  /** Streams a local file to the remote side in bounded chunks. */
  uploadStream: (
    sessionId: string,
    parent: string,
    file: File,
    overwrite: boolean,
  ) => Promise<void>;
  cancelTransfer: (transferId: string) => Promise<void>;
  dismissTransfer: (transferId: string) => Promise<void>;
  trustHost: (
    host: string,
    port: number,
    algorithm: string,
    fingerprint: string,
  ) => Promise<HostKeyRecord>;
}

export function useSftpSessions(): SftpApi {
  const [sessions, setSessions] = useState<SftpSessionSummary[]>([]);
  const [transfers, setTransfers] = useState<Record<string, SftpTransfer>>({});

  // One listener carries every transfer's progress; a snapshot fetch fills in
  // whatever moved before this view mounted.
  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | null = null;

    void (async () => {
      try {
        const [{ invoke }, { listen }] = await Promise.all([
          core(),
          import("@tauri-apps/api/event"),
        ]);

        // Listen first so a progress event that races with the snapshots wins.
        const unlisten = await listen<SftpTransfer>("sftp://transfer", (event) => {
          setTransfers((current) => ({
            ...current,
            [event.payload.transferId]: event.payload,
          }));
        });
        if (cancelled) {
          unlisten();
          return;
        }
        stop = unlisten;

        const [existingTransfers, existingSessions] = await Promise.all([
          invoke<SftpTransfer[]>("sftp_transfers"),
          invoke<SftpSessionSummary[]>("sftp_sessions"),
        ]);
        if (!cancelled) {
          setTransfers((current) => {
            const snapshot: Record<string, SftpTransfer> = {};
            for (const transfer of existingTransfers) {
              snapshot[transfer.transferId] = transfer;
            }
            return { ...snapshot, ...current };
          });
          setSessions((current) =>
            reconcileSessionSnapshot(current, existingSessions),
          );
        }
      } catch {
        // Outside the desktop shell there are no transfers to watch.
      }
    })();

    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  const connect = useCallback(
    async (request: SftpConnectRequest): Promise<SftpConnectOutcome> => {
      try {
        const { invoke } = await core();
        const outcome = await invoke<SftpConnectOutcome>("sftp_connect", {
          request,
        });
        if (outcome.outcome === "connected") {
          setSessions((current) => [...current, outcome.session]);
        }
        return outcome;
      } catch (reason) {
        return {
          outcome: "failed",
          stage: "invoke",
          detail: reason instanceof Error ? reason.message : String(reason),
        };
      }
    },
    [],
  );

  const disconnect = useCallback(async (sessionId: string) => {
    try {
      const { invoke } = await core();
      await invoke("sftp_disconnect", { sessionId });
    } finally {
      setSessions((current) =>
        current.filter((session) => session.sessionId !== sessionId),
      );
    }
  }, []);

  const list = useCallback(async (sessionId: string, path: string) => {
    const { invoke } = await core();
    return invoke<SftpDirectory>("sftp_list", { sessionId, path });
  }, []);

  const createDirectory = useCallback(
    async (sessionId: string, parent: string, name: string) => {
      const { invoke } = await core();
      await invoke("sftp_create_directory", { sessionId, parent, name });
    },
    [],
  );

  const rename = useCallback(
    async (sessionId: string, path: string, newName: string) => {
      const { invoke } = await core();
      await invoke("sftp_rename", { sessionId, path, newName });
    },
    [],
  );

  const remove = useCallback(
    async (sessionId: string, path: string, directory: boolean) => {
      const { invoke } = await core();
      await invoke("sftp_remove", { sessionId, path, directory });
    },
    [],
  );

  const readFile = useCallback(async (sessionId: string, path: string) => {
    const { invoke } = await core();
    return decodeSftpPayload(
      await invoke<string>("sftp_read_file", { sessionId, path }),
    );
  }, []);

  const writeFile = useCallback(
    async (
      sessionId: string,
      parent: string,
      file: File,
      overwrite: boolean,
    ) => {
      if (file.size > SFTP_MAX_TRANSFER_BYTES) {
        throw new Error(
          `Files larger than ${SFTP_MAX_TRANSFER_BYTES / 1024 / 1024} MiB are not supported.`,
        );
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { invoke } = await core();
      await invoke("sftp_write_file", {
        sessionId,
        parent,
        name: file.name,
        data: encodeSftpPayload(bytes),
        overwrite,
      });
    },
    [],
  );

  const downloadToDisk = useCallback(
    async (sessionId: string, remotePath: string) => {
      const { invoke } = await core();
      const transfer = await invoke<SftpTransfer>("sftp_download_start", {
        sessionId,
        remotePath,
      });
      setTransfers((current) => ({ ...current, [transfer.transferId]: transfer }));
      return transfer;
    },
    [],
  );

  const uploadStream = useCallback(
    async (
      sessionId: string,
      parent: string,
      file: File,
      overwrite: boolean,
    ) => {
      const { invoke } = await core();
      const transfer = await invoke<SftpTransfer>("sftp_upload_begin", {
        plan: {
          sessionId,
          parent,
          name: file.name,
          totalBytes: file.size,
          overwrite,
        },
      });
      setTransfers((current) => ({ ...current, [transfer.transferId]: transfer }));
      await streamSftpUpload(file, transfer.transferId, invoke);
    },
    [],
  );

  const cancelTransfer = useCallback(async (transferId: string) => {
    const { invoke } = await core();
    await invoke("sftp_transfer_cancel", { transferId });
  }, []);

  const dismissTransfer = useCallback(async (transferId: string) => {
    try {
      const { invoke } = await core();
      await invoke("sftp_transfer_dismiss", { transferId });
    } finally {
      setTransfers((current) => {
        const next = { ...current };
        delete next[transferId];
        return next;
      });
    }
  }, []);

  const trustHost = useCallback(
    async (
      host: string,
      port: number,
      algorithm: string,
      fingerprint: string,
    ) => {
      const { invoke } = await core();
      return invoke<HostKeyRecord>("ssh_trust_host", {
        host,
        port,
        algorithm,
        fingerprint,
      });
    },
    [],
  );

  return {
    sessions,
    connect,
    disconnect,
    list,
    createDirectory,
    rename,
    remove,
    readFile,
    writeFile,
    transfers,
    downloadToDisk,
    uploadStream,
    cancelTransfer,
    dismissTransfer,
    trustHost,
  };
}
