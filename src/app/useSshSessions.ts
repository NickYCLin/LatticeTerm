/**
 * SSH sessions, from the interface's side.
 *
 * The backend refuses to open a session for a host it does not already trust,
 * so `connect` can finish in several ways and each one needs a different
 * response from the user. That is why it resolves to a typed outcome rather
 * than throwing: an unknown fingerprint is a question, not a failure.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface HostKeyRecord {
  host: string;
  port: number;
  algorithm: string;
  fingerprint: string;
  firstTrustedAt: number;
  lastSeenAt: number;
}

export type ConnectOutcome =
  | { outcome: "connected"; sessionId: string }
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

export interface SessionSummary {
  sessionId: string;
  profileId: string;
  host: string;
  port: number;
  username: string;
}

export interface ConnectRequest {
  profileId: string;
  hostname: string;
  port: number;
  username: string;
  /** Held only for this call; nothing here is written to disk. */
  auth: { kind: "password"; password: string };
  cols: number;
  rows: number;
}

/** Base64 keeps arbitrary terminal bytes intact across the IPC boundary. */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function core() {
  return import("@tauri-apps/api/core");
}

export interface SshApi {
  sessions: SessionSummary[];
  connect: (request: ConnectRequest) => Promise<ConnectOutcome>;
  send: (sessionId: string, data: string) => Promise<void>;
  resize: (sessionId: string, cols: number, rows: number) => Promise<void>;
  disconnect: (sessionId: string) => Promise<void>;
  trustHost: (
    host: string,
    port: number,
    algorithm: string,
    fingerprint: string,
  ) => Promise<HostKeyRecord>;
  /** Registers a listener for one session's output. Returns an unsubscribe. */
  onData: (sessionId: string, handler: (bytes: Uint8Array) => void) => () => void;
  onClosed: (
    sessionId: string,
    handler: (reason: string) => void,
  ) => () => void;
}

export function useSshSessions(): SshApi {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const dataHandlers = useRef(new Map<string, Set<(bytes: Uint8Array) => void>>());
  const closeHandlers = useRef(new Map<string, Set<(reason: string) => void>>());

  // One listener pair for the whole app, fanned out by session id: a terminal
  // pane mounting must not cost another IPC subscription.
  useEffect(() => {
    let disposers: Array<() => void> = [];
    let cancelled = false;

    async function subscribe() {
      try {
        const { listen } = await import("@tauri-apps/api/event");

        const stopData = await listen<{ sessionId: string; base64: string }>(
          "ssh://data",
          (event) => {
            const handlers = dataHandlers.current.get(event.payload.sessionId);
            if (!handlers) return;
            const bytes = fromBase64(event.payload.base64);
            for (const handler of handlers) handler(bytes);
          },
        );

        const stopClosed = await listen<{ sessionId: string; reason: string }>(
          "ssh://closed",
          (event) => {
            const handlers = closeHandlers.current.get(event.payload.sessionId);
            if (handlers) {
              for (const handler of handlers) handler(event.payload.reason);
            }
            setSessions((current) =>
              current.filter(
                (session) => session.sessionId !== event.payload.sessionId,
              ),
            );
          },
        );

        if (cancelled) {
          stopData();
          stopClosed();
          return;
        }
        disposers = [stopData, stopClosed];
      } catch {
        // Browser preview: there is no backend to listen to.
      }
    }

    void subscribe();
    return () => {
      cancelled = true;
      for (const dispose of disposers) dispose();
    };
  }, []);

  const connect = useCallback(
    async (request: ConnectRequest): Promise<ConnectOutcome> => {
      try {
        const { invoke } = await core();
        const outcome = await invoke<ConnectOutcome>("ssh_connect", { request });

        if (outcome.outcome === "connected") {
          setSessions((current) => [
            ...current,
            {
              sessionId: outcome.sessionId,
              profileId: request.profileId,
              host: request.hostname,
              port: request.port,
              username: request.username,
            },
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

  const send = useCallback(async (sessionId: string, data: string) => {
    const { invoke } = await core();
    await invoke("ssh_send", { sessionId, data: toBase64(data) });
  }, []);

  const resize = useCallback(
    async (sessionId: string, cols: number, rows: number) => {
      const { invoke } = await core();
      await invoke("ssh_resize", { sessionId, cols, rows });
    },
    [],
  );

  const disconnect = useCallback(async (sessionId: string) => {
    try {
      const { invoke } = await core();
      await invoke("ssh_disconnect", { sessionId });
    } finally {
      // Even if the backend refused, the session is over as far as this
      // window is concerned; leaving the tab would strand the user with
      // something they cannot close.
      setSessions((current) =>
        current.filter((session) => session.sessionId !== sessionId),
      );
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

  const onData = useCallback(
    (sessionId: string, handler: (bytes: Uint8Array) => void) => {
      const set = dataHandlers.current.get(sessionId) ?? new Set();
      set.add(handler);
      dataHandlers.current.set(sessionId, set);

      return () => {
        set.delete(handler);
        if (set.size === 0) dataHandlers.current.delete(sessionId);
      };
    },
    [],
  );

  const onClosed = useCallback(
    (sessionId: string, handler: (reason: string) => void) => {
      const set = closeHandlers.current.get(sessionId) ?? new Set();
      set.add(handler);
      closeHandlers.current.set(sessionId, set);

      return () => {
        set.delete(handler);
        if (set.size === 0) closeHandlers.current.delete(sessionId);
      };
    },
    [],
  );

  return {
    sessions,
    connect,
    send,
    resize,
    disconnect,
    trustHost,
    onData,
    onClosed,
  };
}
