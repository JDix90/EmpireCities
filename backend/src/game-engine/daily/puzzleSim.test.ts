import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap } from '../../types';
import { simulatePuzzle } from './puzzleSim';
import { getEraTechTree } from '../eras';
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
  it('covers every verb but domination, which plays to conquest on its own rules', async () => {
    const dom = { ...capture({}), archetype: 'domination' as const };
    expect(await simulatePuzzle(dom, map, { games: 4 })).toBeNull();
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

/**
 * A build day on the Ancient board: Gaul and Hispania are the player's, Italy
 * the AI's, bordering Gaul. The arithmetic says the budget reaches a Workshop
 * on turn two; the simulator says whether the stack in Italy lets it.
 */
function build(board: DailyPuzzleSpec['starting_board'], overrides: Partial<DailyPuzzleSpec> = {}): DailyPuzzleSpec {
  return {
    archetype: 'economy_build',
    title: 'T', intro: 'i', goal: 'g',
    era_id: 'ancient', map_id: 'era_ancient', seed: 555, player_count: 2, max_turns: 5, dice_queue_seed: 66,
    building_type: 'production_1',
    ai_difficulty: 'medium',
    clear_board: true,
    starting_board: board,
    grants: { gold: 2 },
    ...overrides,
  };
}

describe('puzzleSim — build and research days', () => {
  it('raises the goal where the enemy cannot reach, and calls a safe budget solved', async () => {
    const r = await simulatePuzzle(
      build({ gaul: { owner: 'human', unit_count: 8 }, hispania: { owner: 'human', unit_count: 5 }, italia: { owner: 'ai', unit_count: 6 } }),
      map,
      { games: 20 },
    );
    expect(r!.solve_rate).toBeGreaterThanOrEqual(0.9);
    // Two PP granted, one earned on turn two: the Workshop goes up on turn two,
    // and counts once it has stood through the bot's reply, as turn three begins.
    expect(r!.median_turns).toBe(3);
  });

  it('calls a lost cause a lost cause: a token stack beside an army, on a clock it cannot outlast', async () => {
    const r = await simulatePuzzle(
      build(
        { gaul: { owner: 'human', unit_count: 1 }, italia: { owner: 'ai', unit_count: 40 } },
        { grants: { gold: 0 }, max_turns: 2 },
      ),
      map,
      { games: 20 },
    );
    expect(r!.solve_rate).toBeLessThanOrEqual(0.1);
  });

  it('researches the goal when the points land', async () => {
    const root = getEraTechTree('ancient').find((n) => !n.prerequisite)!;
    const r = await simulatePuzzle(
      build(
        { gaul: { owner: 'human', unit_count: 8 }, hispania: { owner: 'human', unit_count: 5 }, italia: { owner: 'ai', unit_count: 6 } },
        {
          archetype: 'tech_research',
          tech_id: root.tech_id,
          building_type: undefined,
          grants: { tech_points: Math.max(0, root.cost - 1) },
          settings_overrides: { economy_tech_starting_tech_points: 0 },
          max_turns: 5,
        },
      ),
      map,
      { games: 20 },
    );
    expect(r!.solve_rate).toBeGreaterThanOrEqual(0.9);
  });
});

describe('puzzleSim — the siege', () => {
  it('a build day under siege is a fight: a heavy stack on the land border holds the line to a contest', async () => {
    // Italy borders Gaul by land. The dealt 6-stack never disturbed a defended
    // site; a stack of twenty does, and the day is no longer a certainty.
    const spec = build({
      gaul: { owner: 'human', unit_count: 5 }, hispania: { owner: 'human', unit_count: 5 },
      italia: { owner: 'ai', unit_count: 20 },
    }, { building_type: 'production_2', grants: { gold: 0 }, max_turns: 7 });
    const r = (await simulatePuzzle(spec, map, { games: 30 }))!;
    expect(r.solve_rate).toBeLessThan(0.9);
    expect(r.solve_rate).toBeGreaterThan(0);
  });
});
