import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/api', () => ({ api: { post: vi.fn(() => Promise.resolve()), get: vi.fn() } }));

import { cardCopy } from './cardCopy';
import { TUTORIAL_STEP_LISTS, localizeTutorialStep, type TranslateFn } from './localize';
import type { TutorialLessonModule, TutorialStep } from './types';
import { i18n, loadLocale } from '../i18n';

const LESSONS = Object.keys(TUTORIAL_STEP_LISTS) as TutorialLessonModule[];
const PHONE_FIELDS = [
  ['message', 'messagePhone'],
  ['detail', 'detailPhone'],
  ['hint', 'hintPhone'],
] as const;

/** Every card of every lesson, read the way the given layout reads it. */
function everyCard(read: (step: TutorialStep, lesson: TutorialLessonModule) => TutorialStep, phone: boolean) {
  return LESSONS.flatMap((lesson) =>
    TUTORIAL_STEP_LISTS[lesson].flatMap((raw) => {
      const step = read(raw, lesson);
      return [false, true].map((skipped) => ({ lesson, id: step.id, copy: cardCopy(step, { phone, skipped }) }));
    }),
  );
}
const asIs = (step: TutorialStep) => step;
const textOf = (c: ReturnType<typeof cardCopy>) => [c.title, c.message, c.detail ?? '', c.hint ?? ''].join(' ');

const bold = (s: string) => [...s.matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1]);
const numbers = (s: string) => (s.match(/\d+/g) ?? []).sort();

describe('cardCopy', () => {
  const step = {
    id: 'turn_ends',
    title: 'The Opponent Moves',
    message: 'The sidebar highlights whoever is active.',
    messagePhone: 'The bar along the bottom names whoever is active.',
    detail: 'Desktop detail.',
    hint: 'A hint with no phone version.',
    skippedTitle: 'Skipped',
    skippedMessage: 'Skipped message.',
  } as TutorialStep;

  it('reads the phone copy in the phone layout, field by field', () => {
    const c = cardCopy(step, { phone: true, skipped: false });
    expect(c.message).toBe('The bar along the bottom names whoever is active.');
    expect(c.detail).toBe('Desktop detail.');
    expect(c.hint).toBe('A hint with no phone version.');
  });

  it('reads the desktop copy everywhere else', () => {
    expect(cardCopy(step, { phone: false, skipped: false }).message).toBe('The sidebar highlights whoever is active.');
  });

  it('lets the skip copy win over both', () => {
    for (const phone of [false, true]) {
      const c = cardCopy(step, { phone, skipped: true });
      expect(c.title).toBe('Skipped');
      expect(c.message).toBe('Skipped message.');
    }
  });
});

describe('tutorial copy fits the layout it is read in', () => {
  // A phone has no sidebar: its panels sit behind the bottom bar's ☰ Menu.
  it('never sends a phone player to the sidebar', () => {
    for (const { lesson, id, copy } of everyCard(asIs, true)) {
      expect(textOf(copy), `${lesson}.${id}`).not.toMatch(/side ?bar/i);
    }
  });

  it('never talks about phones on the desktop', () => {
    for (const { lesson, id, copy } of everyCard(asIs, false)) {
      expect(textOf(copy), `${lesson}.${id}`).not.toMatch(/\bphones?\b|bottom bar|☰/i);
    }
  });

  // A card both layouts read uses verbs both can do: press a button, pick a
  // territory. A card only one layout reads may use that layout's verb.
  it('never asks a phone player to click', () => {
    for (const { lesson, id, copy } of everyCard(asIs, true)) {
      expect(textOf(copy), `${lesson}.${id}`).not.toMatch(/\bclick/i);
    }
  });

  it('never asks a desktop player to tap', () => {
    for (const { lesson, id, copy } of everyCard(asIs, false)) {
      expect(textOf(copy), `${lesson}.${id}`).not.toMatch(/\btap(s|ped|ping)?\b/i);
    }
  });

  it('keeps every bold term and number of the desktop card in its phone version', () => {
    let pairs = 0;
    for (const lesson of LESSONS) {
      for (const step of TUTORIAL_STEP_LISTS[lesson]) {
        for (const [desk, phone] of PHONE_FIELDS) {
          const d = step[desk];
          const p = step[phone];
          if (p === undefined) continue;
          pairs += 1;
          expect(d, `${lesson}.${step.id}.${phone} has no ${desk} to stand in for`).toBeDefined();
          for (const term of bold(d!)) expect(bold(p), `${lesson}.${step.id}.${phone}`).toContain(term);
          expect(numbers(p), `${lesson}.${step.id}.${phone}`).toEqual(numbers(d!));
        }
      }
    }
    expect(pairs).toBeGreaterThan(10);
  });
});

// Each language's word for the sidebar, its "click", and its "tap" as an
// instruction. The tap patterns name the imperative only: Spanish "te toca" is
// "your turn", "que toque" in Spanish and Portuguese is "that borders", and
// French "sans toucher à" is "without changing".
describe.each([
  ['de', 'Seitenleiste', /klick/i, /\b(an)?tipp(e|en|st)\b/i],
  ['es', 'barra lateral', /\bclic\b|cliquea|clica/i, /(?<!te )\btoca\b|\btócal[oa]\b/i],
  ['fr', 'barre latérale', /cliqu|\bclic\b/i, /\btouchez\b/i],
  ['pt-BR', 'barra lateral', /cliqu|\bclique\b|\bclicar\b/i, /(?<!que )\btoque\b/i],
] as const)('%s', (locale, sidebar, click, tap) => {
  async function translator(): Promise<TranslateFn> {
    await loadLocale(locale);
    return (key, opts) => String(i18n.t(key, { ...opts, lng: locale }));
  }

  it('never sends a phone player to the sidebar either', async () => {
    const t = await translator();
    const read = (step: TutorialStep, lesson: TutorialLessonModule) => localizeTutorialStep(step, t, lesson);
    for (const { lesson, id, copy } of everyCard(read, true)) {
      expect(textOf(copy).toLowerCase(), `${lesson}.${id}`).not.toContain(sidebar.toLowerCase());
    }
  });

  it('never asks a phone player to click either', async () => {
    const t = await translator();
    const read = (step: TutorialStep, lesson: TutorialLessonModule) => localizeTutorialStep(step, t, lesson);
    for (const { lesson, id, copy } of everyCard(read, true)) {
      expect(textOf(copy), `${lesson}.${id}`).not.toMatch(click);
    }
  });

  it('never asks a desktop player to tap either', async () => {
    const t = await translator();
    const read = (step: TutorialStep, lesson: TutorialLessonModule) => localizeTutorialStep(step, t, lesson);
    for (const { lesson, id, copy } of everyCard(read, false)) {
      expect(textOf(copy), `${lesson}.${id}`).not.toMatch(tap);
    }
  });

  it('keeps every bold term and number of the translated desktop card in its phone version', async () => {
    const t = await translator();
    for (const lesson of LESSONS) {
      for (const raw of TUTORIAL_STEP_LISTS[lesson]) {
        const step = localizeTutorialStep(raw, t, lesson);
        for (const [desk, phone] of PHONE_FIELDS) {
          const p = step[phone];
          if (p === undefined) continue;
          const d = step[desk]!;
          for (const term of bold(d)) expect(bold(p), `${lesson}.${step.id}.${phone}`).toContain(term);
          expect(numbers(p), `${lesson}.${step.id}.${phone}`).toEqual(numbers(d));
        }
      }
    }
  });
});
