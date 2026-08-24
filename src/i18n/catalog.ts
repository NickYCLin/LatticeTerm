/** Locale metadata and message catalogues kept outside the React refresh boundary. */

import { en } from "./messages/en";
import { zhTW, type Messages } from "./messages/zh-TW";

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

export const catalogues: Record<Locale, Messages> = { "zh-TW": zhTW, en };
