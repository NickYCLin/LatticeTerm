/**
 * Interface localisation.
 *
 * Traditional Chinese is the default and the source of truth for the key set;
 * every other catalogue has to satisfy the same `Messages` type, so a missing
 * translation is a build error instead of a blank label.
 */

import { createContext, useCallback, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { zhTW, type MessageKey, type Messages } from "./messages/zh-TW";
import { en } from "./messages/en";

export type Locale = "zh-TW" | "en";

export const defaultLocale: Locale = "zh-TW";

export const localeCatalog: {
  id: Locale;
  /** Written in its own language, so it is readable whatever is selected. */
  label: string;
  tag: string;
}[] = [
  { id: "zh-TW", label: "繁體中文", tag: "zh-Hant-TW" },
  { id: "en", label: "English", tag: "en" },
];

const catalogues: Record<Locale, Messages> = { "zh-TW": zhTW, en };

export type TranslateValues = Record<string, string | number>;

/** Replaces `{name}` placeholders; unknown placeholders are left untouched. */
function interpolate(template: string, values?: TranslateValues): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

export interface I18nValue {
  locale: Locale;
  t: (key: MessageKey, values?: TranslateValues) => string;
  /** Locale tag for `Intl`, so dates and numbers follow the same choice. */
  tag: string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  const t = useCallback(
    (key: MessageKey, values?: TranslateValues) => {
      const catalogue = catalogues[locale] ?? catalogues[defaultLocale];
      return interpolate(catalogue[key] ?? zhTW[key] ?? key, values);
    },
    [locale],
  );

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      t,
      tag: localeCatalog.find((entry) => entry.id === locale)?.tag ?? "zh-Hant-TW",
    }),
    [locale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return value;
}

export type { MessageKey, Messages };
