/** React context and consumer hook kept separate from the Provider refresh boundary. */

import { createContext, useContext } from "react";
import type { Locale } from "./catalog";
import type { MessageKey, Messages } from "./messages/zh-TW";

export type TranslateValues = Record<string, string | number>;

export interface I18nValue {
  locale: Locale;
  t: (key: MessageKey, values?: TranslateValues) => string;
  /** Locale tag for `Intl`, so dates and numbers follow the same choice. */
  tag: string;
}

export const I18nContext = createContext<I18nValue | null>(null);

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return value;
}

export type { Locale, MessageKey, Messages };
