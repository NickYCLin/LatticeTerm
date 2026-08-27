import { describe, expect, it } from "vitest";
import {
  UNGROUPED,
  connectionTarget,
  createConnectionProfile,
  draftFromProfile,
  emptyDraft,
  findDuplicateTarget,
  isProtocolAvailable,
  parseTags,
  protocolUsesUsername,
  validateConnectionDraft,
} from "./connection";

describe("connection profiles", () => {
  it("normalizes profile metadata without accepting secret fields", () => {
    const profile = createConnectionProfile(
      {
        name: "  Production  ",
        protocol: "ssh",
        hostname: "  server.example.com ",
        username: " deploy ",
        port: 22,
        environment: "production",
        group: "  Core platform ",
        tags: [" Edge ", "edge", "eu west", ""],
        favorite: true,
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
      environment: "production",
      group: "Core platform",
      tags: ["edge", "eu-west"],
      favorite: true,
    });
  });

  it("falls back to unassigned metadata when a draft omits it", () => {
    const profile = createConnectionProfile(
      {
        name: "Lab box",
        protocol: "vnc",
        hostname: "192.0.2.87",
        username: "",
        port: 5901,
      },
      "profile-2",
    );

    expect(profile.environment).toBe("unassigned");
    expect(profile.group).toBe(UNGROUPED);
    expect(profile.tags).toEqual([]);
    expect(profile.favorite).toBe(false);
  });

  it("starts a draft on the default port of the chosen protocol", () => {
    expect(emptyDraft("rdp").port).toBe(3389);
    expect(emptyDraft("lattice").port).toBe(44900);
    expect(emptyDraft().protocol).toBe("ssh");
  });

  it("retains usernames only for account-based protocols", () => {
    const profile = createConnectionProfile(
      {
        name: "Remote screen",
        protocol: "lattice",
        hostname: "192.0.2.42",
        username: "operator-from-an-older-draft",
        port: 44900,
      },
      "profile-remote",
    );

    expect(profile.username).toBe("");
    expect(connectionTarget(profile)).toBe("192.0.2.42:44900");

    const vnc = createConnectionProfile(
      {
        name: "Shared screen",
        protocol: "vnc",
        hostname: "192.0.2.87",
        username: "stale-account",
        port: 5900,
      },
      "profile-vnc",
    );
    expect(vnc.username).toBe("");
    expect(protocolUsesUsername("ssh")).toBe(true);
    expect(protocolUsesUsername("sftp")).toBe(true);
    expect(protocolUsesUsername("rdp")).toBe(true);
    expect(protocolUsesUsername("vnc")).toBe(false);
    expect(protocolUsesUsername("lattice")).toBe(false);
  });

  it("reports only protocols with working session engines as available", () => {
    expect(isProtocolAvailable("ssh")).toBe(true);
    expect(isProtocolAvailable("rdp")).toBe(true);
    expect(isProtocolAvailable("lattice")).toBe(true);
    expect(isProtocolAvailable("sftp")).toBe(true);
    expect(isProtocolAvailable("vnc")).toBe(true);
  });

  it("round-trips a profile into an editable draft", () => {
    const profile = createConnectionProfile(
      {
        name: "Lab box",
        protocol: "vnc",
        hostname: "192.0.2.87",
        username: "",
        port: 5901,
      },
      "profile-3",
    );

    // Ungrouped is a display bucket, not a group the user typed.
    expect(draftFromProfile(profile).group).toBe("");
  });

  it("formats a target the way an operator reads it", () => {
    const withUser = createConnectionProfile(
      {
        name: "Edge",
        protocol: "ssh",
        hostname: "gateway.example.com",
        username: "operator",
        port: 2222,
      },
      "profile-4",
    );
    const withoutUser = createConnectionProfile(
      {
        name: "Lab",
        protocol: "vnc",
        hostname: "192.0.2.87",
        username: "",
        port: 5900,
      },
      "profile-5",
    );

    expect(connectionTarget(withUser)).toBe(
      "operator@gateway.example.com:2222",
    );
    expect(connectionTarget(withoutUser)).toBe("192.0.2.87:5900");
  });
});

describe("tag parsing", () => {
  it("splits, normalizes and de-duplicates tag input", () => {
    expect(parseTags("Edge, edge\nEU West ,, ")).toEqual(["edge", "eu-west"]);
  });
});

describe("draft validation", () => {
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
      name: { key: "validation.nameRequired" },
      hostname: { key: "validation.hostSpaces" },
      username: { key: "validation.usernameRequired" },
      port: {
        key: "validation.portRange",
        values: { min: 1, max: 65535 },
      },
    });
  });

  it("explains host input that belongs in another field", () => {
    const scheme = validateConnectionDraft({
      ...emptyDraft(),
      name: "Edge",
      hostname: "ssh://gateway.example.com",
    });
    const account = validateConnectionDraft({
      ...emptyDraft(),
      name: "Edge",
      hostname: "operator@gateway.example.com",
    });
    const path = validateConnectionDraft({
      ...emptyDraft(),
      name: "Edge",
      hostname: "gateway.example.com/admin",
    });

    expect(scheme.hostname).toEqual({ key: "validation.hostScheme" });
    expect(account.hostname).toEqual({ key: "validation.hostAccount" });
    expect(path.hostname).toEqual({ key: "validation.hostPath" });
  });

  it("accepts IPv6 literals and rejects unusable characters", () => {
    expect(
      validateConnectionDraft({
        ...emptyDraft(),
        name: "Edge",
        hostname: "[2001:db8::1]",
      }).hostname,
    ).toBeUndefined();

    expect(
      validateConnectionDraft({
        ...emptyDraft(),
        name: "Edge",
        hostname: "gateway,example.com",
      }).hostname,
    ).toEqual({ key: "validation.hostChars" });
  });

  it("limits organisation metadata so rows stay readable", () => {
    const errors = validateConnectionDraft({
      ...emptyDraft(),
      name: "Edge",
      hostname: "gateway.example.com",
      username: "an operator",
      tags: ["a", "b", "c", "d", "e", "f", "g"],
    });

    expect(errors.username).toEqual({ key: "validation.usernameSpaces" });
    expect(errors.tags).toEqual({
      key: "validation.tagsTooMany",
      values: { max: 6 },
    });
  });

  it("accepts a complete draft", () => {
    expect(
      validateConnectionDraft({
        name: "Edge gateway",
        protocol: "ssh",
        hostname: "gateway.example.com",
        username: "operator",
        port: 22,
        environment: "production",
        group: "Core platform",
        tags: ["edge"],
      }),
    ).toEqual({});
  });

  it("requires usernames only for account-based protocols", () => {
    for (const protocol of ["ssh", "sftp", "rdp"] as const) {
      expect(
        validateConnectionDraft({
          ...emptyDraft(protocol),
          name: "Remote host",
          hostname: "host.example.com",
        }).username,
      ).toEqual({ key: "validation.usernameRequired" });
    }

    for (const protocol of ["vnc", "lattice"] as const) {
      expect(
        validateConnectionDraft({
          ...emptyDraft(protocol),
          name: "Remote host",
          hostname: "host.example.com",
        }).username,
      ).toBeUndefined();
    }
  });
});

describe("duplicate targets", () => {
  const base = createConnectionProfile(
    {
      name: "Edge gateway",
      protocol: "ssh",
      hostname: "gateway.example.com",
      username: "operator",
      port: 22,
    },
    "profile-a",
  );

  it("reports another profile that addresses the same service", () => {
    const candidate = createConnectionProfile(
      {
        name: "Edge gateway copy",
        protocol: "ssh",
        hostname: "GATEWAY.example.com",
        username: "root",
        port: 22,
      },
      "profile-b",
    );

    expect(findDuplicateTarget([base], candidate)?.id).toBe("profile-a");
  });

  it("ignores itself, other protocols and other ports", () => {
    expect(findDuplicateTarget([base], base)).toBeUndefined();
    expect(
      findDuplicateTarget([base], {
        ...base,
        id: "profile-c",
        protocol: "sftp",
      }),
    ).toBeUndefined();
    expect(
      findDuplicateTarget([base], { ...base, id: "profile-d", port: 2222 }),
    ).toBeUndefined();
  });
});
