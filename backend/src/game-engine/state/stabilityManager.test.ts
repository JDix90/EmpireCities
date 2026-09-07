import { describe, expect, it } from 'vitest';
import { getDeployCap } from './stabilityManager';

describe('getDeployCap', () => {
  it('returns Infinity when stability is undefined', () => {
    expect(getDeployCap(undefined)).toBe(Infinity);
  });

  it('returns Infinity when stability is healthy (>= 50)', () => {
    expect(getDeployCap(50)).toBe(Infinity);
    expect(getDeployCap(85)).toBe(Infinity);
  });

  it('keeps strict early-game cap for critical stability without progression bonuses', () => {
    const cap = getDeployCap(20, {
      era: 'ancient',
      turnNumber: 1,
      economyEnabled: false,
      playerSpecialResource: 99,
    });
    expect(cap).toBe(1);
  });

  it('scales cap upward in late game using era + turn + economy bonuses', () => {
    const cap = getDeployCap(20, {
      era: 'space_age',
      turnNumber: 25,
      economyEnabled: true,
      playerSpecialResource: 30,
    });
    expect(cap).toBe(12);
  });

  it('applies moderate scaling for low stability in mid game', () => {
    const cap = getDeployCap(40, {
      era: 'coldwar',
      turnNumber: 9,
      economyEnabled: true,
      playerSpecialResource: 10,
    });
    expect(cap).toBe(8);
  });

  it('does not apply economy bonus when economy is disabled', () => {
    const cap = getDeployCap(40, {
      era: 'modern',
      turnNumber: 17,
      economyEnabled: false,
      playerSpecialResource: 100,
    });
    // base 3 + era 2 + turn 4 + econ 0
    expect(cap).toBe(9);
  });
});

import { getPopulationGrowthChance } from './stabilityManager';
import type { GameState } from '../../types';

function factionState(factionsEnabled: boolean, factionId: string): GameState {
  return {
    game_id: 'g1',
    era: 'space_age',
    map_id: 'era_space_age',
    phase: 'draft',
    turn_number: 1,
    current_player_index: 0,
    players: [{
      player_id: 'p1',
      player_index: 0,
      username: 'P1',
      color: '#fff',
      is_ai: false,
      is_eliminated: false,
      territory_count: 1,
      cards: [],
      mmr: 1000,
      capital_territory_id: null,
      secret_mission: null,
      faction_id: factionId,
    }],
    territories: {},
    settings: {
      fog_of_war: false,
      turn_timer_seconds: 0,
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: false,
      stability_enabled: true,
      factions_enabled: factionsEnabled,
    },
  } as GameState;
}

describe('getPopulationGrowthChance', () => {
  const BASE = 1 / 4; // 1 / POPULATION_GROWTH_INTERVAL

  it('doubles the growth chance for a population_growth_multiplier faction', () => {
    expect(getPopulationGrowthChance(factionState(true, 'climate_alliance'), 'p1')).toBeCloseTo(BASE * 2);
  });

  it('uses the base chance when factions are disabled', () => {
    expect(getPopulationGrowthChance(factionState(false, 'climate_alliance'), 'p1')).toBeCloseTo(BASE);
  });

  it('uses the base chance for a faction without a multiplier', () => {
    expect(getPopulationGrowthChance(factionState(true, 'terran_federation'), 'p1')).toBeCloseTo(BASE);
  });

  it('uses the base chance for an unknown player', () => {
    expect(getPopulationGrowthChance(factionState(true, 'climate_alliance'), 'nobody')).toBeCloseTo(BASE);
  });
});
