import { describe, expect, it, vi } from "vitest";
import {
  createVaultAutoLockController,
  vaultAutoLockDelay,
} from "./useVaultAutoLock";

function scheduler() {
  let nextHandle = 0;
  const pending = new Map<number, () => void>();
  return {
    pending,
    schedule(callback: () => void) {
      nextHandle += 1;
      pending.set(nextHandle, callback);
      return nextHandle;
    },
    cancel(handle: number) {
      pending.delete(handle);
    },
  };
}

describe("vaultAutoLockDelay", () => {
  it("converts supported choices to milliseconds", () => {
    expect(vaultAutoLockDelay("off")).toBeNull();
    expect(vaultAutoLockDelay("5")).toBe(300_000);
    expect(vaultAutoLockDelay("60")).toBe(3_600_000);
  });
});

describe("createVaultAutoLockController", () => {
  it("resets the idle deadline after activity and locks only once", () => {
    const timer = scheduler();
    const lock = vi.fn();
    const controller = createVaultAutoLockController({
      delayMs: 900_000,
      lockOnBackground: false,
      schedule: timer.schedule,
      cancel: timer.cancel,
      lock,
    });

    controller.start();
    expect([...timer.pending.keys()]).toEqual([1]);
    controller.activity();
    expect([...timer.pending.keys()]).toEqual([2]);

    const deadline = timer.pending.get(2);
    deadline?.();
    deadline?.();
    controller.activity();

    expect(lock).toHaveBeenCalledTimes(1);
    expect(timer.pending.size).toBe(0);
  });

  it("locks immediately in the background even when idle locking is off", () => {
    const timer = scheduler();
    const lock = vi.fn();
    const controller = createVaultAutoLockController({
      delayMs: null,
      lockOnBackground: true,
      schedule: timer.schedule,
      cancel: timer.cancel,
      lock,
    });

    controller.start();
    controller.background();
    controller.background();

    expect(lock).toHaveBeenCalledTimes(1);
    expect(timer.pending.size).toBe(0);
  });

  it("cancels a pending lock when the controller stops", () => {
    const timer = scheduler();
    const lock = vi.fn();
    const controller = createVaultAutoLockController({
      delayMs: 300_000,
      lockOnBackground: true,
      schedule: timer.schedule,
      cancel: timer.cancel,
      lock,
    });

    controller.start();
    const staleDeadline = timer.pending.get(1);
    controller.stop();
    staleDeadline?.();
    controller.background();

    expect(lock).not.toHaveBeenCalled();
    expect(timer.pending.size).toBe(0);
  });
});
