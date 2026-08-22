/**
 * Keeps decrypted vault material in memory only while the user is active.
 *
 * The timer controller is deliberately independent from React and the DOM so
 * its edge cases can be tested without pretending a browser exists. The hook
 * only translates real user/background events into controller actions.
 */

import { useEffect, useRef } from "react";
import type { Preferences, VaultAutoLockChoice } from "./preferences";
import type { VaultApi } from "./useVault";

const MINUTE_MS = 60_000;

export function vaultAutoLockDelay(
  choice: VaultAutoLockChoice,
): number | null {
  if (choice === "off") return null;
  return Number(choice) * MINUTE_MS;
}

export interface VaultAutoLockController {
  start: () => void;
  activity: () => void;
  background: () => void;
  stop: () => void;
}

interface VaultAutoLockControllerOptions {
  delayMs: number | null;
  lockOnBackground: boolean;
  schedule: (callback: () => void, delayMs: number) => number;
  cancel: (handle: number) => void;
  lock: () => void;
}

export function createVaultAutoLockController({
  delayMs,
  lockOnBackground,
  schedule,
  cancel,
  lock,
}: VaultAutoLockControllerOptions): VaultAutoLockController {
  let timer: number | null = null;
  let stopped = false;
  let fired = false;

  const clear = () => {
    if (timer === null) return;
    cancel(timer);
    timer = null;
  };

  const fire = () => {
    if (stopped || fired) return;
    fired = true;
    clear();
    lock();
  };

  const arm = () => {
    clear();
    if (stopped || fired || delayMs === null) return;
    timer = schedule(fire, delayMs);
  };

  return {
    start: arm,
    activity: arm,
    background: () => {
      if (lockOnBackground) fire();
    },
    stop: () => {
      stopped = true;
      clear();
    },
  };
}

type VaultAutoLockPreferences = Pick<
  Preferences,
  "vaultAutoLock" | "vaultLockOnBackground"
>;

export function useVaultAutoLock(
  preferences: VaultAutoLockPreferences,
  vault: VaultApi,
): void {
  const lockRef = useRef(vault.lock);
  lockRef.current = vault.lock;

  useEffect(() => {
    const delayMs = vaultAutoLockDelay(preferences.vaultAutoLock);
    if (
      vault.status?.state !== "unlocked" ||
      vault.busy ||
      (delayMs === null && !preferences.vaultLockOnBackground)
    ) {
      return;
    }

    const controller = createVaultAutoLockController({
      delayMs,
      lockOnBackground: preferences.vaultLockOnBackground,
      schedule: (callback, delay) => window.setTimeout(callback, delay),
      cancel: (handle) => window.clearTimeout(handle),
      lock: () => void lockRef.current(),
    });

    let lastPointerMoveAt = 0;
    const onActivity = () => controller.activity();
    const onPointerMove = () => {
      const now = Date.now();
      if (now - lastPointerMoveAt < 1_000) return;
      lastPointerMoveAt = now;
      controller.activity();
    };
    const onBackground = () => controller.background();
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") controller.background();
    };
    const activityEvents: (keyof WindowEventMap)[] = [
      "keydown",
      "pointerdown",
      "touchstart",
      "wheel",
      "focus",
    ];

    controller.start();
    activityEvents.forEach((eventName) =>
      window.addEventListener(eventName, onActivity, { passive: true }),
    );
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("blur", onBackground);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      controller.stop();
      activityEvents.forEach((eventName) =>
        window.removeEventListener(eventName, onActivity),
      );
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("blur", onBackground);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [
    preferences.vaultAutoLock,
    preferences.vaultLockOnBackground,
    vault.busy,
    vault.status?.state,
  ]);
}
