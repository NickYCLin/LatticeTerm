export const protocolCatalog = [
  {
    id: "ssh",
    name: "SSH",
    summary: "Secure shell and terminal",
    defaultPort: 22,
  },
  {
    id: "sftp",
    name: "SFTP",
    summary: "Browse and transfer files",
    defaultPort: 22,
  },
  {
    id: "rdp",
    name: "RDP",
    summary: "High-performance remote desktop",
    defaultPort: 3389,
  },
  {
    id: "vnc",
    name: "VNC",
    summary: "Cross-platform screen sharing",
    defaultPort: 5900,
  },
] as const;

export type Protocol = (typeof protocolCatalog)[number]["id"];

export interface ConnectionDraft {
  name: string;
  protocol: Protocol;
  hostname: string;
  username: string;
  port: number;
}

export interface ConnectionProfile extends ConnectionDraft {
  id: string;
}

export function validateConnectionDraft(
  draft: ConnectionDraft,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const hostname = draft.hostname.trim();

  if (!draft.name.trim()) errors.name = "Enter a display name.";
  if (!hostname) {
    errors.hostname = "Enter a hostname or IP address.";
  } else if (/\s/.test(hostname)) {
    errors.hostname = "Hostnames cannot contain spaces.";
  }
  if (!Number.isInteger(draft.port) || draft.port < 1 || draft.port > 65535) {
    errors.port = "Use a port between 1 and 65535.";
  }

  return errors;
}

export function createConnectionProfile(
  draft: ConnectionDraft,
  id: string = crypto.randomUUID(),
): ConnectionProfile {
  return {
    id,
    name: draft.name.trim(),
    protocol: draft.protocol,
    hostname: draft.hostname.trim(),
    username: draft.username.trim(),
    port: draft.port,
  };
}
