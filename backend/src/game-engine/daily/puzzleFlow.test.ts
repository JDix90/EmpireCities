import { describe, it, expect } from 'vitest';
import type { GameMap, GameState } from '../../types';
import { evaluatePuzzleObjective, isObjectiveMetAtConquest, isPuzzleTimedOut, puzzleTimeoutOutcome } from './puzzleObjective';
import type { DailyPuzzleSpec } from './dailyPuzzleTypes';

const stubMap: GameMap = {
  map_id: 't',
  name: 't',
  territories: {},
  connections: [],
  regions: [],
};

describe('puzzle objective flow', () => {
  describe('military_capture is capture AND hold', () => {
    const humanId = 'u1';
    const spec: DailyPuzzleSpec = {
      archetype: 'military_capture',
      title: 'T', intro: 'i', goal: 'g',
      era_id: 'ancient', map_id: 'm', seed: 1, player_count: 2, max_turns: 10, dice_queue_seed: 1,
      target_territory_id: 'cap',
      anchor_territory_id: 'anc',
    };
    const board = (owner: string, turn: number, reachedTurn?: number | null) => ({
      players: [{ player_id: humanId, is_eliminated: false }],
      territories: { cap: { owner_id: owner, unit_count: 1 } },
      turn_number: turn,
      puzzle_objective_reached_turn: reachedTurn,
    }) as unknown as GameState;

    it('is only pending on the turn the target falls — the enemy still gets its reply', () => {
      const state = board(humanId, 2);
      expect(evaluatePuzzleObjective(state, stubMap, spec, humanId)).toBe('pending');
      expect(state.puzzle_objective_reached_turn).toBe(2);
    });

    it('is solved once the turn counter has moved past the capture with the target still held', () => {
      const state = board(humanId, 3, 2);
      expect(evaluatePuzzleObjective(state, stubMap, spec, humanId)).toBe('solved');
    });

    it('resets when the target is lost, so a retake starts the hold again', () => {
      const lost = board('ai', 3, 2);
      expect(evaluatePuzzleObjective(lost, stubMap, spec, humanId)).toBe('pending');
      expect(lost.puzzle_objective_reached_turn).toBeNull();
      const retaken = board(humanId, 3, null);
      expect(evaluatePuzzleObjective(retaken, stubMap, spec, humanId)).toBe('pending');
      expect(retaken.puzzle_objective_reached_turn).toBe(3);
    });
  });

  it('capture_chain needs every target, held through the reply', () => {
    const humanId = 'u1';
    const spec: DailyPuzzleSpec = {
      archetype: 'capture_chain',
      title: 'T', intro: 'i', goal: 'g',
      era_id: 'ancient', map_id: 'm', seed: 1, player_count: 2, max_turns: 10, dice_queue_seed: 1,
      target_territory_ids: ['a', 'b'],
      anchor_territory_id: 'anc',
    };
    const one = {
      players: [{ player_id: humanId, is_eliminated: false }],
      territories: { a: { owner_id: humanId, unit_count: 2 }, b: { owner_id: 'ai', unit_count: 2 } },
      turn_number: 4, puzzle_objective_reached_turn: null,
    } as unknown as GameState;
    expect(evaluatePuzzleObjective(one, stubMap, spec, humanId)).toBe('pending');
    expect(one.puzzle_objective_reached_turn).toBeNull();
    const both = { ...one, territories: { a: { owner_id: humanId, unit_count: 2 }, b: { owner_id: humanId, unit_count: 2 } }, turn_number: 5, puzzle_objective_reached_turn: 4 } as unknown as GameState;
    expect(evaluatePuzzleObjective(both, stubMap, spec, humanId)).toBe('solved');
  });

  it('control_region needs every territory of the region, read from the map', () => {
    const humanId = 'u1';
    const map = {
      ...stubMap,
      territories: [
        { territory_id: 'r1', region_id: 'reg' },
        { territory_id: 'r2', region_id: 'reg' },
        { territory_id: 'x', region_id: 'other' },
      ],
    } as unknown as GameMap;
    const spec: DailyPuzzleSpec = {
      archetype: 'control_region',
      title: 'T', intro: 'i', goal: 'g',
      era_id: 'ancient', map_id: 'm', seed: 1, player_count: 2, max_turns: 10, dice_queue_seed: 1,
      region_id: 'reg',
    };
    const partial = {
      players: [{ player_id: humanId, is_eliminated: false }],
      territories: { r1: { owner_id: humanId, unit_count: 2 }, r2: { owner_id: 'ai', unit_count: 2 }, x: { owner_id: 'ai', unit_count: 2 } },
      turn_number: 3, puzzle_objective_reached_turn: null,
    } as unknown as GameState;
    expect(evaluatePuzzleObjective(partial, map, spec, humanId)).toBe('pending');
    const all = { ...partial, territories: { r1: { owner_id: humanId, unit_count: 2 }, r2: { owner_id: humanId, unit_count: 2 }, x: { owner_id: 'ai', unit_count: 2 } }, turn_number: 4, puzzle_objective_reached_turn: 3 } as unknown as GameState;
    expect(evaluatePuzzleObjective(all, map, spec, humanId)).toBe('solved');
  });

  describe('hold_territory', () => {
    const humanId = 'u1';
    const aiId = 'ai';
    const spec: DailyPuzzleSpec = {
      archetype: 'hold_territory',
      title: 'T', intro: 'i', goal: 'g',
      era_id: 'ancient', map_id: 'm', seed: 1, player_count: 2, max_turns: 6, dice_queue_seed: 1,
      target_territory_id: 'fort',
      anchor_territory_id: 'camp',
    };
    const board = (owner: string, turn: number) => ({
      players: [{ player_id: humanId, is_eliminated: false }, { player_id: aiId, is_ai: true, is_eliminated: false }],
      territories: { fort: { owner_id: owner, unit_count: 3 }, camp: { owner_id: aiId, unit_count: 9 } },
      turn_number: turn,
    }) as unknown as GameState;

    it('is pending while the target is held and the clock runs', () => {
      expect(evaluatePuzzleObjective(board(humanId, 3), stubMap, spec, humanId)).toBe('pending');
      expect(isPuzzleTimedOut(board(humanId, 3), spec)).toBe(false);
    });

    it('fails the moment the target changes hands', () => {
      expect(evaluatePuzzleObjective(board(aiId, 3), stubMap, spec, humanId)).toBe('failed');
    });

    it('is the one verb for which the clock running out is the win', () => {
      expect(puzzleTimeoutOutcome(spec)).toBe('solve');
      expect(isPuzzleTimedOut(board(humanId, 7), spec)).toBe(true);
      expect(evaluatePuzzleObjective(board(humanId, 7), stubMap, spec, humanId)).toBe('pending');
      // Every "do something" verb still fails on time.
      expect(puzzleTimeoutOutcome({ ...spec, archetype: 'military_capture' })).toBe('fail');
      expect(puzzleTimeoutOutcome({ ...spec, archetype: 'economy_build' })).toBe('fail');
      expect(puzzleTimeoutOutcome({ ...spec, archetype: 'tech_research' })).toBe('fail');
    });
  });

  it('tech_research is solved when the tech is unlocked', () => {
    const humanId = 'u1';
    const spec: DailyPuzzleSpec = {
      archetype: 'tech_research',
      title: 'T',
      intro: 'i',
      goal: 'g',
      era_id: 'ancient',
      map_id: 'm',
      seed: 1,
      player_count: 2,
      max_turns: 12,
      dice_queue_seed: 1,
      tech_id: 'tech_iron',
    };
    const state = {
      players: [{ player_id: humanId, is_eliminated: false, unlocked_techs: ['tech_iron'] }],
      territories: {},
      turn_number: 3,
    } as unknown as GameState;

    expect(evaluatePuzzleObjective(state, stubMap, spec, humanId)).toBe('solved');
  });
});

describe('isObjectiveMetAtConquest — the human has just eliminated every rival', () => {
  const humanId = 'u1';
  const aiId = 'ai';
  const base = {
    title: 'T', intro: 'i', goal: 'g',
    era_id: 'ancient', map_id: 'm', seed: 1, player_count: 2, max_turns: 10, dice_queue_seed: 1,
  } as const;
  const regionMap = {
    ...stubMap,
    territories: [
      { territory_id: 'r1', region_id: 'reg' },
      { territory_id: 'r2', region_id: 'reg' },
      { territory_id: 'x', region_id: 'other' },
    ],
  } as unknown as GameMap;
  const board = (
    owners: Record<string, string | null>,
    opts: { aiEliminated?: boolean; techs?: string[] } = {},
  ) => ({
    players: [
      { player_id: humanId, is_eliminated: false, unlocked_techs: opts.techs ?? [] },
      { player_id: aiId, is_ai: true, is_eliminated: opts.aiEliminated ?? true },
    ],
    territories: Object.fromEntries(
      Object.entries(owners).map(([tid, owner]) => [tid, { owner_id: owner, unit_count: 2 }]),
    ),
    turn_number: 3,
    // The capture landed this very turn: the AI's reply never came.
    puzzle_objective_reached_turn: 3,
  }) as unknown as GameState;

  it('counts a capture that took the last rival with it — nobody is left to take it back', () => {
    const spec: DailyPuzzleSpec = { ...base, archetype: 'military_capture', target_territory_id: 'cap' };
    const state = board({ cap: humanId });
    // The resolver alone still waits for the reply that cannot come.
    expect(evaluatePuzzleObjective(state, stubMap, spec, humanId)).toBe('pending');
    expect(isObjectiveMetAtConquest(state, stubMap, spec, humanId)).toBe(true);
  });

  it('counts a completed chain and a held region the same way', () => {
    const chain: DailyPuzzleSpec = { ...base, archetype: 'capture_chain', target_territory_ids: ['a', 'b'] };
    expect(isObjectiveMetAtConquest(board({ a: humanId, b: humanId }), stubMap, chain, humanId)).toBe(true);
    const region: DailyPuzzleSpec = { ...base, archetype: 'control_region', region_id: 'reg' };
    expect(isObjectiveMetAtConquest(board({ r1: humanId, r2: humanId, x: null }), regionMap, region, humanId)).toBe(true);
  });

  it('counts a hold whose attacker was wiped out before the clock ran down', () => {
    const spec: DailyPuzzleSpec = { ...base, archetype: 'hold_territory', target_territory_id: 'fort' };
    expect(isObjectiveMetAtConquest(board({ fort: humanId }), stubMap, spec, humanId)).toBe(true);
  });

  it('does not count a target, chain or region the human does not hold at the end', () => {
    // Every rival is gone, but the target is still neutral: the goal was never met.
    const capture: DailyPuzzleSpec = { ...base, archetype: 'military_capture', target_territory_id: 'cap' };
    expect(isObjectiveMetAtConquest(board({ cap: null }), stubMap, capture, humanId)).toBe(false);
    const chain: DailyPuzzleSpec = { ...base, archetype: 'capture_chain', target_territory_ids: ['a', 'b'] };
    expect(isObjectiveMetAtConquest(board({ a: humanId, b: null }), stubMap, chain, humanId)).toBe(false);
    const region: DailyPuzzleSpec = { ...base, archetype: 'control_region', region_id: 'reg' };
    expect(isObjectiveMetAtConquest(board({ r1: humanId, r2: null }), regionMap, region, humanId)).toBe(false);
  });

  it('does not count anything while a rival is still standing', () => {
    const spec: DailyPuzzleSpec = { ...base, archetype: 'military_capture', target_territory_id: 'cap' };
    expect(isObjectiveMetAtConquest(board({ cap: humanId }, { aiEliminated: false }), stubMap, spec, humanId)).toBe(false);
  });

  it('holds a "do something" verb to the thing being done', () => {
    // The reported day: every rival gone on turn 1, the tech not yet researched.
    const tech: DailyPuzzleSpec = { ...base, archetype: 'tech_research', tech_id: 'tech_star_forts' };
    expect(isObjectiveMetAtConquest(board({}), stubMap, tech, humanId)).toBe(false);
    expect(isObjectiveMetAtConquest(board({}, { techs: ['tech_star_forts'] }), stubMap, tech, humanId)).toBe(true);
  });

  it('has nothing to say about a domination day', () => {
    const spec: DailyPuzzleSpec = { ...base, archetype: 'domination' };
    expect(isObjectiveMetAtConquest(board({}), stubMap, spec, humanId)).toBe(false);
  });
});
