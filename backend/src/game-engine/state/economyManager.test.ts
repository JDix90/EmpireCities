import { describe, it, expect } from 'vitest';
import {
  getBuildingDefenseBonus,
  getSeaDefenseBonus,
  validateBuild,
  applyBuild,
  COASTAL_BATTERY_SEA_DEFENSE_BONUS,
} from './economyManager';
import type { GameState, PlayerState, TerritoryState, GameSettings, BuildingType } from '../../types';

// ── Test fixtures ─────────────────────────────────────────────────────────────

function makeSettings(overrides?: Partial<GameSettings>): GameSettings {
  return {
    fog_of_war: false,
    victory_type: 'domination',
    turn_timer_seconds: 0,
    initial_unit_count: 3,
    card_set_escalating: true,
    diplomacy_enabled: false,
    economy_enabled: true,
    ...overrides,
  };
}

function makePlayer(id: string, overrides?: Partial<PlayerState>): PlayerState {
  return {
    player_id: id,
    player_index: 0,
    username: id,
    color: '#fff',
    is_ai: false,
    is_eliminated: false,
    territory_count: 1,
    cards: [],
    mmr: 1000,
    capital_territory_id: null,
    secret_mission: null,
    special_resource: 100,
    ...overrides,
  };
}

function makeTerritory(id: string, ownerId: string | null, buildings: BuildingType[] = [], overrides?: Partial<TerritoryState>): TerritoryState {
  return {
    territory_id: id,
    owner_id: ownerId,
    unit_count: 3,
    unit_type: 'infantry',
    buildings,
    ...overrides,
  };
}

function makeState(overrides?: {
  settings?: Partial<GameSettings>;
  players?: PlayerState[];
  territories?: Record<string, TerritoryState>;
}): GameState {
  return {
    game_id: 'g1',
    era: 'ww2',
    map_id: 'test_map',
    phase: 'draft',
    current_player_index: 0,
    round_number: 1,
    turn_count: 1,
    players: overrides?.players ?? [makePlayer('p1')],
    territories: overrides?.territories ?? {},
    settings: makeSettings(overrides?.settings),
    continents: [],
    card_deck: [],
    discard_pile: [],
    pending_card_awards: {},
    combat_log: [],
    action_history: [],
  } as unknown as GameState;
}

// ── getSeaDefenseBonus ────────────────────────────────────────────────────────

describe('getSeaDefenseBonus', () => {
  it('returns 0 when economy is disabled', () => {
    const state = makeState({
      settings: { economy_enabled: false },
      territories: { T1: makeTerritory('T1', 'p1', ['coastal_battery']) },
    });
    expect(getSeaDefenseBonus(state, 'T1')).toBe(0);
  });

  it('returns 0 when the territory has no coastal_battery', () => {
    const state = makeState({
      territories: { T1: makeTerritory('T1', 'p1', ['port', 'defense_1']) },
    });
    expect(getSeaDefenseBonus(state, 'T1')).toBe(0);
  });

  it('returns 0 for an unknown territory id', () => {
    const state = makeState();
    expect(getSeaDefenseBonus(state, 'NOPE')).toBe(0);
  });

  it('returns +1 when a coastal_battery is present', () => {
    const state = makeState({
      territories: { T1: makeTerritory('T1', 'p1', ['port', 'coastal_battery']) },
    });
    expect(getSeaDefenseBonus(state, 'T1')).toBe(COASTAL_BATTERY_SEA_DEFENSE_BONUS);
    expect(getSeaDefenseBonus(state, 'T1')).toBe(1);
  });

  it('does NOT double-count with the general building defense bonus', () => {
    // coastal_battery is intentionally *excluded* from getBuildingDefenseBonus,
    // because it's conditional on the sea-attack vector. The combat handler sums them separately.
    const state = makeState({
      territories: { T1: makeTerritory('T1', 'p1', ['port', 'coastal_battery', 'defense_2']) },
    });
    expect(getBuildingDefenseBonus(state, 'T1')).toBe(2);        // only defense_2
    expect(getSeaDefenseBonus(state, 'T1')).toBe(1);              // only coastal_battery
  });
});

// ── validateBuild for coastal_battery ─────────────────────────────────────────

describe('validateBuild(coastal_battery)', () => {
  it('rejects when no harbor exists on the territory', () => {
    const state = makeState({
      territories: { T1: makeTerritory('T1', 'p1', [], { naval_units: 0 }) },
    });
    const result = validateBuild(state, 'p1', 'T1', 'coastal_battery');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Port or Naval Base/i);
  });

  it('accepts when a Port is present', () => {
    const state = makeState({
      territories: { T1: makeTerritory('T1', 'p1', ['port'], { naval_units: 1 }) },
    });
    const result = validateBuild(state, 'p1', 'T1', 'coastal_battery');
    expect(result.valid).toBe(true);
  });

  it('accepts when a Naval Base is present (no port remaining)', () => {
    const state = makeState({
      territories: { T1: makeTerritory('T1', 'p1', ['naval_base'], { naval_units: 2 }) },
    });
    const result = validateBuild(state, 'p1', 'T1', 'coastal_battery');
    expect(result.valid).toBe(true);
  });

  it('rejects a second coastal_battery on the same territory', () => {
    const state = makeState({
      territories: { T1: makeTerritory('T1', 'p1', ['port', 'coastal_battery'], { naval_units: 1 }) },
    });
    const result = validateBuild(state, 'p1', 'T1', 'coastal_battery');
    expect(result.valid).toBe(false);
  });

  it('rejects when economy is disabled', () => {
    const state = makeState({
      settings: { economy_enabled: false },
      territories: { T1: makeTerritory('T1', 'p1', ['port'], { naval_units: 1 }) },
    });
    const result = validateBuild(state, 'p1', 'T1', 'coastal_battery');
    expect(result.valid).toBe(false);
  });

  it('rejects when the player cannot afford the 4 production cost', () => {
    const state = makeState({
      players: [makePlayer('p1', { special_resource: 3 })],
      territories: { T1: makeTerritory('T1', 'p1', ['port'], { naval_units: 1 }) },
    });
    const result = validateBuild(state, 'p1', 'T1', 'coastal_battery');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Not enough production/i);
  });
});

// ── applyBuild preserves the harbor ───────────────────────────────────────────

describe('applyBuild(coastal_battery)', () => {
  it('adds coastal_battery without removing the port', () => {
    const state = makeState({
      players: [makePlayer('p1', { special_resource: 10 })],
      territories: { T1: makeTerritory('T1', 'p1', ['port'], { naval_units: 1 }) },
    });
    applyBuild(state, 'p1', 'T1', 'coastal_battery');
    expect(state.territories.T1.buildings).toEqual(expect.arrayContaining(['port', 'coastal_battery']));
    expect(state.players[0].special_resource).toBe(6); // 10 - 4
  });
});
