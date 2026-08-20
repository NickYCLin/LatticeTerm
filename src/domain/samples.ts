/**
 * Sample workspace used by the empty state.
 *
 * Every host here is a documentation-only name from RFC 2606 (`example.com`)
 * or an address from RFC 5737 (`192.0.2.0/24`). Real hosts, customer names and
 * internal inventories must never appear in this repository.
 */

import type { ConnectionProfile } from "./connection";

export const sampleProfiles: ConnectionProfile[] = [
  {
    id: "sample-edge-gateway",
    name: "Edge gateway",
    protocol: "ssh",
    hostname: "gateway.example.com",
    username: "operator",
    port: 22,
    environment: "production",
    group: "Core platform",
    tags: ["gateway", "eu-west"],
    favorite: true,
  },
  {
    id: "sample-app-node-01",
    name: "App node 01",
    protocol: "ssh",
    hostname: "app-01.example.com",
    username: "deploy",
    port: 22,
    environment: "production",
    group: "Core platform",
    tags: ["app"],
    favorite: false,
  },
  {
    id: "sample-artifact-store",
    name: "Artifact store",
    protocol: "sftp",
    hostname: "files.example.net",
    username: "release",
    port: 22,
    environment: "staging",
    group: "Core platform",
    tags: ["artifacts"],
    favorite: true,
  },
  {
    id: "sample-build-agent",
    name: "Build agent",
    protocol: "ssh",
    hostname: "192.0.2.41",
    username: "runner",
    port: 2222,
    environment: "development",
    group: "Build farm",
    tags: ["ci"],
    favorite: false,
  },
  {
    id: "sample-reporting-desktop",
    name: "Reporting desktop",
    protocol: "rdp",
    hostname: "desktop.example.org",
    username: "analyst",
    port: 3389,
    environment: "staging",
    group: "Workstations",
    tags: ["windows"],
    favorite: false,
  },
  {
    id: "sample-lab-console",
    name: "Lab console",
    protocol: "vnc",
    hostname: "192.0.2.87",
    username: "",
    port: 5901,
    environment: "development",
    group: "Workstations",
    tags: ["lab", "kiosk"],
    favorite: false,
  },
];
