import { describe, it, expect } from 'vitest';
import type { GameMap, GameState } from '../../types';
import { computeAiTurn } from './aiBot';

/**
 * The bot never plans a land attack on a truce partner. Influence seizes ground
 * just as surely, and breaks a truce the same way, so it passes a partner by
 * too. (The Moon powers are pinned in aiMoonPowers.test.ts.)
 */

const AI = 'ai_1';
const PARTNER = 'p1';

function map(): GameMap {
  return {
    map_id: 'truce_fixture',
    name: 'Truce Fixture',
    territories: [
      { territory_id: 'home', name: 'Home', polygon: [], center_point: [0, 0], region_id: 'r' },
      { territory_id: 'weak', name: 'Weak', polygon: [], center_point: [1, 0], region_id: 'r' },
    ],
    connections: [{ from: 'home', to: 'weak', type: 'land' }],
    regions: [{ region_id: 'r', name: 'R', bonus: 0 }],
  } as unknown as GameMap;
}

function state(truce: boolean): GameState {
  return {
    game_id: 'g',
    era: 'cold_war',
    map_id: 'truce_fixture',
    phase: 'attack',
    turn_number: 5,
    current_player_index: 0,
    players: [
      { player_id: AI, player_index: 0, username: 'AI', color: '#000', is_ai: true, is_eliminated: false, territory_count: 1, cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000 },
      { player_id: PARTNER, player_index: 1, username: 'P', color: '#fff', is_ai: false, is_eliminated: false, territory_count: 1, cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000 },
    ],
    territories: {
      home: { territory_id: 'home', owner_id: AI, unit_count: 8 },
      weak: { territory_id: 'weak', owner_id: PARTNER, unit_count: 1 },
    },
    settings: {},
    era_modifiers: { influence_spread: true, influence_range: 1 },
    diplomacy: truce ? [{ player_index_a: 0, player_index_b: 1, status: 'truce', truce_turns_remaining: 2 }] : [],
    card_deck: [],
    discard_pile: [],
  } as unknown as GameState;
}

const planned = (s: GameState) => computeAiTurn(s, map(), 'medium').filter((a) => a.type === 'attack');

describe('the bot honours its truces with Influence', () => {
  it('seizes a weak neighbour it holds no truce with', () => {
    expect(planned(state(false)).filter((a) => a.from === '__influence__').map((a) => a.to)).toEqual(['weak']);
  });

  it('passes a truce partner by, as its attack planner does', () => {
    expect(planned(state(true))).toEqual([]);
  });
});
