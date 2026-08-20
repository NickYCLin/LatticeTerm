/** Lattice Remote sessions and their latest encrypted-stream frame. */

import { useCallback, useEffect, useState } from "react";

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
  agentName: string;
  width: number;
  height: number;
  viewOnly: boolean;
  frame: RemoteFrame | null;
}

export interface RemoteConnectRequest {
  profileId: string;
  hostname: string;
  port: number;
  /** One-time secret passed to one IPC call and never retained here. */
  pairingCode: string;
}

export type RemoteConnectOutcome =
  | ({ outcome: "connected" } & Omit<RemoteSessionSummary, "frame">)
  | { outcome: "failed"; stage: string; detail: string };

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
  connect: (request: RemoteConnectRequest) => Promise<RemoteConnectOutcome>;
  disconnect: (sessionId: string) => Promise<void>;
}

async function core() {
  return import("@tauri-apps/api/core");
}

export function useRemoteSessions(): RemoteApi {
  const [sessions, setSessions] = useState<RemoteSessionSummary[]>([]);

  useEffect(() => {
    let disposers: Array<() => void> = [];
    let cancelled = false;

    async function subscribe() {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const stopFrames = await listen<FrameEvent>("remote://frame", (event) => {
          const frame: RemoteFrame = {
            frameId: event.payload.frameId,
            width: event.payload.width,
            height: event.payload.height,
            dataUrl: `data:${event.payload.mimeType};base64,${event.payload.base64}`,
          };
          setSessions((current) =>
            current.map((session) =>
              session.sessionId === event.payload.sessionId
                ? { ...session, width: frame.width, height: frame.height, frame }
                : session,
            ),
          );
        });
        const stopClosed = await listen<{ sessionId: string; reason: string }>(
          "remote://closed",
          (event) => {
            setSessions((current) =>
              current.filter(
                (session) => session.sessionId !== event.payload.sessionId,
              ),
            );
          },
        );

        if (cancelled) {
          stopFrames();
          stopClosed();
          return;
        }
        disposers = [stopFrames, stopClosed];
      } catch {
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
    try {
      const { invoke } = await core();
      await invoke("remote_disconnect", { sessionId });
    } finally {
      setSessions((current) =>
        current.filter((session) => session.sessionId !== sessionId),
      );
    }
  }, []);

  return { sessions, connect, disconnect };
}
