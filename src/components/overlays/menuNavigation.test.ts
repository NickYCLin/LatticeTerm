import { describe, expect, it } from "vitest";
import { menuNavigationIndex } from "./menuNavigation";

describe("menu navigation", () => {
  it("wraps vertical keys and supports Home and End", () => {
    expect(menuNavigationIndex("ArrowDown", 2, 3)).toBe(0);
    expect(menuNavigationIndex("ArrowUp", 0, 3)).toBe(2);
    expect(menuNavigationIndex("Home", 2, 3)).toBe(0);
    expect(menuNavigationIndex("End", 0, 3)).toBe(2);
    expect(menuNavigationIndex("ArrowRight", 1, 3)).toBeNull();
    expect(menuNavigationIndex("Tab", 1, 3)).toBeNull();
  });
});
