import { describe, it, expect } from 'vitest';
import { isArchivableDate, toArchiveSpec, toDateString } from './dailyArchiveData';
import type { DailyPuzzleSpec } from '../../game-engine/daily/dailyPuzzleTypes';

/**
 * The archive publishes a public page per day, so the two things worth pinning
 * are the boundaries: which DAYS may be published, and which FIELDS of a day.
 * Both are one-way doors — a leak here hands out a live puzzle's solution or a
 * spec's game-start internals, and neither is retractable once crawled.
 */
describe('isArchivableDate', () => {
  // The daily rolls over at UTC midnight (dailyChallengeDate), so pick a `now`
  // just after it: the same instant is "yesterday" in every western timezone,
  // which is exactly the case a local-time implementation would get wrong.
  const now = new Date('2026-09-13T00:30:00Z');

  it('publishes a settled past day', () => {
    expect(isArchivableDate('2026-09-12', now)).toBe(true);
    expect(isArchivableDate('2025-01-01', now)).toBe(true);
  });

  it('never publishes the live day', () => {
    expect(isArchivableDate('2026-09-13', now)).toBe(false);
  });

  it('never publishes a future day', () => {
    expect(isArchivableDate('2026-09-14', now)).toBe(false);
    expect(isArchivableDate('2030-01-01', now)).toBe(false);
  });

  it('rejects anything that is not a bare YYYY-MM-DD', () => {
    for (const bad of [
      '',
      'today',
      '2026-9-12',
      '2026-09-12T00:00:00Z',
      '2026-09-12 ',
      '../../etc/passwd',
      "2026-09-12'; DROP TABLE daily_challenges;--",
    ]) {
      expect(isArchivableDate(bad, now), bad).toBe(false);
    }
  });
});

describe('toDateString', () => {
  it('keeps the calendar day of a pg DATE, which arrives at LOCAL midnight', () => {
    // node-postgres parses DATE into a local-midnight Date. toISOString() on
    // that shifts the day backwards anywhere west of UTC, which would publish
    // one day's puzzle under the previous day's URL.
    const local = new Date(2026, 8, 12, 0, 0, 0);
    expect(toDateString(local)).toBe('2026-09-12');
  });

  it('passes through a text date', () => {
    expect(toDateString('2026-09-12')).toBe('2026-09-12');
    expect(toDateString('2026-09-12T00:00:00.000Z')).toBe('2026-09-12');
  });
});

describe('toArchiveSpec', () => {
  const spec = {
    archetype: 'military_capture',
    title: 'The Gates of Dacia',
    intro: 'A legion waits on the frontier.',
    goal: 'Capture Sarmizegetusa within 6 turns.',
    era_id: 'era_ancient',
    map_id: 'world_classic',
    seed: 1234567,
    player_count: 3,
    max_turns: 6,
    dice_queue_seed: 987654,
    par_turns: 4,
    ai_difficulty: 'medium',
    target_territory_id: 'sarmizegetusa',
    anchor_territory_id: 'apulum',
    starting_board: { territories: [{ id: 'apulum', owner: 0, units: 12 }] },
    clear_board: true,
    grants: { gold: 50 },
    settings_overrides: { naval_enabled: true },
    hint: 'Mass on the anchor before you commit.',
  } as unknown as DailyPuzzleSpec;

  it('exposes the display fields', () => {
    const out = toArchiveSpec(spec, 'era_fallback', 'map_fallback', 4);
    expect(out.title).toBe('The Gates of Dacia');
    expect(out.goal).toBe('Capture Sarmizegetusa within 6 turns.');
    expect(out.archetype).toBe('military_capture');
    expect(out.era_id).toBe('era_ancient');
    expect(out.era_label).toBe('Ancient');
    expect(out.player_count).toBe(3);
    expect(out.max_turns).toBe(6);
    expect(out.par_turns).toBe(4);
  });

  it('is an allowlist: no game-start internals survive it', () => {
    const out = toArchiveSpec(spec, 'era_fallback', 'map_fallback', 4) as Record<string, unknown>;
    for (const leaked of [
      'dice_queue_seed',
      'seed',
      'starting_board',
      'clear_board',
      'grants',
      'settings_overrides',
      'target_territory_id',
      'anchor_territory_id',
      'hint',
    ]) {
      expect(Object.prototype.hasOwnProperty.call(out, leaked), `${leaked} leaked`).toBe(false);
    }
    // And the serialized form a route would actually send.
    const json = JSON.stringify(out);
    expect(json).not.toContain('987654');
    expect(json).not.toContain('1234567');
    expect(json).not.toContain('sarmizegetusa');
  });

  it('falls back to the row columns when a legacy spec omits them', () => {
    const legacy = { archetype: 'domination', legacy: true } as unknown as DailyPuzzleSpec;
    const out = toArchiveSpec(legacy, 'era_modern', 'world_classic', 4);
    expect(out.era_id).toBe('era_modern');
    expect(out.era_label).toBe('Modern');
    expect(out.map_id).toBe('world_classic');
    expect(out.player_count).toBe(4);
    expect(out.title).toBe('Daily Challenge');
    expect(out.par_turns).toBeNull();
  });
});
