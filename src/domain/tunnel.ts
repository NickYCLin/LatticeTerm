/**
 * SSH Tunnel & Port Forwarding domain model.
 *
 * Defines the types, validation rules, and helpers for Local, Remote,
 * and Dynamic (SOCKS5) port forwarding configurations.
 */

export type TunnelType = "local" | "remote" | "dynamic";

export type TunnelStatus = "stopped" | "starting" | "active" | "error";

export interface TunnelStats {
  bytesUploaded: number;
  bytesDownloaded: number;
  activeConnections: number;
  startedAt?: number;
  lastError?: string;
}

export interface TunnelConfig {
  id: string;
  name: string;
  type: TunnelType;
  /** Connection Profile ID used as the SSH Jump / Gateway host */
  profileId: string;
  /** Local bind address (e.g. '127.0.0.1' or '0.0.0.0') */
  localHost: string;
  /** Local listening port (1 - 65535) */
  localPort: number;
  /** Remote target host (used for local & remote forwarding, e.g. 'localhost' or '10.0.0.5') */
  remoteHost: string;
  /** Remote target port (used for local & remote forwarding, e.g. 5432, 3306) */
  remotePort: number;
  /** Automatically start tunnel when LatticeTerm starts */
  autoStart?: boolean;
  /** Optional description or notes */
  description?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TunnelDraft {
  name: string;
  type: TunnelType;
  profileId: string;
  localHost: string;
  localPort: string | number;
  remoteHost: string;
  remotePort: string | number;
  autoStart?: boolean;
  description?: string;
}

export interface TunnelValidationError {
  field: keyof TunnelDraft;
  messageKey: string;
}

/**
 * Validates a port string or number (1 - 65535).
 */
export function isValidPort(port: string | number): boolean {
  const num = typeof port === "number" ? port : parseInt(port.trim(), 10);
  return !isNaN(num) && num >= 1 && num <= 65535 && String(num) === String(port).trim();
}

export function isIpLiteral(value: string): boolean {
  const host = value.trim();
  const ipv4 = host.split(".");
  if (
    ipv4.length === 4 &&
    ipv4.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  ) {
    return true;
  }
  return (
    host.includes(":") &&
    /^[0-9a-f:]+$/i.test(host) &&
    !host.includes(":::") &&
    host.split(":").length <= 9
  );
}

export function isLoopbackIp(value: string): boolean {
  const host = value.trim().toLowerCase();
  return host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
}

/**
 * Validates a tunnel draft and returns a list of validation errors.
 */
export function validateTunnelDraft(draft: TunnelDraft): TunnelValidationError[] {
  const errors: TunnelValidationError[] = [];

  if (!draft.name || draft.name.trim().length === 0) {
    errors.push({ field: "name", messageKey: "tunnels.error.nameRequired" });
  }

  if (!draft.profileId || draft.profileId.trim().length === 0) {
    errors.push({ field: "profileId", messageKey: "tunnels.error.profileRequired" });
  }

  if (!draft.localHost || draft.localHost.trim().length === 0) {
    errors.push({ field: "localHost", messageKey: "tunnels.error.localHostRequired" });
  } else if (!isIpLiteral(draft.localHost)) {
    errors.push({ field: "localHost", messageKey: "tunnels.error.invalidBindIp" });
  } else if (draft.type === "dynamic" && !isLoopbackIp(draft.localHost)) {
    errors.push({ field: "localHost", messageKey: "tunnels.error.dynamicLoopback" });
  }

  if (!isValidPort(draft.localPort)) {
    errors.push({ field: "localPort", messageKey: "tunnels.error.invalidLocalPort" });
  }

  if (draft.type === "local" || draft.type === "remote") {
    if (!draft.remoteHost || draft.remoteHost.trim().length === 0) {
      errors.push({ field: "remoteHost", messageKey: "tunnels.error.remoteHostRequired" });
    }
    if (!isValidPort(draft.remotePort)) {
      errors.push({ field: "remotePort", messageKey: "tunnels.error.invalidRemotePort" });
    }
  }

  return errors;
}

/**
 * Constructs a new TunnelConfig from a validated draft.
 */
export function createTunnelFromDraft(
  draft: TunnelDraft,
  existingId?: string,
): TunnelConfig {
  const now = Date.now();
  return {
    id: existingId ?? `tunnel-${now}-${Math.random().toString(36).substring(2, 7)}`,
    name: draft.name.trim(),
    type: draft.type,
    profileId: draft.profileId.trim(),
    localHost: draft.localHost.trim() || "127.0.0.1",
    localPort: typeof draft.localPort === "number" ? draft.localPort : parseInt(draft.localPort.trim(), 10),
    remoteHost: draft.type === "dynamic" ? "" : draft.remoteHost.trim(),
    remotePort: draft.type === "dynamic" ? 0 : (typeof draft.remotePort === "number" ? draft.remotePort : parseInt(draft.remotePort.trim(), 10)),
    autoStart: Boolean(draft.autoStart),
    description: draft.description?.trim(),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Generates the equivalent OpenSSH command line string for quick copying.
 */
export function formatSshTunnelCommand(
  tunnel: TunnelConfig,
  gatewayUser = "user",
  gatewayHost = "gateway.example.com",
  gatewayPort = 22,
): string {
  const portArg = gatewayPort !== 22 ? ` -p ${gatewayPort}` : "";
  const hostTarget = `${gatewayUser}@${gatewayHost}${portArg}`;

  switch (tunnel.type) {
    case "local": {
      const bind = tunnel.localHost !== "127.0.0.1" && tunnel.localHost !== "localhost" ? `${tunnel.localHost}:` : "";
      return `ssh -L ${bind}${tunnel.localPort}:${tunnel.remoteHost}:${tunnel.remotePort} ${hostTarget} -N`;
    }
    case "remote": {
      const bind = tunnel.localHost !== "127.0.0.1" && tunnel.localHost !== "localhost" ? `${tunnel.localHost}:` : "";
      return `ssh -R ${bind}${tunnel.localPort}:${tunnel.remoteHost}:${tunnel.remotePort} ${hostTarget} -N`;
    }
    case "dynamic": {
      const bind = tunnel.localHost !== "127.0.0.1" && tunnel.localHost !== "localhost" ? `${tunnel.localHost}:` : "";
      return `ssh -D ${bind}${tunnel.localPort} ${hostTarget} -N`;
    }
  }
}

/**
 * Formats byte counts into human-readable strings (KB, MB, GB).
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
