import { describe, expect, it } from "vitest";
import {
  createTunnelFromDraft,
  formatBytes,
  formatSshTunnelCommand,
  isValidPort,
  validateTunnelDraft,
  type TunnelConfig,
  type TunnelDraft,
} from "./tunnel";

describe("tunnel domain model", () => {
  it("validates ports accurately within 1 - 65535", () => {
    expect(isValidPort(1)).toBe(true);
    expect(isValidPort(22)).toBe(true);
    expect(isValidPort(65535)).toBe(true);
    expect(isValidPort("8080")).toBe(true);

    expect(isValidPort(0)).toBe(false);
    expect(isValidPort(65536)).toBe(false);
    expect(isValidPort(-1)).toBe(false);
    expect(isValidPort("abc")).toBe(false);
    expect(isValidPort("")).toBe(false);
    expect(isValidPort("80.5")).toBe(false);
  });

  it("validates a complete local tunnel draft successfully", () => {
    const draft: TunnelDraft = {
      name: "PostgreSQL Tunnel",
      type: "local",
      profileId: "profile-123",
      localHost: "127.0.0.1",
      localPort: 5432,
      remoteHost: "db-internal.internal",
      remotePort: 5432,
    };

    const errors = validateTunnelDraft(draft);
    expect(errors).toHaveLength(0);

    const tunnel = createTunnelFromDraft(draft);
    expect(tunnel.name).toBe("PostgreSQL Tunnel");
    expect(tunnel.type).toBe("local");
    expect(tunnel.localPort).toBe(5432);
    expect(tunnel.remoteHost).toBe("db-internal.internal");
    expect(tunnel.remotePort).toBe(5432);
  });

  it("catches missing required fields in tunnel draft", () => {
    const invalidDraft: TunnelDraft = {
      name: "",
      type: "local",
      profileId: "",
      localHost: "",
      localPort: "invalid",
      remoteHost: "",
      remotePort: 999999,
    };

    const errors = validateTunnelDraft(invalidDraft);
    expect(errors.map((e) => e.field)).toEqual([
      "name",
      "profileId",
      "localHost",
      "localPort",
      "remoteHost",
      "remotePort",
    ]);
  });

  it("does not require remote target for dynamic SOCKS5 tunnels", () => {
    const dynamicDraft: TunnelDraft = {
      name: "SOCKS5 Proxy",
      type: "dynamic",
      profileId: "profile-jump",
      localHost: "127.0.0.1",
      localPort: 1080,
      remoteHost: "",
      remotePort: "",
    };

    const errors = validateTunnelDraft(dynamicDraft);
    expect(errors).toHaveLength(0);

    const tunnel = createTunnelFromDraft(dynamicDraft);
    expect(tunnel.type).toBe("dynamic");
    expect(tunnel.localPort).toBe(1080);
    expect(tunnel.remoteHost).toBe("");
    expect(tunnel.remotePort).toBe(0);
  });

  it("generates correct OpenSSH command line equivalents", () => {
    const localTunnel: TunnelConfig = {
      id: "t1",
      name: "Local Web",
      type: "local",
      profileId: "p1",
      localHost: "127.0.0.1",
      localPort: 8080,
      remoteHost: "10.0.0.2",
      remotePort: 80,
      createdAt: 1000,
      updatedAt: 1000,
    };

    const cmdLocal = formatSshTunnelCommand(localTunnel, "admin", "gateway.cloud", 2222);
    expect(cmdLocal).toBe("ssh -L 8080:10.0.0.2:80 admin@gateway.cloud -p 2222 -N");

    const dynamicTunnel: TunnelConfig = {
      id: "t2",
      name: "Dynamic Proxy",
      type: "dynamic",
      profileId: "p1",
      localHost: "0.0.0.0",
      localPort: 1080,
      remoteHost: "",
      remotePort: 0,
      createdAt: 1000,
      updatedAt: 1000,
    };

    const cmdDynamic = formatSshTunnelCommand(dynamicTunnel, "root", "vpn.corp.net", 22);
    expect(cmdDynamic).toBe("ssh -D 0.0.0.0:1080 root@vpn.corp.net -N");
  });

  it("formats byte statistics cleanly", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(2097152)).toBe("2.0 MB");
    expect(formatBytes(10737418240)).toBe("10.00 GB");
  });
});
