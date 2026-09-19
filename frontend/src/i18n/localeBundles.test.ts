/**
 * The contract every shipped language must meet, so a string cannot ship
 * half-translated and a translation cannot silently drop a placeholder:
 *   - every locale has every namespace;
 *   - `common` and `landing` carry exactly the English key set;
 *   - `tutorial` carries the English chrome keys plus every module and every
 *     card of every lesson (derived from the code, which is the English source);
 *   - `{{placeholders}}` and the `{playerColor}` token match the source string;
 *   - the English landing copy mirrors the brand constants.
 */
import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from './locales';
import { NAMESPACES } from './index';
import { tutorialSourceText, tutorialTranslationKeys } from '../tutorial/localize';
import { LANDING_ERAS } from '../data/landingEras';
import { STORE_DESCRIPTION, TAGLINE_CINEMATIC, TAGLINE_PRIMARY } from '../constants/brand';

const BUNDLES = import.meta.glob<{ default: Record<string, unknown> }>('./locales/*/*.json', { eager: true });

function bundle(locale: string, ns: string): Record<string, unknown> {
  const mod = BUNDLES[`./locales/${locale}/${ns}.json`];
  if (!mod) throw new Error(`missing bundle ${locale}/${ns}`);
  return mod.default;
}

/** `{ a: { b: 'x' } }` → `{ 'a.b': 'x' }`; every leaf must be a string. */
function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else if (v && typeof v === 'object') Object.assign(out, flatten(v as Record<string, unknown>, key));
    else throw new Error(`${key}: expected a string or an object, got ${typeof v}`);
  }
  return out;
}

const PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
function placeholders(s: string): string[] {
  return [...s.matchAll(PLACEHOLDER_RE)].map((m) => m[1]).sort();
}
/** What a tutorial card may interpolate beyond what its English source has. */
const CARD_INTERPOLATION = new Set(['draftButton', 'attackButton', 'fortifyButton']);

const OTHER_LOCALES = SUPPORTED_LOCALES.filter((l) => l !== 'en');
const en = Object.fromEntries(NAMESPACES.map((ns) => [ns, flatten(bundle('en', ns))]));

describe('the English bundles (the source)', () => {
  it('exist for every namespace and every locale', () => {
    for (const locale of SUPPORTED_LOCALES) for (const ns of NAMESPACES) expect(bundle(locale, ns)).toBeTruthy();
  });

  it('landing copy mirrors the brand constants', () => {
    expect(en.landing['hero.tagline']).toBe(TAGLINE_PRIMARY);
    expect(en.landing['hero.description']).toBe(STORE_DESCRIPTION);
    expect(en.landing['cta.tagline']).toBe(TAGLINE_CINEMATIC);
  });

  it('landing copy covers every built-in era card', () => {
    for (const era of LANDING_ERAS) {
      for (const field of ['label', 'years', 'summary']) {
        expect(en.landing[`eras.${era.id}.${field}`], `eras.${era.id}.${field}`).toBeTruthy();
      }
    }
  });

  it('tutorial holds the chrome only — cards and module names come from the code', () => {
    const codeKeys = Object.keys(en.tutorial).filter((k) => k.startsWith('steps.') || k.startsWith('modules.'));
    expect(codeKeys).toEqual([]);
    expect(tutorialTranslationKeys().length).toBeGreaterThan(100);
  });
});

describe.each(OTHER_LOCALES)('%s', (locale) => {
  const own = Object.fromEntries(NAMESPACES.map((ns) => [ns, flatten(bundle(locale, ns))]));

  it('common and landing carry exactly the English key set', () => {
    for (const ns of ['common', 'landing'] as const) {
      expect(Object.keys(own[ns]).sort()).toEqual(Object.keys(en[ns]).sort());
    }
  });

  it('tutorial carries the chrome, every module and every card of every lesson', () => {
    const expected = [...Object.keys(en.tutorial), ...tutorialTranslationKeys()].sort();
    expect(Object.keys(own.tutorial).sort()).toEqual(expected);
  });

  it('has no empty strings', () => {
    for (const ns of NAMESPACES) {
      for (const [key, value] of Object.entries(own[ns])) expect(value.trim(), `${ns}:${key}`).not.toBe('');
    }
  });

  it('keeps every placeholder its source string has', () => {
    for (const ns of NAMESPACES) {
      for (const [key, value] of Object.entries(own[ns])) {
        const source = en[ns][key] ?? (ns === 'tutorial' ? tutorialSourceText(key) : undefined);
        expect(source, `${ns}:${key} has no English source`).toBeDefined();
        const got = placeholders(value);
        const want = placeholders(source as string);
        if (ns === 'tutorial' && en.tutorial[key] === undefined) {
          // A card: the source has none, the translation may use the button labels.
          for (const p of got) expect(CARD_INTERPOLATION.has(p), `${key}: unknown placeholder {{${p}}}`).toBe(true);
          expect(value.includes('{playerColor}'), `${key}: {playerColor}`).toBe((source as string).includes('{playerColor}'));
        } else {
          expect(got, `${ns}:${key}`).toEqual(want);
        }
      }
    }
  });
});
