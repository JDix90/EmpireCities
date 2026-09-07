import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assignSecretMissions, isMissionComplete } from './missions';
import { checkVictory, initializeGameState } from '../state/gameStateManager';
import type { GameMap, GameState, PlayerState } from '../../types';

function mkPlayer(id: string, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    player_id: id, player_index: 0, username: id, color: '#fff', is_ai: false,
    is_eliminated: false, territory_count: 1, cards: [], mmr: 1000,
    capital_territory_id: null, secret_mission: null, ...overrides,
  } as PlayerState;
}

const miniMap: GameMap = {
  map_id: 'm',
  name: 'M',
  territories: [
    { territory_id: 'a', name: 'A', polygon: [], center_point: [0, 0], region_id: 'north' },
    { territory_id: 'b', name: 'B', polygon: [], center_point: [0, 0], region_id: 'north' },
    { territory_id: 'c', name: 'C', polygon: [], center_point: [0, 0], region_id: 'south' },
  ],
  connections: [],
  regions: [
    { region_id: 'north', name: 'N', bonus: 1 },
    { region_id: 'south', name: 'S', bonus: 1 },
  ],
};

function baseState(players: PlayerState[]): GameState {
  return {
    game_id: 'g',
    era: 'ancient',
    map_id: 'm',
    phase: 'attack',
    current_player_index: 0,
    turn_number: 1,
    players,
    territories: {
      a: { territory_id: 'a', owner_id: 'p1', unit_count: 3, unit_type: 'infantry' },
      b: { territory_id: 'b', owner_id: 'p1', unit_count: 2, unit_type: 'infantry' },
      c: { territory_id: 'c', owner_id: 'p2', unit_count: 3, unit_type: 'infantry' },
    },
    card_deck: [],
    card_set_redemption_count: 0,
    diplomacy: [],
    settings: {
      fog_of_war: false,
      allowed_victory_conditions: ['secret_mission'],
      turn_timer_seconds: 0,
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: false,
    },
    draft_units_remaining: 0,
    turn_started_at: Date.now(),
  };
}

describe('isMissionComplete', () => {
  it('capture_territories when both owned', () => {
    const p: PlayerState = {
      player_id: 'p1',
      player_index: 0,
      username: 'a',
      color: '#fff',
      is_ai: false,
      is_eliminated: false,
      territory_count: 2,
      cards: [],
      mmr: 1000,
      capital_territory_id: null,
      secret_mission: { kind: 'capture_territories', territory_ids: ['a', 'b'] },
    };
    const state = baseState([p, { ...p, player_id: 'p2', player_index: 1, secret_mission: null }]);
    expect(isMissionComplete(state, miniMap, p)).toBe(true);
  });

  it('eliminate_player when target eliminated', () => {
    const p1: PlayerState = {
      player_id: 'p1',
      player_index: 0,
      username: 'a',
      color: '#fff',
      is_ai: false,
      is_eliminated: false,
      territory_count: 1,
      cards: [],
      mmr: 1000,
      capital_territory_id: null,
      secret_mission: { kind: 'eliminate_player', target_player_id: 'p2' },
    };
    const p2: PlayerState = {
      player_id: 'p2',
      player_index: 1,
      username: 'b',
      color: '#000',
      is_ai: false,
      is_eliminated: true,
      territory_count: 0,
      cards: [],
      mmr: 1000,
      capital_territory_id: null,
      secret_mission: null,
    };
    const state = baseState([p1, p2]);
    expect(isMissionComplete(state, miniMap, p1)).toBe(true);
  });

  it('reach_era completes once the player hits the target era index', () => {
    const below = mkPlayer('p1', { current_era_index: 1, secret_mission: { kind: 'reach_era', era_index: 2, era_id: 'discovery' } });
    const state = baseState([below, mkPlayer('p2')]);
    expect(isMissionComplete(state, miniMap, below)).toBe(false);
    below.current_era_index = 2;
    expect(isMissionComplete(state, miniMap, below)).toBe(true);
  });
});

describe('assignSecretMissions — era missions', () => {
  it('assigns a reach_era objective when era advancement is on', () => {
    const state = baseState([mkPlayer('p1'), mkPlayer('p2')]);
    state.settings.era_advancement_enabled = true;
    assignSecretMissions(state, miniMap, () => 0.1); // roll < 0.25 → era branch
    expect(state.players[0].secret_mission?.kind).toBe('reach_era');
  });

  it('does not assign era missions in non-era games (RNG stream unchanged)', () => {
    const state = baseState([mkPlayer('p1'), mkPlayer('p2')]);
    assignSecretMissions(state, miniMap, () => 0.1);
    expect(state.players[0].secret_mission?.kind).not.toBe('reach_era');
  });
});

describe('assignSecretMissions — orbit-gated targets excluded', () => {
  // A map with a Moon: moon tiles are behind the orbit-access ladder, so no
  // mission may target them or their region — that assignment would be wildly
  // unfair vs a rival whose mission is two ordinary tiles.
  const moonMap: GameMap = {
    ...miniMap,
    map_id: 'm_moon',
    territories: [
      ...miniMap.territories,
      { territory_id: 'moon_1', name: 'Moon 1', polygon: [], center_point: [0, 0], region_id: 'lunar', world_id: 'moon' },
      { territory_id: 'moon_2', name: 'Moon 2', polygon: [], center_point: [0, 0], region_id: 'lunar', world_id: 'moon' },
    ],
    regions: [...miniMap.regions, { region_id: 'lunar', name: 'Lunar', bonus: 6 }],
  } as GameMap;

  it('never targets moon territories or the all-gated lunar region', () => {
    // Sweep RNG values so every mission branch (capture / eliminate / regions) is hit.
    for (const roll of [0.05, 0.3, 0.5, 0.7, 0.9, 0.99]) {
      const state = baseState([mkPlayer('p1'), mkPlayer('p2')]);
      assignSecretMissions(state, moonMap, () => roll);
      for (const p of state.players) {
        const m = p.secret_mission;
        if (!m) continue;
        if (m.kind === 'capture_territories') {
          expect(m.territory_ids.some((t) => t.startsWith('moon_'))).toBe(false);
        }
        if (m.kind === 'control_regions') {
          expect(m.region_ids.includes('lunar')).toBe(false);
        }
      }
    }
  });
});

describe('assignSecretMissions — era-locked frontier targets (real era_space_age map)', () => {
  // era_space_age.json authors 8 tiles with `unlock_era_index` 1..5, and five
  // regions consist ONLY of them. With `space_age_frontiers_enabled` off those
  // tiles are never placed in `state.territories`, and mission completion reads
  // `state.territories[id]?.owner_id` — so a mission naming one of them (or one
  // of the frontier-only regions) was permanently unwinnable. Measured before
  // the fix: ~37% of capture_territories and ~48% of control_regions missions.
  const realMap = JSON.parse(
    readFileSync(join(__dirname, '../../../../database/maps/era_space_age.json'), 'utf8'),
  ) as GameMap;
  const frontierIds = new Set(
    realMap.territories.filter((t) => (t.unlock_era_index ?? 0) > 0).map((t) => t.territory_id),
  );
  const frontierOnlyRegions = [
    'pacific_frontier_2100',
    'polar_frontier_2100',
    'antarctic_2100',
    'atlantic_frontier_2100',
    'orbital_gateway_2100',
  ];

  function initSpaceAge(gameId: string, frontiersEnabled: boolean): GameState {
    return initializeGameState(
      gameId,
      'space_age',
      realMap,
      [0, 1, 2, 3].map((i) => ({
        player_id: `p${i + 1}`,
        player_index: i,
        username: `P${i + 1}`,
        color: '#abc',
        is_ai: i > 0,
        is_eliminated: false,
        mmr: 1000,
      })),
      {
        fog_of_war: false,
        victory_type: 'domination',
        allowed_victory_conditions: ['domination', 'secret_mission'],
        turn_timer_seconds: 0,
        initial_unit_count: 3,
        card_set_escalating: true,
        diplomacy_enabled: false,
        economy_enabled: true,
        tech_enabled: true,
        factions_enabled: false,
        space_age_frontiers_enabled: frontiersEnabled,
      },
    );
  }

  it('pins the map shape the regression depends on', () => {
    expect(frontierIds.size).toBe(8);
    for (const rid of frontierOnlyRegions) {
      const tiles = realMap.territories.filter((t) => t.region_id === rid);
      expect(tiles.length).toBeGreaterThan(0);
      expect(tiles.every((t) => frontierIds.has(t.territory_id))).toBe(true);
    }
  });

  it('flag off: every mission target exists on the live board (50 seeded games)', () => {
    let captureMissions = 0;
    let regionMissions = 0;
    for (let i = 0; i < 50; i++) {
      const state = initSpaceAge(`space-age-missions-${i}`, false);
      for (const tid of frontierIds) expect(state.territories[tid]).toBeUndefined();
      for (const p of state.players) {
        const m = p.secret_mission;
        if (!m) continue;
        if (m.kind === 'capture_territories') {
          captureMissions++;
          for (const tid of m.territory_ids) expect(state.territories[tid]).toBeDefined();
        }
        if (m.kind === 'control_regions') {
          regionMissions++;
          for (const rid of m.region_ids) expect(frontierOnlyRegions).not.toContain(rid);
        }
      }
    }
    // Guard against a vacuous pass if the RNG branch mix ever changes.
    expect(captureMissions).toBeGreaterThan(0);
    expect(regionMissions).toBeGreaterThan(0);
  });

  it('flag on: the full 63-tile board is seeded and frontier targets are allowed', () => {
    let sawFrontierTarget = false;
    for (let i = 0; i < 50; i++) {
      const state = initSpaceAge(`space-age-frontiers-${i}`, true);
      expect(Object.keys(state.territories).length).toBe(realMap.territories.length);
      expect(state.map_era_floor).toBe(5);
      for (const p of state.players) {
        const m = p.secret_mission;
        if (!m) continue;
        if (m.kind === 'capture_territories') {
          for (const tid of m.territory_ids) expect(state.territories[tid]).toBeDefined();
          if (m.territory_ids.some((tid) => frontierIds.has(tid))) sawFrontierTarget = true;
        }
        if (m.kind === 'control_regions' && m.region_ids.some((r) => frontierOnlyRegions.includes(r))) {
          sawFrontierTarget = true;
        }
      }
    }
    // Frontiers are now on the board, so they are legitimate targets again.
    expect(sawFrontierTarget).toBe(true);
  });
});

describe('transcendence victory', () => {
  function transcendState(p1Era: number, wonderOwner: string | null): GameState {
    const state = baseState([mkPlayer('p1', { current_era_index: p1Era }), mkPlayer('p2', { current_era_index: 0 })]);
    state.settings.allowed_victory_conditions = ['transcendence'];
    state.settings.era_advancement_enabled = true;
    if (wonderOwner) state.territories.a.buildings = ['wonder_great_library'];
    state.territories.a.owner_id = wonderOwner ?? 'p1';
    return state;
  }

  it('wins when at the final era AND holding the wonder', () => {
    // poc spine → max era index 1; p1 at era 1 owns the wonder on territory a.
    expect(checkVictory(transcendState(1, 'p1'), miniMap)).toEqual({ winnerIds: ['p1'], condition: 'transcendence' });
  });

  it('does not win without the wonder', () => {
    expect(checkVictory(transcendState(1, null), miniMap)).toBeNull();
  });

  it('does not win before reaching the final era', () => {
    expect(checkVictory(transcendState(0, 'p1'), miniMap)).toBeNull();
  });
});
