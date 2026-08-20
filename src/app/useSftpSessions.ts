import { useCallback, useState } from "react";
import type { HostKeyRecord } from "../domain/security";

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
  trustHost: (
    host: string,
    port: number,
    algorithm: string,
    fingerprint: string,
  ) => Promise<HostKeyRecord>;
}

export function useSftpSessions(): SftpApi {
  const [sessions, setSessions] = useState<SftpSessionSummary[]>([]);

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
    trustHost,
  };
}
