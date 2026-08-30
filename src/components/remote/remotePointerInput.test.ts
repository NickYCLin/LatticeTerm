import { describe, expect, it } from "vitest";
import { RemotePointerInputState } from "./remotePointerInput";

describe("Lattice Remote pointer input state", () => {
  it("keeps a normal tap from turning into a global release", () => {
    const state = new RemotePointerInputState();

    expect(state.begin(7, true, 1)).toMatchObject({
      accepted: true,
      buttonChanges: [{ button: 0, pressed: true }],
      releaseAll: false,
    });
    expect(state.end(7, true, 0)).toMatchObject({
      accepted: true,
      buttonChanges: [{ button: 0, pressed: false }],
      releaseAll: false,
    });
    expect(state.cancel(7, true)).toMatchObject({
      accepted: false,
      releaseAll: false,
    });
  });

  it("ignores a secondary pointer but releases an unexpectedly lost owner", () => {
    const state = new RemotePointerInputState();
    state.begin(7, true, 1);

    expect(state.cancel(8, false)).toMatchObject({
      accepted: false,
      releaseAll: false,
    });
    expect(state.activePointerId).toBe(7);
    expect(state.cancel(7, true)).toEqual({
      accepted: true,
      buttonChanges: [],
      releaseAll: true,
    });
    expect(state.activePointerId).toBeNull();
  });

  it("preserves every transition in a multi-button mouse chord", () => {
    const state = new RemotePointerInputState();

    expect(state.begin(4, true, 1).buttonChanges).toEqual([
      { button: 0, pressed: true },
    ]);
    expect(state.move(4, true, 3).buttonChanges).toEqual([
      { button: 2, pressed: true },
    ]);
    expect(state.move(4, true, 2).buttonChanges).toEqual([
      { button: 0, pressed: false },
    ]);
    expect(state.end(4, true, 0).buttonChanges).toEqual([
      { button: 2, pressed: false },
    ]);
  });
});
