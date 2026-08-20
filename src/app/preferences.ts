/**
 * Interface preferences.
 *
 * Appearance settings only. They are written to `localStorage` because losing
 * them is harmless; nothing secret, and no connection metadata, is stored here.
 */

import { useCallback, useEffect, useState } from "react";

export type ThemeChoice = "system" | "dark" | "light";
export type DensityChoice = "comfortable" | "compact";
export type MotionChoice = "system" | "reduced";

export interface Preferences {
  theme: ThemeChoice;
  density: DensityChoice;
  motion: MotionChoice;
  sidebarCollapsed: boolean;
  inspectorOpen: boolean;
}

export const defaultPreferences: Preferences = {
  theme: "dark",
  density: "comfortable",
  motion: "system",
  sidebarCollapsed: false,
  inspectorOpen: true,
};

const STORAGE_KEY = "latticeterm.preferences.v1";

function readStored(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPreferences;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return { ...defaultPreferences, ...parsed };
  } catch {
    // A corrupt or unavailable store must never block startup.
    return defaultPreferences;
  }
}

function resolveTheme(theme: ThemeChoice): "dark" | "light" {
  if (theme !== "system") return theme;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

export function usePreferences() {
  const [preferences, setPreferences] = useState<Preferences>(readStored);

  const update = useCallback((patch: Partial<Preferences>) => {
    setPreferences((current) => ({ ...current, ...patch }));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // Ignore quota or private-mode failures: preferences are best effort.
    }
  }, [preferences]);

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      root.dataset.theme = resolveTheme(preferences.theme);
    };

    apply();
    root.dataset.density = preferences.density;
    root.dataset.motion = preferences.motion;

    if (preferences.theme !== "system") return;

    const query = window.matchMedia("(prefers-color-scheme: light)");
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [preferences.theme, preferences.density, preferences.motion]);

  return { preferences, update };
}
