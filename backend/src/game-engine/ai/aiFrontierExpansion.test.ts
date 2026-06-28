import { describe, it, expect } from 'vitest';
import type { GameMap, GameState, PlayerState, TerritoryState } from '../../types';
import { computeAiTurn } from './aiBot';

function player(id: string): PlayerState {
  return {
    player_id: id,
    player_index: 0,
    username: id,
    color: '#fff',
    is_ai: true,
    is_eliminated: false,
    territory_count: 1,
    cards: [],
    mmr: 1000,
    capital_territory_id: null,
    secret_mission: null,
    current_era_index: 1,
  } as PlayerState;
}

function terr(id: string, owner: string | null, units: number, world_id = 'earth'): TerritoryState {
  return { territory_id: id, owner_id: owner, unit_count: units, unit_type: 'infantry', world_id, region_id: 'r1' };
}

/** Each test gets a unique map_id — aiBot caches adjacency by map_id across tests. */
let mapSeq = 0;
function makeMap(frontierWorldId: string): GameMap {
  mapSeq += 1;
  return {
    map_id: `frontier_test_${mapSeq}`,
    name: 'Frontier Test',
    territories: [
      { territory_id: 'home', name: 'Home', polygon: [[0, 0], [1, 0], [1, 1]], center_point: [0, 0], region_id: 'r1' },
      { territory_id: 'frontier', name: 'Frontier', polygon: [[2, 0], [3, 0], [3, 1]], center_point: [2, 0], region_id: 'r1', ...(frontierWorldId !== 'earth' ? { world_id: frontierWorldId } : {}) },
    ],
    connections: [{ from: 'home', to: 'frontier', type: 'land' }],
    regions: [{ region_id: 'r1', name: 'R1', bonus: 0 }],
  } as GameMap;
}

function makeState(map: GameMap, frontier: TerritoryState, eraAdvancement: boolean): GameState {
  return {
    game_id: 'g',
    era: 'ancient',
    map_id: map.map_id,
    phase: 'draft',
    current_player_index: 0,
    turn_number: 3,
    players: [player('ai1')],
    territories: {
      home: terr('home', 'ai1', 8),
      frontier,
    },
    map_era_floor: 1,
    card_deck: [],
    card_set_redemption_count: 0,
    diplomacy: [],
    settings: { era_advancement_enabled: eraAdvancement },
  } as unknown as GameState;
}

describe('AI frontier expansion', () => {
  it('plans an attack on a neutral Earth frontier in an era-advancement game', () => {
    const map = makeMap('earth');
    const state = makeState(map, terr('frontier', null, 3), true);
    const actions = computeAiTurn(state, map, 'hard');
    const attacksFrontier = actions.some((a) => a.type === 'attack' && a.to === 'frontier');
    expect(attacksFrontier).toBe(true);
  });

  it('does NOT plan a neutral attack when era advancement is off', () => {
    const map = makeMap('earth');
    const state = makeState(map, terr('frontier', null, 3), false);
    const actions = computeAiTurn(state, map, 'hard');
    expect(actions.some((a) => a.type === 'attack' && a.to === 'frontier')).toBe(false);
  });

  it('never plans an attack on a neutral OFF-WORLD garrison, even in era-advancement', () => {
    const map = makeMap('moon');
    const state = makeState(map, terr('frontier', null, 3, 'moon'), true);
    const actions = computeAiTurn(state, map, 'hard');
    expect(actions.some((a) => a.type === 'attack' && a.to === 'frontier')).toBe(false);
  });
});
