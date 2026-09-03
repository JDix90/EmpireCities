import { describe, it, expect } from 'vitest';
import { buildGameSettingsFromChallenge } from './daily.routes';
import type { DailyPuzzleSpec } from '../../game-engine/daily/dailyPuzzleTypes';
import type { DailyChallengeRow } from '../../game-engine/daily/dailyPuzzleService';

/**
 * The settings a daily game is created with decide whether its objective can be
 * reached at all. A tech day used to switch on tech trees and nothing else:
 * tech points accrue only inside applyEconomyIncome, which returns early when
 * economy is off, and initializeGameState's starting-resource bootstrap needs
 * both flags. So the player began on zero points and earned none — an authored
 * day was winnable only because its grant paid the whole cost, and a generated
 * tech day, which grants nothing, could never be solved.
 */
function row(spec: Partial<DailyPuzzleSpec>): DailyChallengeRow {
  return {
    challenge_date: '2026-09-20',
    era_id: 'ancient',
    map_id: 'era_ancient',
    seed: 1,
    player_count: 2,
    kind: 'puzzle',
    spec: {
      archetype: 'military_capture',
      title: 't', intro: 'i', goal: 'g',
      era_id: 'ancient', map_id: 'era_ancient',
      seed: 1, player_count: 2, max_turns: 8, dice_queue_seed: 1,
      ...spec,
    } as DailyPuzzleSpec,
  };
}

describe('daily game settings', () => {
  it('runs tech days with the economy on, or no tech points are ever earned', () => {
    const s = buildGameSettingsFromChallenge(row({ archetype: 'tech_research', tech_id: 'ancient_roads' }));
    expect(s.tech_trees_enabled).toBe(true);
    expect(s.economy_enabled).toBe(true);
  });

  it('runs economy days with the economy on', () => {
    const s = buildGameSettingsFromChallenge(row({ archetype: 'economy_build', building_type: 'production_1' }));
    expect(s.economy_enabled).toBe(true);
  });

  it('lets an authored spec pin a starting resource but never a protected key', () => {
    const s = buildGameSettingsFromChallenge(row({
      archetype: 'tech_research',
      tech_id: 'ancient_roads',
      settings_overrides: { economy_tech_starting_tech_points: 0, seed: 999, max_players: 6 },
    } as Partial<DailyPuzzleSpec>));
    expect(s.economy_tech_starting_tech_points).toBe(0);
    expect(s.seed).toBe(1);
    expect(s.max_players).toBe(2);
  });

  it('keeps domination days on the plain domination victory path', () => {
    const s = buildGameSettingsFromChallenge(row({ archetype: 'domination' }));
    expect(s.victory_type).toBe('domination');
    expect(s.allowed_victory_conditions).toEqual(['domination']);
  });
});
