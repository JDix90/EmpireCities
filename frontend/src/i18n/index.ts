/**
 * UI localization. One i18next instance, initialized synchronously with the
 * English bundles so `t()` works before the first render, plus lazy loading
 * for every other language (each ships as its own chunk).
 *
 * Who decides the language is `applyLocalizationPolicy`: with the
 * `localization_enabled` flag off — the dark-launch default — everyone gets
 * English no matter what their browser or a stored preference says, so the
 * translated bundles are inert until an operator turns them on. main.tsx calls
 * it before first paint with the client-side code default; App.tsx calls it
 * again once GET /feature-flags has reconciled an admin override.
 *
 * What is localized today: the landing page and the tutorial (cards, lesson
 * picker, overlay chrome). The in-game HUD is still English, so tutorial
 * translations name the buttons the player can actually see (see
 * tutorial/localize.ts).
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import enCommon from './locales/en/common.json';
import enLanding from './locales/en/landing.json';
import enTutorial from './locales/en/tutorial.json';
import { DEFAULT_LOCALE, detectLocale, isLocaleCode, type LocaleCode } from './locales';
import { readLanguagePreference, writeLanguagePreference } from './languagePreference';

export const NAMESPACES = ['common', 'landing', 'tutorial'] as const;
export type Namespace = (typeof NAMESPACES)[number];

/**
 * Every non-English bundle, keyed by path, as a lazy import: Vite turns each
 * JSON into its own chunk, so a default (English) visitor downloads only the
 * bundles imported statically above. English is excluded from the glob
 * because it is already in the graph statically, and Rollup warns that a
 * module imported both ways cannot be split out.
 */
const BUNDLE_LOADERS = import.meta.glob<{ default: Record<string, unknown> }>([
  './locales/*/*.json',
  '!./locales/en/*.json',
]);

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: { en: { common: enCommon, landing: enLanding, tutorial: enTutorial } },
    lng: DEFAULT_LOCALE,
    fallbackLng: DEFAULT_LOCALE,
    ns: [...NAMESPACES],
    defaultNS: 'common',
    // React escapes for us; escaping here would mangle → and ' in the copy.
    interpolation: { escapeValue: false },
    // Synchronous init: everything English is inline, nothing to wait for.
    initAsync: false,
    // A missing bundle renders the English fallback, never a suspended tree.
    react: { useSuspense: false },
    returnNull: false,
  });
}

const loadedLocales = new Set<LocaleCode>([DEFAULT_LOCALE]);

/** Fetch and register a locale's bundles once. English is inline, so it resolves at once. */
export async function loadLocale(locale: LocaleCode): Promise<void> {
  if (loadedLocales.has(locale)) return;
  const bundles = await Promise.all(
    NAMESPACES.map(async (ns) => {
      const load = BUNDLE_LOADERS[`./locales/${locale}/${ns}.json`];
      if (!load) throw new Error(`[i18n] no bundle for ${locale}/${ns}`);
      return [ns, (await load()).default] as const;
    }),
  );
  for (const [ns, data] of bundles) i18n.addResourceBundle(locale, ns, data, true, true);
  loadedLocales.add(locale);
}

/**
 * Switch the UI language. The bundles load first, so no key ever renders
 * untranslated mid-switch; if they fail to load (offline, chunk missing) the
 * current language stays and the error reaches the caller.
 */
export async function setLanguage(locale: LocaleCode, opts: { persist?: boolean } = {}): Promise<void> {
  await loadLocale(locale);
  if (i18n.language !== locale) await i18n.changeLanguage(locale);
  // Also when nothing changed: the document may still carry the server's
  // static lang (or none at all), and this is the one place that knows better.
  syncHtmlLang(locale);
  if (opts.persist) writeLanguagePreference(locale);
}

export function getActiveLocale(): LocaleCode {
  return isLocaleCode(i18n.language) ? i18n.language : DEFAULT_LOCALE;
}

/**
 * Apply the `localization_enabled` flag (see the module comment). On: the
 * stored `cc-lang` choice wins, then the browser's languages, then English.
 * Off: English, full stop. Idempotent, so calling it from both main.tsx and
 * App.tsx is fine.
 */
export async function applyLocalizationPolicy(enabled: boolean): Promise<void> {
  if (!enabled) {
    await setLanguage(DEFAULT_LOCALE);
    return;
  }
  const navigatorLanguages =
    typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language];
  await setLanguage(detectLocale({ preference: readLanguagePreference(), navigatorLanguages }));
}

// Keep <html lang> honest for screen readers, hyphenation and translate prompts.
function syncHtmlLang(lng: string): void {
  if (typeof document !== 'undefined') document.documentElement.lang = lng;
}
i18n.on('languageChanged', syncHtmlLang);

export { i18n };
export default i18n;
