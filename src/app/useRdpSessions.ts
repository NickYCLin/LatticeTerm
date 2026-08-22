/** Native RDP sessions rendered by the embedded Canvas pane. */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  reconcileSessionSnapshot,
  type SessionClosedNotice,
} from "./sessionSnapshot";

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
  useSavedPassword: boolean;
  rememberPassword: boolean;
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
  lastClosed: SessionClosedNotice | null;
  connect: (request: RdpConnectRequest) => Promise<RdpConnectOutcome>;
  input: (sessionId: string, request: RdpInput) => Promise<void>;
  disconnect: (sessionId: string) => Promise<void>;
  clearLastClosed: () => void;
}

async function core() {
  return import("@tauri-apps/api/core");
}

export function useRdpSessions(): RdpApi {
  const [sessions, setSessions] = useState<RdpSessionSummary[]>([]);
  const [lastClosed, setLastClosed] = useState<SessionClosedNotice | null>(null);
  const sessionsRef = useRef(sessions);
  const intentionalDisconnects = useRef(new Set<string>());
  sessionsRef.current = sessions;

  useEffect(() => {
    const disposers: Array<() => void> = [];
    let cancelled = false;
    let hydrating = true;
    const closedDuringHydration = new Set<string>();
    const pendingFrames = new Map<string, RdpFrame>();

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
          "rdp://closed",
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
                label: session
                  ? session.username + "@" + session.host
                  : sessionId,
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

        const stopFrames = await listen<FrameEvent>("rdp://frame", (event) => {
          const frame: RdpFrame = {
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

        const existing =
          await invoke<Array<Omit<RdpSessionSummary, "frame">>>("rdp_sessions");
        if (!cancelled) {
          const restored = existing.map<RdpSessionSummary>((session) => {
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
          hydrating = false;
          closedDuringHydration.clear();
          pendingFrames.clear();
        }
      } catch {
        hydrating = false;
        closedDuringHydration.clear();
        pendingFrames.clear();
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
    intentionalDisconnects.current.add(sessionId);
    try {
      const { invoke } = await core();
      await invoke("rdp_disconnect", { sessionId });
    } catch (reason) {
      intentionalDisconnects.current.delete(sessionId);
      throw reason;
    } finally {
      setSessions((current) =>
        current.filter((session) => session.sessionId !== sessionId),
      );
    }
  }, []);

  const clearLastClosed = useCallback(() => setLastClosed(null), []);

  return {
    sessions,
    lastClosed,
    connect,
    input,
    disconnect,
    clearLastClosed,
  };
}
