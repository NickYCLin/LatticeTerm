/** Native VNC sessions rendered by the embedded Canvas pane. */

import { useCallback, useEffect, useState } from "react";

export interface VncFrame {
  frameId: number;
  width: number;
  height: number;
  dataUrl: string;
}

export interface VncSessionSummary {
  sessionId: string;
  profileId: string;
  host: string;
  port: number;
  width: number;
  height: number;
  interactive: boolean;
  frame: VncFrame | null;
}

export interface VncConnectRequest {
  profileId: string;
  hostname: string;
  port: number;
  password: string;
  useSavedPassword: boolean;
  rememberPassword: boolean;
}

export type VncConnectOutcome =
  | ({ outcome: "connected" } & Omit<VncSessionSummary, "frame">)
  | { outcome: "authFailed" }
  | { outcome: "failed"; stage: string; detail: string };

/** VNC keyboards speak X11 keysyms, not scancodes. */
export type VncInput =
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

export interface VncApi {
  sessions: VncSessionSummary[];
  connect: (request: VncConnectRequest) => Promise<VncConnectOutcome>;
  input: (sessionId: string, request: VncInput) => Promise<void>;
  disconnect: (sessionId: string) => Promise<void>;
}

async function core() {
  return import("@tauri-apps/api/core");
}

export function useVncSessions(): VncApi {
  const [sessions, setSessions] = useState<VncSessionSummary[]>([]);

  useEffect(() => {
    let disposers: Array<() => void> = [];
    let cancelled = false;

    async function subscribe() {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const stopFrames = await listen<FrameEvent>("vnc://frame", (event) => {
          const frame: VncFrame = {
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
          "vnc://closed",
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
        // Browser preview intentionally has no native VNC event source.
      }
    }

    void subscribe();
    return () => {
      cancelled = true;
      for (const dispose of disposers) dispose();
    };
  }, []);

  const connect = useCallback(
    async (request: VncConnectRequest): Promise<VncConnectOutcome> => {
      try {
        const { invoke } = await core();
        const outcome = await invoke<VncConnectOutcome>("vnc_connect", {
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

  const input = useCallback(async (sessionId: string, request: VncInput) => {
    const { invoke } = await core();
    await invoke("vnc_input", { sessionId, request });
  }, []);

  const disconnect = useCallback(async (sessionId: string) => {
    try {
      const { invoke } = await core();
      await invoke("vnc_disconnect", { sessionId });
    } finally {
      setSessions((current) =>
        current.filter((session) => session.sessionId !== sessionId),
      );
    }
  }, []);

  return { sessions, connect, input, disconnect };
}
