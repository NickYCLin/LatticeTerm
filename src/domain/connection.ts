/**
 * Connection metadata model.
 *
 * This module deliberately has no field for a password, passphrase, private
 * key or token. Secrets belong to the OS credential store, which is a later
 * milestone; keeping the shape secret-free means a profile can be logged,
 * exported or shown in a screenshot without leaking anything.
 */

export const protocolCatalog = [
  {
    id: "ssh",
    name: "SSH",
    summary: "Interactive shell session",
    defaultPort: 22,
    milestone: 1,
  },
  {
    id: "sftp",
    name: "SFTP",
    summary: "Browse and transfer files",
    defaultPort: 22,
    milestone: 3,
  },
  {
    id: "rdp",
    name: "RDP",
    summary: "Windows remote desktop",
    defaultPort: 3389,
    milestone: 4,
  },
  {
    id: "vnc",
    name: "VNC",
    summary: "Cross-platform screen sharing",
    defaultPort: 5900,
    milestone: 5,
  },
] as const;

export type Protocol = (typeof protocolCatalog)[number]["id"];

export type ProtocolDefinition = (typeof protocolCatalog)[number];

export const environmentCatalog = [
  { id: "production", label: "Production", hint: "Live systems" },
  { id: "staging", label: "Staging", hint: "Pre-release systems" },
  { id: "development", label: "Development", hint: "Build and test systems" },
  { id: "unassigned", label: "Unassigned", hint: "No environment set" },
] as const;

export type Environment = (typeof environmentCatalog)[number]["id"];

export const UNGROUPED = "Ungrouped";

export const limits = {
  nameLength: 60,
  hostnameLength: 253,
  usernameLength: 64,
  groupLength: 40,
  tagLength: 24,
  tagCount: 6,
  minPort: 1,
  maxPort: 65535,
} as const;

export interface ConnectionDraft {
  name: string;
  protocol: Protocol;
  hostname: string;
  username: string;
  port: number;
  /** Optional organisation metadata; omitted drafts fall back to defaults. */
  environment?: Environment;
  group?: string;
  tags?: string[];
  favorite?: boolean;
}

export interface ConnectionProfile {
  id: string;
  name: string;
  protocol: Protocol;
  hostname: string;
  username: string;
  port: number;
  environment: Environment;
  group: string;
  tags: string[];
  favorite: boolean;
}

export type ValidationErrors = Partial<
  Record<keyof ConnectionDraft, string> & { tags: string }
>;

export function findProtocol(protocol: Protocol): ProtocolDefinition {
  return protocolCatalog.find((entry) => entry.id === protocol)!;
}

export function findEnvironment(environment: Environment) {
  return environmentCatalog.find((entry) => entry.id === environment)!;
}

export function emptyDraft(protocol: Protocol = "ssh"): ConnectionDraft {
  return {
    name: "",
    protocol,
    hostname: "",
    username: "",
    port: findProtocol(protocol).defaultPort,
    environment: "unassigned",
    group: "",
    tags: [],
    favorite: false,
  };
}

export function draftFromProfile(profile: ConnectionProfile): ConnectionDraft {
  return {
    name: profile.name,
    protocol: profile.protocol,
    hostname: profile.hostname,
    username: profile.username,
    port: profile.port,
    environment: profile.environment,
    group: profile.group === UNGROUPED ? "" : profile.group,
    tags: [...profile.tags],
    favorite: profile.favorite,
  };
}

/** Splits a free-text tag field into normalised, de-duplicated tags. */
export function parseTags(input: string | string[]): string[] {
  const parts = Array.isArray(input) ? input : input.split(/[,\n]/);
  const seen = new Set<string>();

  for (const part of parts) {
    const tag = part.trim().replace(/\s+/g, "-").toLowerCase();
    if (tag) seen.add(tag);
  }

  return [...seen];
}

/**
 * A hostname or IP literal. Kept intentionally permissive about the exact
 * label rules the resolver applies, while rejecting the shapes that would
 * silently break a command line: whitespace, schemes and embedded paths.
 */
const hostPattern = /^[A-Za-z0-9._:\-[\]%]+$/;

export function validateConnectionDraft(
  draft: ConnectionDraft,
): ValidationErrors {
  const errors: ValidationErrors = {};
  const name = draft.name.trim();
  const hostname = draft.hostname.trim();
  const username = draft.username.trim();
  const group = (draft.group ?? "").trim();
  const tags = parseTags(draft.tags ?? []);

  if (!name) {
    errors.name = "Enter a display name.";
  } else if (name.length > limits.nameLength) {
    errors.name = `Use ${limits.nameLength} characters or fewer.`;
  }

  if (!hostname) {
    errors.hostname = "Enter a hostname or IP address.";
  } else if (/\s/.test(hostname)) {
    errors.hostname = "Hostnames cannot contain spaces.";
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(hostname)) {
    errors.hostname = "Enter the host only, without a scheme such as ssh://.";
  } else if (hostname.includes("/")) {
    errors.hostname = "Enter the host only, without a path.";
  } else if (hostname.includes("@")) {
    errors.hostname = "Put the account in the username field, not the host.";
  } else if (!hostPattern.test(hostname)) {
    errors.hostname = "Use letters, digits, dots, colons or hyphens.";
  } else if (hostname.length > limits.hostnameLength) {
    errors.hostname = `Use ${limits.hostnameLength} characters or fewer.`;
  }

  if (/\s/.test(username)) {
    errors.username = "Usernames cannot contain spaces.";
  } else if (username.length > limits.usernameLength) {
    errors.username = `Use ${limits.usernameLength} characters or fewer.`;
  }

  if (!Number.isInteger(draft.port)) {
    errors.port = "Enter a whole number.";
  } else if (draft.port < limits.minPort || draft.port > limits.maxPort) {
    errors.port = `Use a port between ${limits.minPort} and ${limits.maxPort}.`;
  }

  if (group.length > limits.groupLength) {
    errors.group = `Use ${limits.groupLength} characters or fewer.`;
  }

  if (tags.length > limits.tagCount) {
    errors.tags = `Use ${limits.tagCount} tags or fewer.`;
  } else if (tags.some((tag) => tag.length > limits.tagLength)) {
    errors.tags = `Each tag must be ${limits.tagLength} characters or fewer.`;
  }

  return errors;
}

export function createConnectionProfile(
  draft: ConnectionDraft,
  id: string = crypto.randomUUID(),
): ConnectionProfile {
  const group = (draft.group ?? "").trim();

  return {
    id,
    name: draft.name.trim(),
    protocol: draft.protocol,
    hostname: draft.hostname.trim(),
    username: draft.username.trim(),
    port: draft.port,
    environment: draft.environment ?? "unassigned",
    group: group || UNGROUPED,
    tags: parseTags(draft.tags ?? []),
    favorite: draft.favorite ?? false,
  };
}

/** `user@host:port`, the form an operator recognises at a glance. */
export function connectionTarget(profile: ConnectionProfile): string {
  const account = profile.username ? `${profile.username}@` : "";
  return `${account}${profile.hostname}:${profile.port}`;
}

/**
 * Two profiles addressing the same service. Reported as a non-blocking notice
 * rather than a validation error: intentional duplicates are legitimate, for
 * example the same host reached through different jump hosts.
 */
export function findDuplicateTarget(
  profiles: ConnectionProfile[],
  candidate: ConnectionProfile,
): ConnectionProfile | undefined {
  return profiles.find(
    (profile) =>
      profile.id !== candidate.id &&
      profile.protocol === candidate.protocol &&
      profile.hostname.toLowerCase() === candidate.hostname.toLowerCase() &&
      profile.port === candidate.port,
  );
}
