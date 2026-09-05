import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap } from '../../types';
import { simulatePuzzle } from './puzzleSim';
import type { DailyPuzzleSpec } from './dailyPuzzleTypes';

/**
 * The simulator is the thing that replaces playing a day by hand, so it has
 * to be trusted on three counts: it is deterministic, it recognises a freebie,
 * and it recognises a lost cause. Everything else about it is calibration.
 */

const map = JSON.parse(
  readFileSync(join(__dirname, '../../../../database/maps/era_ancient.json'), 'utf-8'),
) as GameMap;

function capture(board: DailyPuzzleSpec['starting_board'], overrides: Partial<DailyPuzzleSpec> = {}): DailyPuzzleSpec {
  return {
    archetype: 'military_capture',
    title: 'T', intro: 'i', goal: 'g',
    era_id: 'ancient', map_id: 'era_ancient', seed: 1234, player_count: 2, max_turns: 8, dice_queue_seed: 99,
    target_territory_id: 'italia',
    anchor_territory_id: 'gaul',
    ai_difficulty: 'medium',
    clear_board: true,
    starting_phase: 'attack',
    starting_board: board,
    ...overrides,
  };
}

function hold(board: DailyPuzzleSpec['starting_board'], overrides: Partial<DailyPuzzleSpec> = {}): DailyPuzzleSpec {
  return {
    archetype: 'hold_territory',
    title: 'T', intro: 'i', goal: 'g',
    era_id: 'ancient', map_id: 'era_ancient', seed: 4321, player_count: 2, max_turns: 6, dice_queue_seed: 77,
    target_territory_id: 'italia',
    anchor_territory_id: 'gaul',
    ai_difficulty: 'medium',
    clear_board: true,
    starting_board: board,
    ...overrides,
  };
}

describe('puzzleSim', () => {
  it('covers capture and hold days only', async () => {
    const econ = { ...capture({}), archetype: 'economy_build' as const, building_type: 'production_1' as const };
    expect(await simulatePuzzle(econ, map, { games: 4 })).toBeNull();
  });

  it('is deterministic: the same spec simulates identically', async () => {
    const spec = capture({
      gaul: { owner: 'human', unit_count: 10 },
      hispania: { owner: 'human', unit_count: 4 },
      italia: { owner: 'ai', unit_count: 6 },
      greece: { owner: 'ai', unit_count: 4 },
    });
    const a = await simulatePuzzle(spec, map, { games: 20 });
    const b = await simulatePuzzle(spec, map, { games: 20 });
    expect(a).toEqual(b);
    expect(a!.games).toBe(20);
  });

  it('calls a freebie a freebie: an overwhelming stack against a token garrison', async () => {
    const r = await simulatePuzzle(
      capture({ gaul: { owner: 'human', unit_count: 30 }, italia: { owner: 'ai', unit_count: 1 } }),
      map,
      { games: 30 },
    );
    expect(r!.solve_rate).toBeGreaterThanOrEqual(0.95);
    // Captured on turn 1, held through the reply, solved as turn 2 begins.
    expect(r!.median_turns).toBe(2);
  });

  it('calls a lost cause a lost cause: a token stack against a fortress', async () => {
    const r = await simulatePuzzle(
      capture({ gaul: { owner: 'human', unit_count: 2 }, italia: { owner: 'ai', unit_count: 30 } }),
      map,
      { games: 30 },
    );
    expect(r!.solve_rate).toBeLessThanOrEqual(0.05);
  });

  it('hold: an unassailable garrison holds, and a token one falls', async () => {
    const safe = await simulatePuzzle(
      hold({ italia: { owner: 'human', unit_count: 30 }, greece: { owner: 'human', unit_count: 5 }, gaul: { owner: 'ai', unit_count: 4 } }),
      map,
      { games: 20 },
    );
    expect(safe!.solve_rate).toBeGreaterThanOrEqual(0.95);
    // A hold is solved at the clock, so its turn count is the clock.
    expect(safe!.median_turns).toBe(7);

    const doomed = await simulatePuzzle(
      hold({ italia: { owner: 'human', unit_count: 1 }, greece: { owner: 'human', unit_count: 1 }, gaul: { owner: 'ai', unit_count: 40 } }),
      map,
      { games: 20 },
    );
    expect(doomed!.solve_rate).toBeLessThanOrEqual(0.1);
  });
});
