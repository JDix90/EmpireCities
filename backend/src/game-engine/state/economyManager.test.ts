import { describe, it, expect } from 'vitest';
import {
  getBuildingDefenseBonus,
  getSeaDefenseBonus,
  validateBuild,
  applyBuild,
  collectProduction,
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

/**
 * Building yields used to be floored per building, which meant a building on a
 * stressed territory paid nothing at all: production_1 yields 1, and at 80%
 * stability with population 5 that is floor(1 x 0.8 x 1.0) = 0. An empire of
 * ten such buildings earned exactly as much as an empire with none. They now
 * accumulate fractionally across the empire and floor once, matching how the
 * per-world bonus in the same function has always worked.
 */
describe('collectProduction — building yields', () => {
  const stressed = (id: string, buildings: BuildingType[]) =>
    makeTerritory(id, 'p1', buildings, { stability: 80, population: 5 });

  function stressedState(count: number, building: BuildingType) {
    const territories: Record<string, TerritoryState> = {};
    for (let i = 0; i < count; i++) territories[`t${i}`] = stressed(`t${i}`, [building]);
    return makeState({
      settings: { economy_enabled: true, tech_trees_enabled: true, stability_enabled: true },
      players: [makePlayer('p1', { special_resource: 0, tech_points: 0 })],
      territories,
    });
  }

  it('pays out buildings that individually round below 1', () => {
    // production_1 yields 1, scaled by stability 0.8 and population 5 (0.944)
    // = 0.756 each. Ten of them is 7.56 -> 7 of building income, plus the base
    // floor(10/3) = 3. Flooring per building instead gave 0 + 3 = 3: ten
    // buildings earned exactly what none would have.
    const state = stressedState(10, 'production_1');
    const { productionEarned } = collectProduction(state, 'p1');
    expect(productionEarned).toBe(10);
  });

  it('paid nothing for them before, which is the bug — one building still rounds to zero', () => {
    // The fix is about the empire total, not about rounding a single sub-1
    // yield up: one 0.8 building on its own still floors to 0 building income,
    // leaving only the base 1 per 3 territories.
    const state = stressedState(1, 'production_1');
    expect(collectProduction(state, 'p1').productionEarned).toBe(1);
  });

  it('accumulates tech income the same way', () => {
    // 3 x tech_gen_1 (2 TP each) x 0.8 x 0.944 = 4.53 -> 4, plus the base
    // max(1, floor(3/5)) = 1.
    const state = stressedState(3, 'tech_gen_1');
    expect(collectProduction(state, 'p1').techPointsEarned).toBe(5);
  });

  it('is unchanged when nothing is stressed', () => {
    const state = makeState({
      settings: { economy_enabled: true, tech_trees_enabled: true, stability_enabled: false },
      players: [makePlayer('p1', { special_resource: 0 })],
      territories: { t0: makeTerritory('t0', 'p1', ['production_2']) },
    });
    // production_2 yields 2, plus the base 1 per 3 territories (min 1).
    expect(collectProduction(state, 'p1').productionEarned).toBe(3);
  });
});

/**
 * Validation errors are player-facing. They used to be built from a local
 * switch that had drifted from the UI's names (this file said "Arsenal" where
 * the Bonuses modal said "War Factory"), and the prerequisite error printed raw
 * ids — so a rejected build named buildings the player could not find anywhere.
 * Both now resolve through @borderfall/shared's BUILDING_DISPLAY.
 */
describe('validateBuild — player-facing names', () => {
  const state = () => makeState({
    settings: { economy_enabled: true },
    players: [makePlayer('p1', { special_resource: 100 })],
    territories: { t1: makeTerritory('t1', 'p1', []) },
  });

  it('names the prerequisite and the target, not their ids', () => {
    const res = validateBuild(state(), 'p1', 't1', 'production_2');
    expect(res.valid).toBe(false);
    expect(res.error).toBe('Must build a Workshop before a Foundry');
    expect(res.error).not.toMatch(/production_[12]/);
  });

  it('names an already-built tier the way the build panel does', () => {
    const s = makeState({
      settings: { economy_enabled: true },
      players: [makePlayer('p1', { special_resource: 100 })],
      territories: { t1: makeTerritory('t1', 'p1', ['production_1', 'production_2']) },
    });
    expect(validateBuild(s, 'p1', 't1', 'production_2').error).toBe('Territory already has a Foundry');
  });
});
