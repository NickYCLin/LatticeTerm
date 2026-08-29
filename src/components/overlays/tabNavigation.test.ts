import { describe, expect, it } from "vitest";
import {
  tabNavigationIndex,
  tabNavigationTargetIndex,
} from "./tabNavigation";

describe("tab navigation", () => {
  it("wraps horizontal keys and supports Home and End", () => {
    expect(tabNavigationIndex("ArrowRight", 2, 3)).toBe(0);
    expect(tabNavigationIndex("ArrowLeft", 0, 3)).toBe(2);
    expect(tabNavigationIndex("Home", 2, 3)).toBe(0);
    expect(tabNavigationIndex("End", 0, 3)).toBe(2);
    expect(tabNavigationIndex("ArrowDown", 1, 3)).toBeNull();
    expect(tabNavigationIndex("Tab", 1, 3)).toBeNull();
  });

  it("skips disabled tabs", () => {
    expect(
      tabNavigationTargetIndex("ArrowRight", 0, [false, true, false]),
    ).toBe(2);
    expect(
      tabNavigationTargetIndex("ArrowLeft", 0, [false, true, false]),
    ).toBe(2);
    expect(
      tabNavigationTargetIndex("ArrowRight", 0, [true, true, true]),
    ).toBeNull();
  });
});
