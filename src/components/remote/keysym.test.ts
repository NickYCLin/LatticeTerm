import { describe, expect, it } from "vitest";
import { keysymFor } from "./keysym";

describe("keysymFor Unicode text", () => {
  it("uses the X11 Unicode range for Chinese and astral characters", () => {
    expect(keysymFor("中", "")).toBe(0x01000000 + 0x4e2d);
    expect(keysymFor("😀", "")).toBe(0x01000000 + 0x1f600);
  });
});
