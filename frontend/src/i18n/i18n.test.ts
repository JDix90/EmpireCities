import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  LOCALE_NAMES,
  SUPPORTED_LOCALES,
  detectLocale,
  isLocaleCode,
  sanitizeLocale,
} from './locales';
import {
  LANGUAGE_PREF_KEY,
  clearLanguagePreference,
  readLanguagePreference,
  writeLanguagePreference,
} from './languagePreference';
import { applyLocalizationPolicy, getActiveLocale, i18n, setLanguage } from './index';

function setNavigatorLanguages(langs: string[]): void {
  Object.defineProperty(window.navigator, 'languages', { value: langs, configurable: true });
  Object.defineProperty(window.navigator, 'language', { value: langs[0] ?? 'en-US', configurable: true });
}

describe('sanitizeLocale', () => {
  it('accepts shipped tags, case-insensitively', () => {
    expect(sanitizeLocale('es')).toBe('es');
    expect(sanitizeLocale('ES')).toBe('es');
    expect(sanitizeLocale('pt-br')).toBe('pt-BR');
    expect(sanitizeLocale('  fr ')).toBe('fr');
  });

  it('maps a base language or a regional variant onto the locale we ship', () => {
    expect(sanitizeLocale('pt')).toBe('pt-BR');
    expect(sanitizeLocale('pt-PT')).toBe('pt-BR');
    expect(sanitizeLocale('de-AT')).toBe('de');
    expect(sanitizeLocale('fr_CA')).toBe('fr');
    expect(sanitizeLocale('en-GB')).toBe('en');
  });

  it('refuses anything else rather than passing it through', () => {
    expect(sanitizeLocale('xx')).toBeUndefined();
    expect(sanitizeLocale('')).toBeUndefined();
    expect(sanitizeLocale(42)).toBeUndefined();
    expect(sanitizeLocale(null)).toBeUndefined();
    expect(sanitizeLocale('javascript:alert(1)')).toBeUndefined();
  });
});

describe('detectLocale', () => {
  it('lets an explicit preference win over the browser', () => {
    expect(detectLocale({ preference: 'de', navigatorLanguages: ['es-ES'] })).toBe('de');
  });

  it('ignores a preference we cannot serve and falls through to the browser', () => {
    expect(detectLocale({ preference: 'zz', navigatorLanguages: ['ja-JP', 'de-DE', 'en'] })).toBe('de');
  });

  it('defaults to English when nothing matches', () => {
    expect(detectLocale({ navigatorLanguages: ['ja-JP', 'ko'] })).toBe('en');
    expect(detectLocale({})).toBe('en');
  });
});

describe('the locale table', () => {
  it('starts with English, the source language, and names every locale in its own language', () => {
    expect(SUPPORTED_LOCALES[0]).toBe(DEFAULT_LOCALE);
    for (const code of SUPPORTED_LOCALES) {
      expect(isLocaleCode(code)).toBe(true);
      expect(LOCALE_NAMES[code].length).toBeGreaterThan(0);
    }
    expect(isLocaleCode('xx')).toBe(false);
  });
});

describe('the stored preference', () => {
  afterEach(() => clearLanguagePreference());

  it('round-trips a shipped locale under a cc- key', () => {
    writeLanguagePreference('fr');
    expect(localStorage.getItem(LANGUAGE_PREF_KEY)).toBe('fr');
    expect(LANGUAGE_PREF_KEY.startsWith('cc-')).toBe(true);
    expect(readLanguagePreference()).toBe('fr');
  });

  it('is sanitized on load: an edited or stale value reads as no preference', () => {
    localStorage.setItem(LANGUAGE_PREF_KEY, 'zz');
    expect(readLanguagePreference()).toBeUndefined();
    localStorage.setItem(LANGUAGE_PREF_KEY, 'pt-pt');
    expect(readLanguagePreference()).toBe('pt-BR');
  });
});

describe('applyLocalizationPolicy', () => {
  beforeEach(() => {
    clearLanguagePreference();
    setNavigatorLanguages(['en-US']);
  });
  afterEach(async () => {
    await setLanguage('en');
    clearLanguagePreference();
    setNavigatorLanguages(['en-US']);
  });

  it('off: English for everyone, whatever the browser or a stored preference says', async () => {
    writeLanguagePreference('es');
    setNavigatorLanguages(['es-ES', 'es']);
    await applyLocalizationPolicy(false);
    expect(getActiveLocale()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(i18n.t('actions.playFreeNow', { ns: 'landing' })).toBe('Play Free Now');
  });

  it('on: the stored preference wins over the browser', async () => {
    writeLanguagePreference('de');
    setNavigatorLanguages(['es-ES']);
    await applyLocalizationPolicy(true);
    expect(getActiveLocale()).toBe('de');
    expect(document.documentElement.lang).toBe('de');
    expect(i18n.t('actions.playFreeNow', { ns: 'landing' })).toBe('Jetzt kostenlos spielen');
  });

  it('on: the first browser language we ship, when nothing is stored', async () => {
    setNavigatorLanguages(['ja-JP', 'pt-BR', 'en']);
    await applyLocalizationPolicy(true);
    expect(getActiveLocale()).toBe('pt-BR');
    expect(i18n.t('actions.playFreeNow', { ns: 'landing' })).toBe('Jogue grátis agora');
  });

  it('on: English when the browser offers nothing we ship', async () => {
    setNavigatorLanguages(['ja-JP']);
    await applyLocalizationPolicy(true);
    expect(getActiveLocale()).toBe('en');
  });

  it('turning the flag off again returns a localized session to English', async () => {
    writeLanguagePreference('fr');
    await applyLocalizationPolicy(true);
    expect(getActiveLocale()).toBe('fr');
    await applyLocalizationPolicy(false);
    expect(getActiveLocale()).toBe('en');
    // The preference itself is left alone for when the flag comes back.
    expect(readLanguagePreference()).toBe('fr');
  });
});

describe('setLanguage', () => {
  afterEach(async () => {
    await setLanguage('en');
    clearLanguagePreference();
  });

  it('persists only when asked', async () => {
    await setLanguage('es');
    expect(readLanguagePreference()).toBeUndefined();
    await setLanguage('fr', { persist: true });
    expect(readLanguagePreference()).toBe('fr');
    expect(getActiveLocale()).toBe('fr');
  });

  it('falls back to English, then to the caller default, for a key a bundle lacks', async () => {
    await setLanguage('es');
    expect(i18n.t('actions.signIn', { ns: 'landing' })).toBe('Iniciar sesión');
    expect(i18n.t('no.such.key', { ns: 'landing', defaultValue: 'from code' })).toBe('from code');
    // Tutorial cards are not in the English bundle at all: the code default is what renders.
    expect(i18n.t('steps.core.welcome.title', { ns: 'tutorial', defaultValue: 'Welcome, Commander!' })).toBe(
      '¡Bienvenido, comandante!',
    );
    await setLanguage('en');
    expect(i18n.t('steps.core.welcome.title', { ns: 'tutorial', defaultValue: 'Welcome, Commander!' })).toBe(
      'Welcome, Commander!',
    );
  });
});
