import { safeLocalStorage } from '../utils/safeStorage';
import { sanitizeLocale, type LocaleCode } from './locales';

/** `cc-` prefixed like every other client preference (see utils/userPreferences.ts). */
export const LANGUAGE_PREF_KEY = 'cc-lang';

/**
 * The stored choice, or undefined when there is none or it is not a locale we
 * ship. Sanitized on every read, so an edited or stale value can never reach
 * i18next. Goes through safeStorage: inside a portal iframe localStorage may
 * be denied outright, in which case the choice lasts for the page load only.
 */
export function readLanguagePreference(): LocaleCode | undefined {
  try {
    return sanitizeLocale(safeLocalStorage().getItem(LANGUAGE_PREF_KEY));
  } catch {
    return undefined;
  }
}

export function writeLanguagePreference(locale: LocaleCode): void {
  try {
    safeLocalStorage().setItem(LANGUAGE_PREF_KEY, locale);
  } catch {
    /* storage denied — see readLanguagePreference */
  }
}

export function clearLanguagePreference(): void {
  try {
    safeLocalStorage().removeItem(LANGUAGE_PREF_KEY);
  } catch {
    /* ignore */
  }
}
