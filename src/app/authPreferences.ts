/** Non-secret authentication choices remembered per saved SSH profile. */

export type AuthMethodChoice = "password" | "privateKey";

const AUTH_PREFS_KEY = "latticeterm.authPrefs.v1";

export interface AuthPref {
  method: AuthMethodChoice;
  keyPath: string;
}

/** The method and key path that last worked for this profile, if any. */
export function loadAuthPref(profileId: string): AuthPref | null {
  try {
    const raw = localStorage.getItem(AUTH_PREFS_KEY);
    if (!raw) return null;
    const prefs = JSON.parse(raw) as Record<string, AuthPref>;
    const pref = prefs[profileId];
    return pref && (pref.method === "password" || pref.method === "privateKey")
      ? pref
      : null;
  } catch {
    return null;
  }
}

export function saveAuthPref(profileId: string, pref: AuthPref): void {
  try {
    const raw = localStorage.getItem(AUTH_PREFS_KEY);
    const prefs = raw ? (JSON.parse(raw) as Record<string, AuthPref>) : {};
    prefs[profileId] = pref;
    localStorage.setItem(AUTH_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Remembering a preference is a convenience, never a requirement.
  }
}
