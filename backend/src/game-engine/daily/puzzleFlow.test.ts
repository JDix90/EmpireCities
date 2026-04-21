import { describe, it, expect } from 'vitest';
import type { GameMap, GameState } from '../../types';
import { evaluatePuzzleObjective } from './puzzleObjective';
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
