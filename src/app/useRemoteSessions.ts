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
  lastClosed: SessionClosedNotice | null;
  connect: (request: RemoteConnectRequest) => Promise<RemoteConnectOutcome>;
  disconnect: (sessionId: string) => Promise<void>;
  input: (sessionId: string, request: RemoteInput) => Promise<void>;
  clearLastClosed: () => void;
}

async function core() {
  return import("@tauri-apps/api/core");
}

export function useRemoteSessions(): RemoteApi {
  const [sessions, setSessions] = useState<RemoteSessionSummary[]>([]);
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

        const existing =
          await invoke<Array<Omit<RemoteSessionSummary, "frame">>>(
            "remote_sessions",
          );
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

  const clearLastClosed = useCallback(() => setLastClosed(null), []);

  return { sessions, lastClosed, connect, disconnect, input, clearLastClosed };
}
