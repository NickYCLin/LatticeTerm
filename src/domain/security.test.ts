import { describe, expect, it } from "vitest";
import {
  formatFingerprint,
  hostTargetKey,
  isValidFingerprint,
} from "./security";

describe("security domain", () => {
  it("validates SHA-256 and MD5 fingerprints", () => {
    expect(
      isValidFingerprint("SHA256:uNiVztksCsDhccWphiWmKdqiUVeyDNAd5NNIzAVqpHg"),
    ).toBe(true);

    expect(
      isValidFingerprint("16:27:ac:a5:76:28:2d:36:63:1b:56:4d:eb:df:a6:48"),
    ).toBe(true);

    expect(isValidFingerprint("")).toBe(false);
    expect(isValidFingerprint("invalid-fingerprint")).toBe(false);
  });

  it("formats fingerprint cleanly", () => {
    expect(formatFingerprint("  SHA256:abc123xyz  ")).toBe("SHA256:abc123xyz");
    expect(formatFingerprint("")).toBe("Unknown");
  });

  it("generates host target key based on port standard", () => {
    expect(hostTargetKey("gateway.example.com", 22)).toBe("gateway.example.com");
    expect(hostTargetKey("gateway.example.com", 2222)).toBe(
      "[gateway.example.com]:2222",
    );
    expect(hostTargetKey("GATEWAY.example.com", 22)).toBe("gateway.example.com");
  });
});
