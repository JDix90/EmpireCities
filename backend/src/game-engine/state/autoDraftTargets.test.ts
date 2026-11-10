import { describe, it, expect } from 'vitest';
import { autoDraftStackOrder } from './autoDraftTargets';
import { autoPlaceDraftUnits, advancePhaseOnTimeout } from './gameStateManager';
import type { GameMap, GameSettings, GameState, PlayerState, TerritoryState } from '../../types';

// p1 holds an interior territory (home) and two borders: north faces 6 enemy
// units across two territories, south faces 2. The first two neighbours of
// north are p2's; `wild` is neutral ground, which counts as a border.
//
//   wild(neutral 1) ─ north(p1 2) ─ raider(p2 5)
//                       │
//                     home(p1 4)
//                       │
//                     south(p1 3) ─ scout(p2 2)
const MAP = {
  map_id: 'm',
  territories: ['home', 'north', 'south', 'raider', 'scout', 'wild'].map((territory_id) => ({ territory_id, region_id: 'r' })),
  connections: [
    { from: 'home', to: 'north', type: 'land' },
    { from: 'home', to: 'south', type: 'land' },
    { from: 'north', to: 'raider', type: 'land' },
    { from: 'north', to: 'wild', type: 'land' },
    { from: 'south', to: 'scout', type: 'land' },
  ],
  regions: [],
} as unknown as GameMap;

const territory = (id: string, owner: string | null, units: number, extra: Partial<TerritoryState> = {}): TerritoryState =>
  ({ territory_id: id, owner_id: owner, unit_count: units, unit_type: 'infantry', ...extra });

function player(player_id: string, player_index: number): PlayerState {
  return { player_id, player_index, username: player_id, color: '#888', is_ai: false, is_eliminated: false, territory_count: 0, cards: [], mmr: 1000 } as unknown as PlayerState;
}

function state(overrides: Partial<GameState> = {}, settings: Partial<GameSettings> = {}): GameState {
  return {
    game_id: 'g', era: 'ancient', map_id: 'm', phase: 'draft', current_player_index: 0, turn_number: 3,
    players: [player('p1', 0), player('p2', 1)],
    territories: {
      home: territory('home', 'p1', 4),
      north: territory('north', 'p1', 2),
      south: territory('south', 'p1', 3),
      raider: territory('raider', 'p2', 5),
      scout: territory('scout', 'p2', 2),
      wild: territory('wild', null, 1),
    },
    card_deck: [], card_set_redemption_count: 0, diplomacy: [],
    settings: { fog_of_war: false, turn_timer_seconds: 300, initial_unit_count: 3, card_set_escalating: true, diplomacy_enabled: false, ...settings } as GameSettings,
    draft_units_remaining: 5,
    turn_started_at: Date.now(),
    win_probability_history: [],
    ...overrides,
  } as GameState;
}

describe('autoDraftStackOrder', () => {
  it('puts the most threatened border first, then other borders, then the interior', () => {
    // north faces raider 5 + neutral wild 1 = 6; south faces scout 2.
    expect(autoDraftStackOrder(state(), MAP, 'p1')).toEqual(['north', 'south', 'home']);
  });

  it('breaks a tie in threat by the bigger stack, then by id', () => {
    const s = state();
    s.territories.raider.unit_count = 1; // north: 1 + 1 = 2, south: 2
    expect(autoDraftStackOrder(s, MAP, 'p1')).toEqual(['south', 'north', 'home']);
    s.territories.south.unit_count = 2; // same threat, same stack: by id
    expect(autoDraftStackOrder(s, MAP, 'p1')).toEqual(['north', 'south', 'home']);
  });
});

describe('autoPlaceDraftUnits with stacking', () => {
  it('stacks every unit on the most threatened border', () => {
    const s = state();
    const res = autoPlaceDraftUnits(s, { stackOn: MAP });
    expect(res).toEqual({ total: 5, placements: [{ territory_id: 'north', units: 5, totalAfter: 7 }] });
    expect(s.draft_units_remaining).toBe(0);
    expect(s.territories.south.unit_count).toBe(3);
    expect(s.territories.home.unit_count).toBe(4);
  });

  it('spills to the next border only past a stability cap', () => {
    const s = state({}, { stability_enabled: true });
    s.territories.north.stability = 40; // 30-49 → cap 3
    s.territories.south.stability = 100;
    s.territories.home.stability = 100;
    const res = autoPlaceDraftUnits(s, { stackOn: MAP });
    expect(res.placements).toEqual([
      { territory_id: 'north', units: 3, totalAfter: 5 },
      { territory_id: 'south', units: 2, totalAfter: 5 },
    ]);
    expect(s.draft_placements_this_turn).toEqual({ north: 3, south: 2 });
  });

  it('spreads round-robin, as before, without the map', () => {
    const s = state();
    const res = autoPlaceDraftUnits(s);
    // Sorted ids home, north, south: 2 + 2 + 1.
    expect(res.placements.map((p) => [p.territory_id, p.units])).toEqual([['home', 2], ['north', 2], ['south', 1]]);
  });
});

describe('advancePhaseOnTimeout with stacking', () => {
  it('stacks what is left of the draft when asked to, and ends the turn', () => {
    const s = state();
    const res = advancePhaseOnTimeout(s, MAP, { stackAutoDraft: true });
    expect(res.kind).toBe('turn');
    if (res.kind === 'turn') expect(res.autoDraft.placements).toEqual([{ territory_id: 'north', units: 5, totalAfter: 7 }]);
    expect(s.current_player_index).toBe(1);
  });

  it('spreads as before when not asked to', () => {
    const s = state();
    const res = advancePhaseOnTimeout(s, MAP);
    if (res.kind === 'turn') expect(res.autoDraft.placements).toHaveLength(3);
  });
});
