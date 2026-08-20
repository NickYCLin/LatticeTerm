/**
 * Theme catalogue.
 *
 * The palettes themselves live in `styles/tokens.css`; this file is what the
 * interface needs to *offer* them: the order they appear in, their labels, and
 * three swatch colours for the preview chip. Swatches are duplicated from the
 * stylesheet on purpose — a preview has to paint the colours before the theme
 * is applied.
 */

import type { MessageKey } from "../i18n/messages/zh-TW";

export const themeIds = [
  "dark",
  "midnight",
  "graphite",
  "nordic",
  "light",
  "sand",
  "contrast",
] as const;

export type ThemeId = (typeof themeIds)[number];
export type ThemeChoice = "system" | ThemeId;

export interface ThemeDefinition {
  id: ThemeChoice;
  labelKey: MessageKey;
  hintKey: MessageKey;
  /** Canvas, surface and accent, in that order. */
  swatch: [string, string, string];
  isDark: boolean;
}

export const themeCatalog: ThemeDefinition[] = [
  {
    id: "dark",
    labelKey: "theme.dark",
    hintKey: "theme.dark.hint",
    swatch: ["#0b0d11", "#181d26", "#f59e0b"],
    isDark: true,
  },
  {
    id: "midnight",
    labelKey: "theme.midnight",
    hintKey: "theme.midnight.hint",
    swatch: ["#090814", "#18142e", "#8b5cf6"],
    isDark: true,
  },
  {
    id: "graphite",
    labelKey: "theme.graphite",
    hintKey: "theme.graphite.hint",
    swatch: ["#0b1017", "#16202c", "#38bdf8"],
    isDark: true,
  },
  {
    id: "nordic",
    labelKey: "theme.nordic",
    hintKey: "theme.nordic.hint",
    swatch: ["#08120e", "#13241d", "#10b981"],
    isDark: true,
  },
  {
    id: "light",
    labelKey: "theme.light",
    hintKey: "theme.light.hint",
    swatch: ["#f8fafc", "#ffffff", "#2563eb"],
    isDark: false,
  },
  {
    id: "sand",
    labelKey: "theme.sand",
    hintKey: "theme.sand.hint",
    swatch: ["#fbf6ee", "#ffffff", "#c2410c"],
    isDark: false,
  },
  {
    id: "contrast",
    labelKey: "theme.contrast",
    hintKey: "theme.contrast.hint",
    swatch: ["#000000", "#141414", "#fbbf24"],
    isDark: true,
  },
  {
    id: "system",
    labelKey: "theme.system",
    hintKey: "theme.system.hint",
    swatch: ["#0b0d11", "#9ca3af", "#f8fafc"],
    isDark: true,
  },
];

export function findTheme(id: ThemeChoice): ThemeDefinition {
  return themeCatalog.find((theme) => theme.id === id) ?? themeCatalog[0];
}

/** `system` follows the desktop; every other choice is taken literally. */
export function resolveTheme(choice: ThemeChoice): ThemeId {
  if (choice !== "system") return choice;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

/** The theme the quick toggle in the rail should switch to next. */
export function oppositeTheme(current: ThemeId): ThemeId {
  return findTheme(current).isDark ? "light" : "dark";
}
