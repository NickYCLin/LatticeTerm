/**
 * Shared helpers for Lattice Remote's relay mode: the remembered relay
 * address (one per install, like AnyDesk's implicit server) and the
 * nine-digit device ID formats people type and read.
 */

const RELAY_ADDRESS_KEY = "latticeterm.remote.relayAddress";

export function loadRelayAddress(storage: Storage): string {
  try {
    return storage.getItem(RELAY_ADDRESS_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveRelayAddress(storage: Storage, address: string): void {
  try {
    const trimmed = address.trim();
    if (trimmed) storage.setItem(RELAY_ADDRESS_KEY, trimmed);
    else storage.removeItem(RELAY_ADDRESS_KEY);
  } catch {
    // Losing the remembered address only means retyping it next time.
  }
}

/** Keeps digits only, so "123 456 789" and "123-456-789" both work. */
export function normalizeDeviceId(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  return /^\d{9}$/.test(digits) ? digits : null;
}

/** Renders "123456789" as "123 456 789" for reading aloud. */
export function formatDeviceId(deviceId: string): string {
  const digits = deviceId.replace(/[\s-]/g, "");
  if (!/^\d{9}$/.test(digits)) return deviceId;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
}
