import { describe, expect, it } from "vitest";
import {
  formatFingerprint,
  hostTargetKey,
  isValidFingerprint,
  isValidHost,
} from "./security";

describe("security domain", () => {
  it("accepts only the OpenSSH SHA-256 fingerprint form", () => {
    expect(
      isValidFingerprint("SHA256:uNiVztksCsDhccWphiWmKdqiUVeyDNAd5NNIzAVqpHg"),
    ).toBe(true);

    expect(isValidFingerprint("")).toBe(false);
    expect(isValidFingerprint("invalid-fingerprint")).toBe(false);
    expect(
      isValidFingerprint("16:27:ac:a5:76:28:2d:36:63:1b:56:4d:eb:df:a6:48"),
    ).toBe(false);
    expect(
      isValidFingerprint("SHA256:uNiVztksCsDhccWphiWmKdqiUVeyDNAd5NNIzAVqpHg="),
    ).toBe(false);
    expect(
      isValidFingerprint("SHA256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"),
    ).toBe(false);
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

  it("validates the same host shapes accepted by connection profiles", () => {
    expect(isValidHost("gateway.example.com")).toBe(true);
    expect(isValidHost("2001:db8::1")).toBe(true);
    expect(isValidHost("ssh://gateway.example.com")).toBe(false);
    expect(isValidHost("user@gateway.example.com")).toBe(false);
    expect(isValidHost("gateway.example.com/path")).toBe(false);
    expect(isValidHost("bad host")).toBe(false);
  });
});
