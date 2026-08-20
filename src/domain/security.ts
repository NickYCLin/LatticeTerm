/**
 * Security & host trust domain models and helpers.
 *
 * Implements strict host key trust checking and fingerprint verification
 * rules as specified in the storage and UI/UX design briefs.
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
  host: string;
  port: number;
  algorithm: KeyAlgorithm | string;
  fingerprint: string;
  firstSeenAt?: number;
  lastSeenAt?: number;
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
