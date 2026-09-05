/** Normalize separators only. Invalid or legacy short secrets are rejected. */
export function normalizePairingToken(input: string): string | null {
  const token = input.replace(/[-\t\n\r\f\v ]/g, "").toUpperCase();
  return /^[0-9A-F]{32}$/.test(token) ? token : null;
}
