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
  "light",
  "midnight",
  "graphite",
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
    swatch: ["#080c10", "#1c2830", "#5fe3b0"],
    isDark: true,
  },
  {
    id: "light",
    labelKey: "theme.light",
    hintKey: "theme.light.hint",
    swatch: ["#eef3f4", "#ffffff", "#0a7d5e"],
    isDark: false,
  },
  {
    id: "midnight",
    labelKey: "theme.midnight",
    hintKey: "theme.midnight.hint",
    swatch: ["#070b18", "#212c4a", "#86a7ff"],
    isDark: true,
  },
  {
    id: "graphite",
    labelKey: "theme.graphite",
    hintKey: "theme.graphite.hint",
    swatch: ["#0e1013", "#252a30", "#9fc3d8"],
    isDark: true,
  },
  {
    id: "sand",
    labelKey: "theme.sand",
    hintKey: "theme.sand.hint",
    swatch: ["#f4ece1", "#fffbf5", "#a75a2c"],
    isDark: false,
  },
  {
    id: "contrast",
    labelKey: "theme.contrast",
    hintKey: "theme.contrast.hint",
    swatch: ["#000000", "#1c1c1c", "#6dffc0"],
    isDark: true,
  },
  {
    id: "system",
    labelKey: "theme.system",
    hintKey: "theme.system.hint",
    swatch: ["#080c10", "#8fa3ad", "#eef3f4"],
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
