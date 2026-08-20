import { describe, expect, it } from "vitest";
import { credentialKindFor } from "./useSavedCredential";
import type { ConnectionProfile } from "../domain/connection";

function profile(protocol: ConnectionProfile["protocol"]): ConnectionProfile {
  return {
    id: "profile-1",
    name: "Example",
    protocol,
    hostname: "example.test",
    username: "operator",
    port: protocol === "rdp" ? 3389 : 22,
    environment: "development",
    group: "Tests",
    tags: [],
    favorite: false,
  };
}

describe("credentialKindFor", () => {
  it("maps SSH and RDP to distinct OS-store entries", () => {
    expect(credentialKindFor(profile("ssh"))).toBe("sshPassword");
    expect(credentialKindFor(profile("rdp"))).toBe("rdpPassword");
  });

  it("never persists one-time or unsupported protocol secrets", () => {
    expect(credentialKindFor(profile("lattice"))).toBeNull();
    expect(credentialKindFor(profile("sftp"))).toBe("sftpPassword");
    expect(credentialKindFor(profile("vnc"))).toBeNull();
  });
});
