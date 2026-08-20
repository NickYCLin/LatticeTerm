/**
 * Connection metadata model.
 *
 * This module deliberately has no field for a password, passphrase, private
 * key or token. Secrets belong to the OS credential store, which is a later
 * milestone; keeping the shape secret-free means an entry can be logged,
 * exported or shown in a screenshot without leaking anything.
 *
 * Nothing here holds display text. Validation reports message keys and their
 * parameters, and the interface decides what language to render them in.
 */

import type { MessageKey } from "../i18n/messages/zh-TW";

export const protocolCatalog = [
  {
    id: "ssh",
    /** Protocol acronyms stay untranslated; the description is localised. */
    acronym: "SSH",
    defaultPort: 22,
    milestone: 1,
    available: true,
  },
  {
    id: "sftp",
    acronym: "SFTP",
    defaultPort: 22,
    milestone: 3,
    available: false,
  },
  {
    id: "rdp",
    acronym: "RDP",
    defaultPort: 3389,
    milestone: 4,
    available: true,
  },
  {
    id: "vnc",
    acronym: "VNC",
    defaultPort: 5900,
    milestone: 5,
    available: false,
  },
  {
    id: "lattice",
    acronym: "REMOTE",
    defaultPort: 44900,
    milestone: 2,
    available: true,
  },
] as const;

export type Protocol = (typeof protocolCatalog)[number]["id"];

export type ProtocolDefinition = (typeof protocolCatalog)[number];

export const environmentCatalog = [
  "production",
  "staging",
  "development",
  "unassigned",
] as const;

export type Environment = (typeof environmentCatalog)[number];

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

/** A validation failure, expressed as something the interface can translate. */
export interface ValidationIssue {
  key: MessageKey;
  values?: Record<string, string | number>;
}

export type ValidationField =
  | "name"
  | "hostname"
  | "username"
  | "port"
  | "group"
  | "tags";

export type ValidationErrors = Partial<Record<ValidationField, ValidationIssue>>;

export function findProtocol(protocol: Protocol): ProtocolDefinition {
  return protocolCatalog.find((entry) => entry.id === protocol)!;
}

export function isProtocolAvailable(protocol: Protocol): boolean {
  return findProtocol(protocol).available;
}

export function protocolLabelKey(protocol: Protocol): MessageKey {
  return `protocol.${protocol}` as MessageKey;
}

export function protocolSummaryKey(protocol: Protocol): MessageKey {
  return `protocol.${protocol}.summary` as MessageKey;
}

export function environmentLabelKey(environment: Environment): MessageKey {
  return `environment.${environment}` as MessageKey;
}

export function environmentHintKey(environment: Environment): MessageKey {
  return `environment.${environment}.hint` as MessageKey;
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
    errors.name = { key: "validation.nameRequired" };
  } else if (name.length > limits.nameLength) {
    errors.name = {
      key: "validation.nameTooLong",
      values: { max: limits.nameLength },
    };
  }

  if (!hostname) {
    errors.hostname = { key: "validation.hostRequired" };
  } else if (/\s/.test(hostname)) {
    errors.hostname = { key: "validation.hostSpaces" };
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(hostname)) {
    errors.hostname = { key: "validation.hostScheme" };
  } else if (hostname.includes("/")) {
    errors.hostname = { key: "validation.hostPath" };
  } else if (hostname.includes("@")) {
    errors.hostname = { key: "validation.hostAccount" };
  } else if (!hostPattern.test(hostname)) {
    errors.hostname = { key: "validation.hostChars" };
  } else if (hostname.length > limits.hostnameLength) {
    errors.hostname = {
      key: "validation.hostTooLong",
      values: { max: limits.hostnameLength },
    };
  }

  if (/\s/.test(username)) {
    errors.username = { key: "validation.usernameSpaces" };
  } else if (username.length > limits.usernameLength) {
    errors.username = {
      key: "validation.usernameTooLong",
      values: { max: limits.usernameLength },
    };
  }

  if (!Number.isInteger(draft.port)) {
    errors.port = { key: "validation.portInteger" };
  } else if (draft.port < limits.minPort || draft.port > limits.maxPort) {
    errors.port = {
      key: "validation.portRange",
      values: { min: limits.minPort, max: limits.maxPort },
    };
  }

  if (group.length > limits.groupLength) {
    errors.group = {
      key: "validation.groupTooLong",
      values: { max: limits.groupLength },
    };
  }

  if (tags.length > limits.tagCount) {
    errors.tags = {
      key: "validation.tagsTooMany",
      values: { max: limits.tagCount },
    };
  } else if (tags.some((tag) => tag.length > limits.tagLength)) {
    errors.tags = {
      key: "validation.tagTooLong",
      values: { max: limits.tagLength },
    };
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
 * Two entries addressing the same service. Reported as a non-blocking notice
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
