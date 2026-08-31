import { describe, it, expect } from 'vitest';
import { buildCompleteDailyPuzzleSpec, buildDailyPuzzleBase, validateDailyPuzzleSpec } from './dailyPuzzleService';
import { DAILY_CALENDAR } from '../../content/dailyCalendar';

describe('buildDailyPuzzleBase', () => {
  it('is deterministic for the same UTC calendar date', () => {
    const a = buildDailyPuzzleBase('2026-04-20');
    const b = buildDailyPuzzleBase('2026-04-20');
    expect(a).toEqual(b);
  });

  it('differs across calendar dates', () => {
    const a = buildDailyPuzzleBase('2026-04-20');
    const b = buildDailyPuzzleBase('2026-04-21');
    expect(a.seed).not.toBe(b.seed);
  });
});

describe('validateDailyPuzzleSpec', () => {
  const valid = DAILY_CALENDAR['2026-08-31'];

  it('accepts an authored spec, including after a JSONB round-trip', () => {
    expect(validateDailyPuzzleSpec(valid)).not.toBeNull();
    expect(validateDailyPuzzleSpec(JSON.parse(JSON.stringify(valid)))).not.toBeNull();
  });

  it('accepts a minimal generated spec with no authored fields', () => {
    expect(
      validateDailyPuzzleSpec({
        archetype: 'domination', title: 't', intro: 'i', goal: 'g',
        era_id: 'ancient', map_id: 'era_ancient',
        seed: 1, player_count: 4, max_turns: 200, dice_queue_seed: 2,
      }),
    ).not.toBeNull();
  });

  it('rejects the shapes a bare cast used to let through', () => {
    expect(validateDailyPuzzleSpec(null)).toBeNull();
    expect(validateDailyPuzzleSpec([])).toBeNull();
    expect(validateDailyPuzzleSpec({})).toBeNull();
    expect(validateDailyPuzzleSpec({ ...valid, archetype: 'boss_rush' })).toBeNull();
    expect(validateDailyPuzzleSpec({ ...valid, max_turns: 'soon' })).toBeNull();
    expect(validateDailyPuzzleSpec({ ...valid, ai_difficulty: 'nightmare' })).toBeNull();
    expect(
      validateDailyPuzzleSpec({ ...valid, starting_board: { a: { owner: 'gaia', unit_count: 3 } } }),
    ).toBeNull();
    expect(
      validateDailyPuzzleSpec({ ...valid, starting_board: { a: { owner: 'human', unit_count: -2 } } }),
    ).toBeNull();
  });
});

describe('buildCompleteDailyPuzzleSpec — calendar precedence', () => {
  it('serves the authored spec verbatim on a calendar date', async () => {
    const spec = await buildCompleteDailyPuzzleSpec('2026-08-31');
    expect(spec).toEqual(DAILY_CALENDAR['2026-08-31']);
  });

  it('falls back to the generator on an unauthored date', async () => {
    // 2030-01-01 hashes to a non-military archetype, so the generator path
    // needs no database.
    const spec = await buildCompleteDailyPuzzleSpec('2030-01-01');
    expect(spec.starting_board).toBeUndefined();
    expect(validateDailyPuzzleSpec(spec)).not.toBeNull();
  });
});
