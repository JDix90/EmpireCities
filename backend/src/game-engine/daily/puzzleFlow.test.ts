import { describe, it, expect } from 'vitest';
import type { GameMap, GameState } from '../../types';
import { evaluatePuzzleObjective, isPuzzleTimedOut, puzzleTimeoutOutcome } from './puzzleObjective';
import type { DailyPuzzleSpec } from './dailyPuzzleTypes';

const stubMap: GameMap = {
  map_id: 't',
  name: 't',
  territories: {},
  connections: [],
  regions: [],
};

describe('puzzle objective flow', () => {
  it('military_capture is solved when the human owns the target territory', () => {
    const humanId = 'u1';
    const spec: DailyPuzzleSpec = {
      archetype: 'military_capture',
      title: 'T',
      intro: 'i',
      goal: 'g',
      era_id: 'ancient',
      map_id: 'm',
      seed: 1,
      player_count: 2,
      max_turns: 10,
      dice_queue_seed: 1,
      target_territory_id: 'cap',
      anchor_territory_id: 'anc',
    };
    const state = {
      players: [{ player_id: humanId, is_eliminated: false }],
      territories: {
        cap: { owner_id: humanId, unit_count: 1 },
      },
      turn_number: 2,
    } as unknown as GameState;

    expect(evaluatePuzzleObjective(state, stubMap, spec, humanId)).toBe('solved');
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
