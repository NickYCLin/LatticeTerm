import { describe, expect, it } from "vitest";
import { createConnectionProfile } from "./connection";
import {
  parseAndValidateImport,
  serializeProfiles,
  type LatticeTermExport,
} from "./export";

describe("export & import", () => {
  const profile1 = createConnectionProfile(
    {
      name: "Gateway",
      protocol: "ssh",
      hostname: "gw.example.com",
      username: "admin",
      port: 22,
      environment: "production",
      group: "Infra",
      tags: ["edge", "eu"],
      favorite: true,
    },
    "p-1",
  );

  const profile2 = createConnectionProfile(
    {
      name: "Windows Desktop",
      protocol: "rdp",
      hostname: "rdp.example.com",
      username: "user",
      port: 3389,
      environment: "staging",
    },
    "p-2",
  );

  it("serializes profiles to json with metadata and version", () => {
    const json = serializeProfiles([profile1, profile2], "2026-08-20T00:00:00.000Z");
    const parsed = JSON.parse(json) as LatticeTermExport;

    expect(parsed.version).toBe(1);
    expect(parsed.application).toBe("LatticeTerm");
    expect(parsed.exportedAt).toBe("2026-08-20T00:00:00.000Z");
    expect(parsed.profiles).toHaveLength(2);
    expect(parsed.profiles[0].name).toBe("Gateway");
    expect(parsed.profiles[0].tags).toEqual(["edge", "eu"]);
  });

  it("successfully parses and validates valid export JSON", () => {
    const json = serializeProfiles([profile1, profile2]);
    const result = parseAndValidateImport(json);

    expect(result.errors).toHaveLength(0);
    expect(result.skippedCount).toBe(0);
    expect(result.validProfiles).toHaveLength(2);
    expect(result.validProfiles[0].name).toBe("Gateway");
    expect(result.validProfiles[0].protocol).toBe("ssh");
    expect(result.validProfiles[1].name).toBe("Windows Desktop");
    expect(result.validProfiles[1].protocol).toBe("rdp");
  });

  it("handles raw array of profiles without envelope", () => {
    const rawArray = [
      {
        name: "Test SSH",
        protocol: "ssh",
        hostname: "test.example.com",
        username: "test",
        port: 22,
      },
    ];
    const result = parseAndValidateImport(JSON.stringify(rawArray));

    expect(result.errors).toHaveLength(0);
    expect(result.validProfiles).toHaveLength(1);
    expect(result.validProfiles[0].name).toBe("Test SSH");
  });

  it("rejects invalid JSON syntax", () => {
    const result = parseAndValidateImport("{ not valid json");
    expect(result.errors).toEqual(["Invalid JSON format."]);
    expect(result.validProfiles).toHaveLength(0);
  });

  it("filters out invalid profiles and reports descriptive errors", () => {
    const invalidData = {
      version: 1,
      application: "LatticeTerm",
      profiles: [
        {
          name: "Good",
          protocol: "ssh",
          hostname: "valid.example.com",
          username: "admin",
          port: 22,
        },
        {
          name: "",
          protocol: "ssh",
          hostname: "no-name.example.com",
          port: 22,
        },
        {
          name: "Bad Host",
          protocol: "ssh",
          hostname: "spaces in host",
          port: 22,
        },
        {
          name: "Unknown Proto",
          protocol: "telnet",
          hostname: "valid.example.com",
          port: 23,
        },
      ],
    };

    const result = parseAndValidateImport(JSON.stringify(invalidData));
    expect(result.validProfiles).toHaveLength(1);
    expect(result.validProfiles[0].name).toBe("Good");
    expect(result.skippedCount).toBe(3);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});
