import { describe, it, expect } from 'vitest';
import { buildCompleteDailyPuzzleSpec, validateDailyPuzzleSpec } from './dailyPuzzleService';
import { buildDailyPuzzleBase } from './dailyGenerator';
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

  describe('the v2 block', () => {
    const v2 = {
      version: 2,
      theme: 'cut the supply line',
      plan: { steps: [{ kind: 'draft', to: 'gaul', when: 'objective_ai' }, { kind: 'assault', from: 'gaul', to: 'italia', keep: 1, when: 'objective_human' }] },
      plan_prose: ['While it holds the objective, it reinforces Gaul.', 'While you hold the objective, Gaul attacks Italia.'],
      decisions_target: 2,
      verdicts: 'before_dice',
      intent: 'arrows',
      solution: {
        equity: 0.71, obvious_equity: 0.42, near_best: 1, nodes: 4210,
        decisions: [
          { turn: 1, phase: 'attack', best: { kind: 'assault', from: 'hispania', to: 'gaul', keep: 1 }, best_equity: 0.71, alternative: { kind: 'assault', from: 'hispania', to: 'italia', keep: 1 }, alternative_equity: 0.42, gap: 0.29 },
          { turn: 2, phase: 'fortify', best: { kind: 'fortify', from: 'hispania', to: 'italia', units: 'all_but_1' }, best_equity: 0.9, alternative: { kind: 'end_turn' }, alternative_equity: 0.7, gap: 0.2 },
        ],
        line: [
          { turn: 1, action: { kind: 'assault', from: 'hispania', to: 'gaul', keep: 1 }, equity: 0.71 },
          { turn: 1, action: { kind: 'end_attack' }, equity: 0.8 },
        ],
      },
    };

    it('accepts a well-formed block, including after a JSONB round-trip', () => {
      expect(validateDailyPuzzleSpec({ ...valid, v2 })).not.toBeNull();
      expect(validateDailyPuzzleSpec(JSON.parse(JSON.stringify({ ...valid, v2 })))).not.toBeNull();
    });

    it('rejects a block play could not read', () => {
      expect(validateDailyPuzzleSpec({ ...valid, v2: { ...v2, version: 1 } })).toBeNull();
      expect(validateDailyPuzzleSpec({ ...valid, v2: { ...v2, theme: '' } })).toBeNull();
      expect(validateDailyPuzzleSpec({ ...valid, v2: { ...v2, plan: { steps: 'later' } } })).toBeNull();
      expect(validateDailyPuzzleSpec({ ...valid, v2: { ...v2, verdicts: 'loud' } })).toBeNull();
      expect(validateDailyPuzzleSpec({ ...valid, v2: { ...v2, intent: 'mime' } })).toBeNull();
      expect(validateDailyPuzzleSpec({ ...valid, v2: { ...v2, decisions_target: 0 } })).toBeNull();
      expect(validateDailyPuzzleSpec({ ...valid, v2: { ...v2, solution: { ...v2.solution, equity: 'high' } } })).toBeNull();
      expect(validateDailyPuzzleSpec({ ...valid, v2: { ...v2, solution: { ...v2.solution, decisions: [{ turn: 1, phase: 'attack', best: { kind: 'charge' }, best_equity: 1, alternative: null, alternative_equity: 0, gap: 1 }] } } })).toBeNull();
      expect(validateDailyPuzzleSpec({ ...valid, v2: { ...v2, solution: { ...v2.solution, line: [{ turn: 1, action: { kind: 'fortify', from: 'a', to: 'b', units: 'most' }, equity: 0.5 }] } } })).toBeNull();
      expect(validateDailyPuzzleSpec({ ...valid, v2: [] })).toBeNull();
    });
  });
});

describe('buildCompleteDailyPuzzleSpec — calendar precedence', () => {
  it('serves the authored spec verbatim on a calendar date', async () => {
    const spec = await buildCompleteDailyPuzzleSpec('2026-08-31');
    expect(spec).toEqual(DAILY_CALENDAR['2026-08-31']);
  });

  it('falls through to the schedule on an unauthored date', async () => {
    // 2030-01-01 is a Tuesday: an economy set-piece, which is sized from its
    // own territory list and needs no database.
    const spec = await buildCompleteDailyPuzzleSpec('2030-01-01');
    expect(spec.archetype).toBe('economy_build');
    expect(spec.starting_board).toBeDefined();
    expect(validateDailyPuzzleSpec(spec)).not.toBeNull();
  });
});
