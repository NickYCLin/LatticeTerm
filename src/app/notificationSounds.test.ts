import { describe, expect, it } from "vitest";
import { notificationToneSequence } from "./notificationSounds";

describe("notification sounds", () => {
  it("keeps off silent and gives every named sound a short sequence", () => {
    expect(notificationToneSequence("off")).toEqual([]);
    for (const sound of ["clear", "gentle", "double", "wood"] as const) {
      const tones = notificationToneSequence(sound);
      expect(tones.length).toBeGreaterThan(0);
      expect(Math.max(...tones.map((tone) => tone.delay + tone.duration))).toBeLessThan(
        0.75,
      );
    }
  });
});
