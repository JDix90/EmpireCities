import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initializeGameState } from './gameStateManager';
import { anyWholeRegionDealt, fairFirstMatchStartingIndex } from './fairFirstMatch';
import type { GameMap, GameSettings, TerritoryState } from '../../types';

// The first match's own board: 14 territories, regions of 2, 2, 4 and 6.
const BRITAIN = JSON.parse(
  readFileSync(join(__dirname, '../../../../database/maps/community_britain_925.json'), 'utf-8'),
) as GameMap;

const SETTINGS = {
  fog_of_war: false, turn_timer_seconds: 0, initial_unit_count: 3, card_set_escalating: true,
  diplomacy_enabled: false, factions_enabled: false, allowed_victory_conditions: ['domination', 'threshold'],
  victory_threshold: 65, victory_type: 'domination',
} as unknown as GameSettings;

function seats(humanIndex: number) {
  return [0, 1].map((i) => ({
    player_id: i === humanIndex ? 'human' : 'bot',
    player_index: i,
    username: i === humanIndex ? 'Newcomer' : 'Bot',
    color: '#888',
    is_ai: i !== humanIndex,
    is_eliminated: false,
    mmr: 1000,
  }));
}

const start = (settings: Partial<GameSettings>, fair: boolean, humanIndex = 0) =>
  initializeGameState('g', 'medieval', BRITAIN, seats(humanIndex), { ...SETTINGS, ...settings } as GameSettings, {
    fairFirstMatchStart: fair,
  });

describe('fair first match (first_match_fair_start_enabled)', () => {
  it('always seats the human first and never deals a whole region', () => {
    for (let i = 0; i < 300; i++) {
      const state = start({ first_match: true }, true);
      expect(state.players[state.current_player_index]!.player_id).toBe('human');
      expect(anyWholeRegionDealt(state.territories, BRITAIN, Object.keys(state.territories))).toBe(false);
    }
  });

  it('finds the human wherever they sit', () => {
    for (let i = 0; i < 50; i++) {
      const state = start({ first_match: true }, true, 1);
      expect(state.players[state.current_player_index]!.player_id).toBe('human');
    }
  });

  it('leaves seat and deal to chance in any other game, or with the flag off', () => {
    // Over 300 starts each, a random seat and an unchecked deal both show up.
    for (const [settings, fair] of [[{}, true], [{ first_match: true }, false]] as const) {
      let botFirst = 0;
      let wholeRegion = 0;
      for (let i = 0; i < 300; i++) {
        const state = start(settings, fair);
        if (state.players[state.current_player_index]!.player_id === 'bot') botFirst++;
        if (anyWholeRegionDealt(state.territories, BRITAIN, Object.keys(state.territories))) wholeRegion++;
      }
      expect(botFirst).toBeGreaterThan(0);
      expect(wholeRegion).toBeGreaterThan(0);
    }
  });
});

describe('anyWholeRegionDealt', () => {
  const map = {
    territories: [
      { territory_id: 'a', region_id: 'r1' }, { territory_id: 'b', region_id: 'r1' },
      { territory_id: 'c', region_id: 'r2' }, { territory_id: 'd', region_id: 'free' },
    ],
    regions: [{ region_id: 'r1', bonus: 2 }, { region_id: 'r2', bonus: 1 }, { region_id: 'free', bonus: 0 }],
  } as unknown as GameMap;
  const owned = (owners: Record<string, string | null>) =>
    Object.fromEntries(Object.entries(owners).map(([id, owner_id]) => [id, { territory_id: id, owner_id, unit_count: 3 } as TerritoryState]));

  it('spots a region one player holds whole', () => {
    expect(anyWholeRegionDealt(owned({ a: 'p1', b: 'p1', c: 'p2', d: 'p2' }), map, ['a', 'b', 'c', 'd'])).toBe(true);
  });

  it('ignores a region that pays no bonus, and ground nobody holds', () => {
    expect(anyWholeRegionDealt(owned({ a: 'p1', b: 'p2', c: null, d: 'p2' }), map, ['a', 'b', 'c', 'd'])).toBe(false);
  });

  it('reads a one-territory region as whole: holding it pays its bonus', () => {
    expect(anyWholeRegionDealt(owned({ a: 'p1', b: 'p2', c: 'p1', d: 'p2' }), map, ['a', 'b', 'c', 'd'])).toBe(true);
  });
});

describe('fairFirstMatchStartingIndex', () => {
  it('is the first human seat, or nothing when every seat is a bot', () => {
    expect(fairFirstMatchStartingIndex([{ is_ai: true }, { is_ai: false }])).toBe(1);
    expect(fairFirstMatchStartingIndex([{ is_ai: true }])).toBeNull();
  });
});
