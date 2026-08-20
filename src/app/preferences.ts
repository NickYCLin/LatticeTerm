/**
 * Interface preferences: theme, language, density and motion.
 *
 * Appearance only. They are written to `localStorage` because losing them is
 * harmless; nothing secret, and no connection data, is stored here.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { defaultLocale, localeCatalog, type Locale } from "../i18n";
import { resolveTheme, themeIds, type ThemeChoice, type ThemeId } from "./themes";

export type DensityChoice = "comfortable" | "compact";
export type MotionChoice = "system" | "reduced";

export interface Preferences {
  theme: ThemeChoice;
  locale: Locale;
  density: DensityChoice;
  motion: MotionChoice;
  sidebarCollapsed: boolean;
  inspectorOpen: boolean;
}

export const defaultPreferences: Preferences = {
  theme: "dark",
  locale: defaultLocale,
  density: "comfortable",
  motion: "system",
  sidebarCollapsed: false,
  inspectorOpen: true,
};

const STORAGE_KEY = "latticeterm.preferences.v2";

const knownThemes = new Set<string>([...themeIds, "system"]);
const knownLocales = new Set<string>(localeCatalog.map((entry) => entry.id));

/**
 * Ignores anything unrecognised, so an older file or a hand-edited one cannot
 * leave the app painted in a theme that no longer exists.
 */
function sanitize(stored: Partial<Preferences>): Preferences {
  return {
    theme: knownThemes.has(String(stored.theme))
      ? (stored.theme as ThemeChoice)
      : defaultPreferences.theme,
    locale: knownLocales.has(String(stored.locale))
      ? (stored.locale as Locale)
      : defaultPreferences.locale,
    density: stored.density === "compact" ? "compact" : "comfortable",
    motion: stored.motion === "reduced" ? "reduced" : "system",
    sidebarCollapsed: Boolean(stored.sidebarCollapsed),
    inspectorOpen: stored.inspectorOpen !== false,
  };
}

function readStored(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPreferences;
    return sanitize(JSON.parse(raw) as Partial<Preferences>);
  } catch {
    return defaultPreferences;
  }
}

export interface PreferencesValue {
  preferences: Preferences;
  update: (patch: Partial<Preferences>) => void;
  /** The theme actually painted right now, with `system` already resolved. */
  activeTheme: ThemeId;
}

export function usePreferences(): PreferencesValue {
  const [preferences, setPreferences] = useState<Preferences>(readStored);
  const [systemTheme, setSystemTheme] = useState<ThemeId>(() =>
    resolveTheme("system"),
  );

  const update = useCallback((patch: Partial<Preferences>) => {
    setPreferences((current) => ({ ...current, ...patch }));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // Quota or private-mode failures are not worth interrupting anyone for.
    }
  }, [preferences]);

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: light)");
    if (!query) return;

    const apply = () => setSystemTheme(query.matches ? "light" : "dark");
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  const activeTheme =
    preferences.theme === "system" ? systemTheme : preferences.theme;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = activeTheme;
    root.dataset.density = preferences.density;
    root.dataset.motion = preferences.motion;
    root.lang =
      localeCatalog.find((entry) => entry.id === preferences.locale)?.tag ??
      "zh-Hant-TW";
  }, [activeTheme, preferences.density, preferences.motion, preferences.locale]);

  return useMemo(
    () => ({ preferences, update, activeTheme }),
    [preferences, update, activeTheme],
  );
}
