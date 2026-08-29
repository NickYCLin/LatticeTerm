import { describe, expect, it } from "vitest";
import { modalTabTargetIndex } from "./modalFocus";

describe("modal focus", () => {
  it("wraps Tab only at modal boundaries", () => {
    expect(modalTabTargetIndex(2, 3, false)).toBe(0);
    expect(modalTabTargetIndex(0, 3, true)).toBe(2);
    expect(modalTabTargetIndex(1, 3, false)).toBeNull();
    expect(modalTabTargetIndex(1, 3, true)).toBeNull();
  });

  it("moves focus into a modal when it starts outside", () => {
    expect(modalTabTargetIndex(-1, 3, false)).toBe(0);
    expect(modalTabTargetIndex(-1, 3, true)).toBe(2);
    expect(modalTabTargetIndex(-1, 0, false)).toBeNull();
  });
});
