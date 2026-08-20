/**
 * Security & host trust domain models and helpers.
 *
 * Implements strict host key trust checking, fingerprint verification,
 * and Key Vault reference models as specified in the storage and UI/UX briefs.
 */

export type KeyAlgorithm =
  | "ssh-ed25519"
  | "ecdsa-sha2-nistp256"
  | "ecdsa-sha2-nistp384"
  | "ecdsa-sha2-nistp521"
  | "rsa-sha2-512"
  | "rsa-sha2-256"
  | "ssh-rsa";

export interface HostFingerprint {
  id: string;
  host: string;
  port: number;
  algorithm: KeyAlgorithm | string;
  fingerprint: string;
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface CredentialReference {
  id: string;
  name: string;
  type: "ssh-key" | "agent" | "password" | "certificate";
  comment?: string;
  createdAt: number;
}

export interface VaultState {
  isLocked: boolean;
  autoLockMinutes: number;
  systemKeyringAvailable: boolean;
  knownHosts: HostFingerprint[];
  credentials: CredentialReference[];
}

export type HostTrustDecision = "trust_once" | "trust_and_save" | "reject";

/**
 * Validates that a fingerprint follows standard SHA-256 base64 format (e.g. SHA256:xxx)
 * or MD5 hex format.
 */
export function isValidFingerprint(fingerprint: string): boolean {
  const trimmed = fingerprint.trim();
  if (!trimmed) return false;

  // SHA256:43-character base64 string
  if (/^SHA256:[A-Za-z0-9+/=]{40,45}$/.test(trimmed)) {
    return true;
  }

  // MD5: 16 hex bytes separated by colons
  if (/^([0-9a-fA-F]{2}:){15}[0-9a-fA-F]{2}$/.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Formats a fingerprint string for clean display, ensuring standard SHA256 prefix.
 */
export function formatFingerprint(fingerprint: string): string {
  const trimmed = fingerprint.trim();
  if (!trimmed) return "Unknown";
  return trimmed;
}

/**
 * Formats a host key target key string (e.g., [host]:port or host:port).
 */
export function hostTargetKey(host: string, port: number = 22): string {
  const cleanHost = host.trim().toLowerCase();
  if (port === 22) {
    return cleanHost;
  }
  return `[${cleanHost}]:${port}`;
}

export function sampleKnownHosts(): HostFingerprint[] {
  return [
    {
      id: "host-trust-1",
      host: "gateway.example.com",
      port: 22,
      algorithm: "ssh-ed25519",
      fingerprint: "SHA256:uNiVztksCsDhccWphiWmKdqiUVeyDNAd5NNIzAVqpHg",
      firstSeenAt: Date.now() - 86400000 * 5,
      lastSeenAt: Date.now() - 3600000 * 2,
    },
    {
      id: "host-trust-2",
      host: "staging-cluster.example.org",
      port: 2222,
      algorithm: "ecdsa-sha2-nistp256",
      fingerprint: "SHA256:4e1K9mPzYq2vL7wR8sT3uX6yB0cE5fH1jN4aG7kM9pQ",
      firstSeenAt: Date.now() - 86400000 * 12,
      lastSeenAt: Date.now() - 86400000 * 1,
    },
  ];
}

export function sampleCredentials(): CredentialReference[] {
  return [
    {
      id: "cred-1",
      name: "Personal ED25519 Key",
      type: "ssh-key",
      comment: "id_ed25519_2026",
      createdAt: Date.now() - 86400000 * 30,
    },
    {
      id: "cred-2",
      name: "Production Bastion Agent",
      type: "agent",
      comment: "SSH_AUTH_SOCK",
      createdAt: Date.now() - 86400000 * 14,
    },
  ];
}
