import { describe, expect, it } from "vitest";
import {
  TERMINAL_FONT_FAMILIES,
  TERMINAL_FONT_FAMILY,
  TERMINAL_LETTER_SPACING,
} from "./terminalTheme";

describe("terminal font family", () => {
  it("uses concrete Linux monospace families before the generic fallback", () => {
    expect(TERMINAL_FONT_FAMILIES).toContain('"Noto Sans Mono"');
    expect(TERMINAL_FONT_FAMILIES).toContain('"DejaVu Sans Mono"');
    expect(TERMINAL_FONT_FAMILIES[TERMINAL_FONT_FAMILIES.length - 1]).toBe(
      "monospace",
    );
    expect(TERMINAL_FONT_FAMILY).not.toContain("ui-monospace");
  });

  it("tightens xterm cells so normal text does not resemble spaced input", () => {
    expect(TERMINAL_LETTER_SPACING).toBe(-1);
  });
});
