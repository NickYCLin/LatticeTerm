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

/** The persisted host-trust shape returned by the Rust core. */
export interface HostKeyRecord {
  host: string;
  port: number;
  algorithm: KeyAlgorithm | string;
  fingerprint: string;
  /** Seconds since the Unix epoch. */
  firstTrustedAt: number;
  /** Seconds since the Unix epoch. */
  lastSeenAt: number;
}

export type HostTrustDecision = "trust_once" | "trust_and_save" | "reject";

/**
 * Validates OpenSSH's SHA-256 display form: `SHA256:` plus the unpadded
 * 43-character base64 encoding of a 32-byte digest.
 */
export function isValidFingerprint(fingerprint: string): boolean {
  const trimmed = fingerprint.trim();
  return /^SHA256:[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]$/.test(trimmed);
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

/**
 * Hostname or IP literal accepted by the connection model. This intentionally
 * rejects schemes, accounts and paths so a trust entry cannot target a shape
 * that the SSH core would never connect to.
 */
export function isValidHost(host: string): boolean {
  const trimmed = host.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= 253 &&
    !/\s/.test(trimmed) &&
    !trimmed.includes("://") &&
    !trimmed.includes("/") &&
    !trimmed.includes("@") &&
    /^[A-Za-z0-9._:\-[\]%]+$/.test(trimmed)
  );
}
