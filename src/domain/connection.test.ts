import { describe, expect, it } from "vitest";
import { createConnectionProfile, validateConnectionDraft } from "./connection";

describe("connection profiles", () => {
  it("normalizes profile metadata without accepting secret fields", () => {
    const profile = createConnectionProfile(
      {
        name: "  Production  ",
        protocol: "ssh",
        hostname: "  server.example.com ",
        username: " deploy ",
        port: 22,
      },
      "profile-1",
    );

    expect(profile).toEqual({
      id: "profile-1",
      name: "Production",
      protocol: "ssh",
      hostname: "server.example.com",
      username: "deploy",
      port: 22,
    });
  });

  it("rejects missing metadata, whitespace in hosts, and invalid ports", () => {
    expect(
      validateConnectionDraft({
        name: "",
        protocol: "rdp",
        hostname: "not a host",
        username: "",
        port: 70000,
      }),
    ).toEqual({
      name: "Enter a display name.",
      hostname: "Hostnames cannot contain spaces.",
      port: "Use a port between 1 and 65535.",
    });
  });
});
