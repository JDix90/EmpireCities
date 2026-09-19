/**
 * The UI locales we ship. `en` is the source language: every string exists in
 * English either in code (tutorial cards, module names) or in
 * `locales/en/*.json`; the other bundles are translations of it and load
 * lazily (see ./index.ts). Order is the language switcher's display order.
 *
 * Adding a language: append its tag here, add `locales/<tag>/{common,landing,
 * tutorial}.json` with exactly the English key set (localeBundles.test.ts
 * fails on any gap or leftover), and give it a native name below.
 */
export const SUPPORTED_LOCALES = ['en', 'es', 'pt-BR', 'de', 'fr'] as const;
export type LocaleCode = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: LocaleCode = 'en';

/** Each language in its own name — a player hunting for theirs should not need to read ours. */
export const LOCALE_NAMES: Record<LocaleCode, string> = {
  en: 'English',
  es: 'Español',
  'pt-BR': 'Português (Brasil)',
  de: 'Deutsch',
  fr: 'Français',
};

export function isLocaleCode(value: unknown): value is LocaleCode {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Map an arbitrary language tag onto a supported locale, or undefined.
 * Exact match first, case-insensitively (`pt-br` is `pt-BR`), then the base
 * language (`de-AT` → `de`; `pt-PT` → `pt-BR`, the one Portuguese we ship).
 * Anything else — including whatever a stored preference has been edited
 * into — is undefined, never passed through.
 */
export function sanitizeLocale(raw: unknown): LocaleCode | undefined {
  if (typeof raw !== 'string') return undefined;
  const tag = raw.trim().toLowerCase();
  if (!tag) return undefined;
  const exact = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === tag);
  if (exact) return exact;
  const base = tag.split(/[-_]/)[0];
  return SUPPORTED_LOCALES.find((l) => l.toLowerCase().split('-')[0] === base);
}

/**
 * The locale to show: an explicit preference wins, then the first browser
 * language we can serve, then English.
 */
export function detectLocale(args: {
  preference?: unknown;
  navigatorLanguages?: readonly string[];
}): LocaleCode {
  const preferred = sanitizeLocale(args.preference);
  if (preferred) return preferred;
  for (const lang of args.navigatorLanguages ?? []) {
    const match = sanitizeLocale(lang);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}
