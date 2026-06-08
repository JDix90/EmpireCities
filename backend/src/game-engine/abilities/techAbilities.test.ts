import { describe, it, expect } from 'vitest';
import type { GameState } from '../../types';
import {
  getFortifyMoveLimit,
  getInfluenceUnitCost,
  getPrecisionStrikeMinUnits,
  getUnlockedAbilityIds,
  playerHasUnlockedAbility,
  attackerIgnoresDefenseBuilding,
  expandFogVisibilityFromRecon,
} from './techAbilities';

function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    game_id: 'g1',
    era: 'coldwar',
    map_id: 'era_coldwar',
    phase: 'attack',
    turn_number: 1,
    current_player_index: 0,
    players: [{
      player_id: 'p1',
      player_index: 0,
      username: 'Test',
      color: '#fff',
      is_ai: false,
      is_eliminated: false,
      territory_count: 5,
      cards: [],
      mmr: 1000,
      capital_territory_id: null,
      secret_mission: null,
      unlocked_techs: [],
      tech_points: 0,
    }],
    territories: {},
    settings: {
      fog_of_war: false,
      turn_timer_seconds: 0,
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: false,
      tech_trees_enabled: true,
      factions_enabled: false,
      economy_enabled: true,
      events_enabled: false,
      naval_enabled: false,
      stability_enabled: false,
    },
    ...overrides,
  } as GameState;
}

describe('techAbilities', () => {
  it('detects nuclear_strike when cw_icbm is researched', () => {
    const state = baseState();
    state.players[0]!.unlocked_techs = ['cw_icbm'];
    expect(playerHasUnlockedAbility(state, 'p1', 'nuclear_strike')).toBe(true);
  });

  it('proxy_funding reduces influence cost to 2', () => {
    const state = baseState();
    state.players[0]!.unlocked_techs = ['cw_proxy_wars'];
    expect(getInfluenceUnitCost(state, 'p1')).toBe(2);
  });

  it('defaults influence cost to 3 without proxy_funding', () => {
    const state = baseState();
    expect(getInfluenceUnitCost(state, 'p1')).toBe(3);
  });

  it('motorized_logistics raises fortify limit to 3 in WW2', () => {
    const state = baseState({ era: 'ww2', era_modifiers: { wartime_logistics: true } });
    state.players[0]!.unlocked_techs = ['ww2_motorization'];
    expect(getFortifyMoveLimit(state, 'p1')).toBe(3);
  });

  it('special_ops lowers precision strike threshold to 2 units', () => {
    const state = baseState({ era: 'modern', era_modifiers: { precision_strike: true } });
    state.players[0]!.unlocked_techs = ['mod_special_forces'];
    expect(getPrecisionStrikeMinUnits(state, 'p1')).toBe(2);
  });

  it('siege_attack ignores defense buildings passively', () => {
    const state = baseState({ era: 'ancient' });
    state.players[0]!.unlocked_techs = ['ancient_siege_engines'];
    expect(attackerIgnoresDefenseBuilding(state, 'p1')).toBe(true);
  });

  it('siege_assault does not passively ignore defense buildings', () => {
    const state = baseState({ era: 'medieval' });
    state.players[0]!.unlocked_techs = ['medieval_siege_warfare'];
    expect(attackerIgnoresDefenseBuilding(state, 'p1')).toBe(false);
  });

  it('cannon_barrage passively ignores defense buildings when gunpowder is unlocked', () => {
    const state = baseState({ era: 'medieval' });
    state.players[0]!.unlocked_techs = ['medieval_gunpowder'];
    expect(attackerIgnoresDefenseBuilding(state, 'p1')).toBe(true);
  });

  it('returns empty ability set when tech trees disabled', () => {
    const state = baseState();
    state.settings.tech_trees_enabled = false;
    state.players[0]!.unlocked_techs = ['cw_icbm'];
    expect(getUnlockedAbilityIds(state, state.players[0]!).size).toBe(0);
  });
});

describe('passive recon fog reveal', () => {
  // o1 (owned) — e1 (1 hop) — e2 (2 hops) — e3 (3 hops)
  function reconState(era: GameState['era'], techs: string[]): GameState {
    const state = baseState({ era });
    state.players[0]!.unlocked_techs = techs;
    state.territories = {
      o1: { territory_id: 'o1', owner_id: 'p1', unit_count: 3, buildings: [], naval_units: 0 },
      e1: { territory_id: 'e1', owner_id: 'p2', unit_count: 2, buildings: [], naval_units: 0 },
      e2: { territory_id: 'e2', owner_id: 'p2', unit_count: 2, buildings: [], naval_units: 0 },
      e3: { territory_id: 'e3', owner_id: 'p2', unit_count: 2, buildings: [], naval_units: 0 },
    };
    return state;
  }

  const adjacency = new Map<string, string[]>([
    ['o1', ['e1']],
    ['e1', ['o1', 'e2']],
    ['e2', ['e1', 'e3']],
    ['e3', ['e2']],
  ]);

  it('drone_recon reveals enemy territories within 2 hops but not 3', () => {
    const state = reconState('modern', ['mod_drones']);
    const visible = new Set<string>(['o1']);
    expandFogVisibilityFromRecon(state, 'p1', visible, adjacency);
    expect(visible.has('e1')).toBe(true);
    expect(visible.has('e2')).toBe(true);
    expect(visible.has('e3')).toBe(false);
  });

  it('orbital_recon reveals enemy territories within 2 hops', () => {
    const state = reconState('space_age', ['sa_orbital_recon']);
    const visible = new Set<string>(['o1']);
    expandFogVisibilityFromRecon(state, 'p1', visible, adjacency);
    expect(visible.has('e1')).toBe(true);
    expect(visible.has('e2')).toBe(true);
  });

  it('does not reveal anything when tech trees are disabled', () => {
    const state = reconState('modern', ['mod_drones']);
    state.settings.tech_trees_enabled = false;
    const visible = new Set<string>(['o1']);
    expandFogVisibilityFromRecon(state, 'p1', visible, adjacency);
    expect(visible.has('e1')).toBe(false);
    expect(visible.has('e2')).toBe(false);
  });
});
