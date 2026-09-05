import { describe, expect, it } from "vitest";
import { normalizePairingToken } from "./pairingToken";

describe("pairing tokens", () => {
  it("accepts the complete generated token with readable separators", () => {
    expect(normalizePairingToken(" 0123-4567-89ab-cdef-0123-4567-89ab-cdef "))
      .toBe("0123456789ABCDEF0123456789ABCDEF");
  });
  it("rejects short codes, hidden characters and truncated or extra input", () => {
    for (const input of ["1234-5678", "A".repeat(31), "A".repeat(33), "G".repeat(32), `${"A".repeat(32)}\u200b`]) {
      expect(normalizePairingToken(input)).toBeNull();
    }
  });
});
