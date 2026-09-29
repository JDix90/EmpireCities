import { describe, it, expect } from 'vitest';
import {
  initializeGameState,
  advancePhaseOnTimeout,
  checkVictory,
  claimSelectionTerritory,
} from './gameStateManager';
import { isMissionComplete } from '../victory/missions';
import type { GameMap, GameSettings } from '../../types';

const map: GameMap = {
  map_id: 'draft_map',
  name: 'Draft',
  territories: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({
    territory_id: id, name: id.toUpperCase(), polygon: [], center_point: [0, 0], region_id: 'r',
  })),
  connections: [
    { from: 'a', to: 'b', type: 'land' }, { from: 'b', to: 'c', type: 'land' },
    { from: 'c', to: 'd', type: 'land' }, { from: 'd', to: 'e', type: 'land' },
    { from: 'e', to: 'f', type: 'land' },
  ],
  regions: [{ region_id: 'r', name: 'R', bonus: 0 }],
} as unknown as GameMap;

function draftGame(overrides: Partial<GameSettings> = {}) {
  const settings = {
    fog_of_war: false,
    victory_type: 'capital',
    allowed_victory_conditions: ['capital'],
    turn_timer_seconds: 300,
    initial_unit_count: 3,
    card_set_escalating: true,
    diplomacy_enabled: false,
    territory_selection: true,
    stability_enabled: true,
    ...overrides,
  } as GameSettings;
  const players = ['p1', 'p2'].map((id, i) => ({
    player_id: id, player_index: i, username: id, color: '#000', is_ai: false, is_eliminated: false, mmr: 1000,
  }));
  return initializeGameState('draft-game', 'ww2', map, players, settings);
}

/** Every pick times out, so the draft is driven only by the turn clock. */
function runDraftOnTimeouts(state: ReturnType<typeof draftGame>) {
  for (let i = 0; i < 20 && state.phase === 'territory_select'; i++) advancePhaseOnTimeout(state, map);
}

describe('Territory Draft', () => {
  it('starts with nothing owned, so ownership-derived setup has to wait for the draft', () => {
    const state = draftGame();
    expect(state.phase).toBe('territory_select');
    expect(Object.values(state.territories).every((t) => !t.owner_id)).toBe(true);
  });

  it('a timeout picks for the seat that ran out of time instead of ending the draft', () => {
    const state = draftGame();
    const seat = state.players[state.current_player_index]!.player_id;
    const adv = advancePhaseOnTimeout(state, map);
    expect(adv.kind).toBe('selection');
    expect(state.phase).toBe('territory_select');
    expect(Object.values(state.territories).filter((t) => t.owner_id === seat)).toHaveLength(1);
    expect(state.players[state.current_player_index]!.player_id).not.toBe(seat);
  });

  it('never leaves a territory neutral at 0 units when the clock runs the whole draft', () => {
    const state = draftGame();
    runDraftOnTimeouts(state);
    expect(state.phase).toBe('draft');
    for (const t of Object.values(state.territories)) {
      expect(t.owner_id).toBeTruthy();
      expect(t.unit_count).toBe(3);
    }
    expect(state.players.map((p) => p.territory_count)).toEqual([3, 3]);
    expect(state.draft_units_remaining).toBeGreaterThan(0);
  });

  it('assigns capitals once the map is claimed, so Capital victory can fire', () => {
    const state = draftGame();
    runDraftOnTimeouts(state);
    for (const p of state.players) {
      expect(p.capital_territory_id).toBeTruthy();
      expect(state.territories[p.capital_territory_id!]!.owner_id).toBe(p.player_id);
    }
    // Take the rival's capital: the capital win is now reachable.
    const [p1, p2] = state.players;
    state.territories[p2!.capital_territory_id!]!.owner_id = p1!.player_id;
    expect(checkVictory(state, map)?.condition).toBe('capital');
  });

  it('gives every drafted territory stability and population', () => {
    const state = draftGame();
    runDraftOnTimeouts(state);
    for (const t of Object.values(state.territories)) {
      expect(t.stability).toBe(80);
      expect(t.population).toBe(3);
    }
  });

  it('leaves stability off when the game does not use it', () => {
    const state = draftGame({ stability_enabled: false });
    runDraftOnTimeouts(state);
    expect(Object.values(state.territories).every((t) => t.stability == null)).toBe(true);
  });
});

describe('Territory Draft opening income', () => {
  it('pays the opening economy tick once the draft ends, as a dealt game gets at creation', () => {
    const state = draftGame({ economy_enabled: true, tech_trees_enabled: true });
    const before = state.players.map((p) => p.special_resource ?? 0);
    runDraftOnTimeouts(state);
    state.players.forEach((p, i) => {
      // 3 territories each: at least the 1-PP base income on top of the 4 PP start.
      expect(p.special_resource ?? 0).toBeGreaterThan(before[i]!);
    });
  });

  it('pays nothing extra when the economy is off', () => {
    const state = draftGame();
    runDraftOnTimeouts(state);
    expect(state.players.every((p) => !p.special_resource)).toBe(true);
  });
});

describe('Territory Draft with secret missions', () => {
  // Three two-tile regions. Seats alternate from seat 0, so the picks below give
  // p1 all of `west` and p2 all of `mid`, and split `east`.
  const regionMap = {
    map_id: 'draft_regions',
    name: 'Draft regions',
    territories: [['w1', 'west'], ['w2', 'west'], ['m1', 'mid'], ['m2', 'mid'], ['e1', 'east'], ['e2', 'east']]
      .map(([id, region]) => ({ territory_id: id, name: id, polygon: [], center_point: [0, 0], region_id: region })),
    connections: [
      { from: 'w1', to: 'w2', type: 'land' }, { from: 'w2', to: 'm1', type: 'land' },
      { from: 'm1', to: 'm2', type: 'land' }, { from: 'm2', to: 'e1', type: 'land' },
      { from: 'e1', to: 'e2', type: 'land' },
    ],
    regions: ['west', 'mid', 'east'].map((r) => ({ region_id: r, name: r, bonus: 2 })),
  } as unknown as GameMap;
  const picks = ['w1', 'm1', 'w2', 'm2', 'e1', 'e2'];

  function missionDraft(gameId: string) {
    const settings = {
      fog_of_war: false,
      allowed_victory_conditions: ['secret_mission'],
      turn_timer_seconds: 300,
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: false,
      territory_selection: true,
    } as GameSettings;
    const players = ['p1', 'p2'].map((id, i) => ({
      player_id: id, player_index: i, username: id, color: '#000', is_ai: false, is_eliminated: false, mmr: 1000,
    }));
    return initializeGameState(gameId, 'ww2', regionMap, players, settings, { forceStartingPlayerIndex: 0 });
  }

  it('deals no mission until the draft ends, so nobody can draft theirs', () => {
    const state = missionDraft('draft-missions');
    expect(state.players.map((p) => p.secret_mission ?? null)).toEqual([null, null]);
  });

  it('deals every mission once the map is claimed, none of them already won', () => {
    for (let i = 0; i < 40; i++) {
      const state = missionDraft(`draft-missions-${i}`);
      for (const id of picks) claimSelectionTerritory(state, regionMap, id);
      expect(state.phase).toBe('draft');
      for (const p of state.players) {
        expect(p.secret_mission).toBeTruthy();
        expect(isMissionComplete(state, regionMap, p)).toBe(false);
      }
      expect(checkVictory(state, regionMap)).toBeNull();
    }
  });
});
