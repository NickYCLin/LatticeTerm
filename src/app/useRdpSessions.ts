/** Native RDP sessions rendered by the embedded Canvas pane. */

import { useCallback, useEffect, useState } from "react";

export interface RdpFrame {
  frameId: number;
  width: number;
  height: number;
  dataUrl: string;
}

export interface RdpSessionSummary {
  sessionId: string;
  profileId: string;
  host: string;
  port: number;
  username: string;
  width: number;
  height: number;
  interactive: boolean;
  frame: RdpFrame | null;
}

export interface RdpConnectRequest {
  profileId: string;
  hostname: string;
  port: number;
  username: string;
  password: string;
  domain?: string;
  width: number;
  height: number;
  trustedCertificateSha256?: string;
}

export type RdpConnectOutcome =
  | ({ outcome: "connected" } & Omit<RdpSessionSummary, "frame">)
  | {
      outcome: "certificateUnknown";
      fingerprintSha256: string;
      detail: string;
    }
  | { outcome: "failed"; stage: string; detail: string };

export type RdpInput =
  | { kind: "mouseMove"; x: number; y: number }
  | { kind: "mouseButton"; button: number; pressed: boolean }
  | { kind: "wheel"; horizontal: boolean; units: number }
  | { kind: "key"; scancode: number; pressed: boolean }
  | { kind: "unicode"; character: string; pressed: boolean }
  | { kind: "releaseAll" };

interface FrameEvent {
  sessionId: string;
  frameId: number;
  width: number;
  height: number;
  mimeType: string;
  base64: string;
}

export interface RdpApi {
  sessions: RdpSessionSummary[];
  connect: (request: RdpConnectRequest) => Promise<RdpConnectOutcome>;
  input: (sessionId: string, request: RdpInput) => Promise<void>;
  disconnect: (sessionId: string) => Promise<void>;
}

async function core() {
  return import("@tauri-apps/api/core");
}

export function useRdpSessions(): RdpApi {
  const [sessions, setSessions] = useState<RdpSessionSummary[]>([]);

  useEffect(() => {
    let disposers: Array<() => void> = [];
    let cancelled = false;

    async function subscribe() {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const stopFrames = await listen<FrameEvent>("rdp://frame", (event) => {
          const frame: RdpFrame = {
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
          "rdp://closed",
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
        // Browser preview intentionally has no native RDP event source.
      }
    }

    void subscribe();
    return () => {
      cancelled = true;
      for (const dispose of disposers) dispose();
    };
  }, []);

  const connect = useCallback(
    async (request: RdpConnectRequest): Promise<RdpConnectOutcome> => {
      try {
        const { invoke } = await core();
        const outcome = await invoke<RdpConnectOutcome>("rdp_connect", {
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

  const input = useCallback(async (sessionId: string, request: RdpInput) => {
    const { invoke } = await core();
    await invoke("rdp_input", { sessionId, request });
  }, []);

  const disconnect = useCallback(async (sessionId: string) => {
    try {
      const { invoke } = await core();
      await invoke("rdp_disconnect", { sessionId });
    } finally {
      setSessions((current) =>
        current.filter((session) => session.sessionId !== sessionId),
      );
    }
  }, []);

  return { sessions, connect, input, disconnect };
}
