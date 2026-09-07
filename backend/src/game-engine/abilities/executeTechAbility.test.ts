import { describe, it, expect } from 'vitest';
import type { GameState } from '../../types';
import { executeTechAbility } from './executeTechAbility';

function baseState(): GameState {
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
      territory_count: 2,
      cards: [],
      mmr: 1000,
      capital_territory_id: null,
      secret_mission: null,
      unlocked_techs: ['cw_icbm'],
    }],
    territories: {
      t1: { territory_id: 't1', owner_id: 'p1', unit_count: 5, buildings: [], naval_units: 0 },
      t2: { territory_id: 't2', owner_id: 'p2', unit_count: 4, buildings: [], naval_units: 0 },
    },
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
  } as GameState;
}

const map = {
  map_id: 'era_coldwar',
  name: 'Cold War',
  territories: [],
  connections: [{ from: 't1', to: 't2', type: 'land' as const }],
  regions: [],
};

describe('executeTechAbility', () => {
  it('nuclear_strike reduces enemy units by 2', () => {
    const state = baseState();
    const result = executeTechAbility({
      state,
      map,
      playerId: 'p1',
      abilityId: 'nuclear_strike',
      territoryId: 't2',
    });
    expect(result.success).toBe(true);
    expect(state.territories.t2!.unit_count).toBe(2);
  });

  it('rejects nuclear_strike on own territory', () => {
    const state = baseState();
    const result = executeTechAbility({
      state,
      map,
      playerId: 'p1',
      abilityId: 'nuclear_strike',
      territoryId: 't1',
    });
    expect(result.success).toBe(false);
  });

  it('air_strike sets pending pre-attack damage', () => {
    const state = baseState();
    state.players[0]!.unlocked_techs = ['ww2_air_support'];
    const result = executeTechAbility({
      state,
      map,
      playerId: 'p1',
      abilityId: 'air_strike',
    });
    expect(result.success).toBe(true);
    expect(state.players[0]!.pending_pre_attack_damage).toBe(1);
  });

  it('mass_mobilization places 5 units on an owned territory and consumes the once-per-game use', () => {
    const state = baseState();
    state.phase = 'draft';
    const result = executeTechAbility({
      state,
      map,
      playerId: 'p1',
      abilityId: 'mass_mobilization',
      territoryId: 't1',
    });
    expect(result.success).toBe(true);
    expect(state.territories.t1!.unit_count).toBe(10);
    expect(state.players[0]!.used_game_abilities).toContain('mass_mobilization');
  });

  it('rejects mass_mobilization on an enemy territory', () => {
    const state = baseState();
    state.phase = 'draft';
    const result = executeTechAbility({
      state,
      map,
      playerId: 'p1',
      abilityId: 'mass_mobilization',
      territoryId: 't2',
    });
    expect(result.success).toBe(false);
    expect(state.territories.t2!.unit_count).toBe(4);
  });

  it('rejects mass_mobilization outside the draft phase', () => {
    const state = baseState();
    state.phase = 'attack';
    const result = executeTechAbility({
      state,
      map,
      playerId: 'p1',
      abilityId: 'mass_mobilization',
      territoryId: 't1',
    });
    expect(result.success).toBe(false);
    expect(state.territories.t1!.unit_count).toBe(5);
  });

  it('marshall_plan places 1 free unit on an owned territory (draft)', () => {
    const state = baseState();
    state.phase = 'draft';
    const result = executeTechAbility({ state, map, playerId: 'p1', abilityId: 'marshall_plan', territoryId: 't1' });
    expect(result.success).toBe(true);
    expect(state.territories.t1!.unit_count).toBe(6);
  });

  it('guerrilla_resistance places 2 free units on an owned territory', () => {
    const state = baseState();
    state.phase = 'draft';
    const result = executeTechAbility({ state, map, playerId: 'p1', abilityId: 'guerrilla_resistance', territoryId: 't1' });
    expect(result.success).toBe(true);
    expect(state.territories.t1!.unit_count).toBe(7);
  });

  it('rejects a free-unit placement on an enemy territory', () => {
    const state = baseState();
    state.phase = 'draft';
    const result = executeTechAbility({ state, map, playerId: 'p1', abilityId: 'marshall_plan', territoryId: 't2' });
    expect(result.success).toBe(false);
    expect(state.territories.t2!.unit_count).toBe(4);
  });

  it('terraform places 1 unit and restores stability to full', () => {
    const state = baseState();
    state.phase = 'draft';
    state.territories.t1!.stability = 20;
    const result = executeTechAbility({ state, map, playerId: 'p1', abilityId: 'terraform', territoryId: 't1' });
    expect(result.success).toBe(true);
    expect(state.territories.t1!.unit_count).toBe(6);
    expect(state.territories.t1!.stability).toBe(100);
  });

  it('lunar_supply_drop requires an owned Moon territory', () => {
    const state = baseState();
    state.phase = 'draft';
    // t1 is not flagged as a Moon territory → rejected
    const rejected = executeTechAbility({ state, map, playerId: 'p1', abilityId: 'lunar_supply_drop', territoryId: 't1' });
    expect(rejected.success).toBe(false);
    state.territories.t1!.world_id = 'moon';
    const allowed = executeTechAbility({ state, map, playerId: 'p1', abilityId: 'lunar_supply_drop', territoryId: 't1' });
    expect(allowed.success).toBe(true);
    expect(state.territories.t1!.unit_count).toBe(7);
  });

  // ── Group B: tech-point-gated placement ─────────────────────────────────────
  it('arsenal_of_democracy spends 5 tech points to place 3 units', () => {
    const state = baseState();
    state.phase = 'draft';
    state.players[0]!.tech_points = 8;
    const result = executeTechAbility({ state, map, playerId: 'p1', abilityId: 'arsenal_of_democracy', territoryId: 't1' });
    expect(result.success).toBe(true);
    expect(state.players[0]!.tech_points).toBe(3);
    expect(state.territories.t1!.unit_count).toBe(8);
  });

  it('rejects arsenal_of_democracy when tech points are insufficient', () => {
    const state = baseState();
    state.phase = 'draft';
    state.players[0]!.tech_points = 2;
    const result = executeTechAbility({ state, map, playerId: 'p1', abilityId: 'arsenal_of_democracy', territoryId: 't1' });
    expect(result.success).toBe(false);
    expect(state.players[0]!.tech_points).toBe(2);
    expect(state.territories.t1!.unit_count).toBe(5);
  });

  it('mercenary_contract requires a production building on the target', () => {
    const state = baseState();
    state.phase = 'draft';
    state.players[0]!.tech_points = 10;
    const rejected = executeTechAbility({ state, map, playerId: 'p1', abilityId: 'mercenary_contract', territoryId: 't1' });
    expect(rejected.success).toBe(false);
    state.territories.t1!.buildings = ['production_1'];
    const allowed = executeTechAbility({ state, map, playerId: 'p1', abilityId: 'mercenary_contract', territoryId: 't1' });
    expect(allowed.success).toBe(true);
    expect(state.territories.t1!.unit_count).toBe(9);
  });

  it('spice_trade spends tech points to add draft reinforcements', () => {
    const state = baseState();
    state.phase = 'draft';
    state.draft_units_remaining = 2;
    state.players[0]!.tech_points = 6;
    const result = executeTechAbility({ state, map, playerId: 'p1', abilityId: 'spice_trade' });
    expect(result.success).toBe(true);
    expect(state.players[0]!.tech_points).toBe(1);
    expect(state.draft_units_remaining).toBe(4);
  });

  // ── Group C: reinforcement / economy boosts ─────────────────────────────────
  it('total_war adds 6 draft reinforcements once per game', () => {
    const state = baseState();
    state.phase = 'draft';
    state.draft_units_remaining = 3;
    const result = executeTechAbility({ state, map, playerId: 'p1', abilityId: 'total_war' });
    expect(result.success).toBe(true);
    expect(state.draft_units_remaining).toBe(9);
    expect(state.players[0]!.used_game_abilities).toContain('total_war');
  });

  it('imperial_diet rewards fully-owned regions and rejects when none', () => {
    const state = baseState();
    state.phase = 'draft';
    state.draft_units_remaining = 0;
    // t1 owned, t2 enemy: region "north" is fully owned, "south" is not.
    state.territories.t1!.region_id = 'north';
    state.territories.t2!.region_id = 'south';
    const ok = executeTechAbility({ state, map, playerId: 'p1', abilityId: 'imperial_diet' });
    expect(ok.success).toBe(true);
    expect(state.draft_units_remaining).toBe(1);
    // No fully-owned region → rejected, no use consumed.
    const state2 = baseState();
    state2.phase = 'draft';
    state2.draft_units_remaining = 0;
    state2.territories.t1!.region_id = 'shared';
    state2.territories.t2!.region_id = 'shared';
    const rejected = executeTechAbility({ state: state2, map, playerId: 'p1', abilityId: 'imperial_diet' });
    expect(rejected.success).toBe(false);
    expect(state2.draft_units_remaining).toBe(0);
  });

  it('silk_road grants 3 tech points', () => {
    const state = baseState();
    state.phase = 'draft';
    state.players[0]!.tech_points = 2;
    const result = executeTechAbility({ state, map, playerId: 'p1', abilityId: 'silk_road' });
    expect(result.success).toBe(true);
    expect(state.players[0]!.tech_points).toBe(5);
  });

  it('house_of_wisdom sets a pending tech discount', () => {
    const state = baseState();
    state.phase = 'draft';
    const result = executeTechAbility({ state, map, playerId: 'p1', abilityId: 'house_of_wisdom' });
    expect(result.success).toBe(true);
    expect(state.players[0]!.pending_tech_discount).toBe(3);
  });

  // ── Group D: attack self-buffs ──────────────────────────────────────────────
  it('war_elephants arms an extra attack die', () => {
    const state = baseState();
    const result = executeTechAbility({ state, map, playerId: 'p1', abilityId: 'war_elephants' });
    expect(result.success).toBe(true);
    expect(state.players[0]!.pending_extra_attack_die).toBe(true);
  });

  it('testudo arms negate-attacker-losses for the next attack', () => {
    const state = baseState();
    const result = executeTechAbility({ state, map, playerId: 'p1', abilityId: 'testudo' });
    expect(result.success).toBe(true);
    expect(state.players[0]!.pending_negate_attacker_losses).toBe(true);
  });

  it('siege_assault arms ignore-defense-building for the next attack', () => {
    const state = baseState();
    const result = executeTechAbility({ state, map, playerId: 'p1', abilityId: 'siege_assault' });
    expect(result.success).toBe(true);
    expect(state.players[0]!.pending_ignore_defense_building).toBe(true);
  });

  it('cannon_barrage arms an extra attack die for the next attack', () => {
    const state = baseState();
    const result = executeTechAbility({ state, map, playerId: 'p1', abilityId: 'cannon_barrage' });
    expect(result.success).toBe(true);
    expect(state.players[0]!.pending_extra_attack_die).toBe(true);
  });

  // ── Group E: unit-reduction strikes ─────────────────────────────────────────
  it('precision_airstrike removes 2 units from an adjacent enemy', () => {
    const state = baseState();
    const result = executeTechAbility({ state, map, playerId: 'p1', abilityId: 'precision_airstrike', territoryId: 't2' });
    expect(result.success).toBe(true);
    expect(state.territories.t2!.unit_count).toBe(2);
  });

  it('unification_drive converts an in-range neutral territory for free', () => {
    const state = baseState();
    state.territories.t3 = { territory_id: 't3', owner_id: null, unit_count: 0, buildings: [], naval_units: 0 } as GameState['territories'][string];
    const umap = { ...map, connections: [{ from: 't1', to: 't3', type: 'land' as const }] };
    const result = executeTechAbility({ state, map: umap, playerId: 'p1', abilityId: 'unification_drive', territoryId: 't3' });
    expect(result.success).toBe(true);
    expect(state.territories.t3!.owner_id).toBe('p1');
    expect(state.territories.t3!.unit_count).toBe(1);
  });

  it('unification_drive rejects a non-neutral target', () => {
    const state = baseState();
    const result = executeTechAbility({ state, map, playerId: 'p1', abilityId: 'unification_drive', territoryId: 't2' });
    expect(result.success).toBe(false);
  });

  it('armored_push rejects use during draft phase', () => {
    const state = baseState();
    state.phase = 'draft';
    const result = executeTechAbility({ state, map, playerId: 'p1', abilityId: 'armored_push' });
    expect(result.success).toBe(false);
  });

  it('armored_push grants a bonus fortify move', () => {
    const state = baseState();
    state.phase = 'fortify';
    const result = executeTechAbility({ state, map, playerId: 'p1', abilityId: 'armored_push' });
    expect(result.success).toBe(true);
    expect(state.players[0]!.bonus_fortify_moves).toBe(1);
  });

  it('privateer rejects a non-coastal target and rewards a tech point on a coastal one', () => {
    const state = baseState();
    // t1↔t2 is a land connection → not coastal → rejected
    const rejected = executeTechAbility({ state, map, playerId: 'p1', abilityId: 'privateer', territoryId: 't2' });
    expect(rejected.success).toBe(false);
    const seaMap = { ...map, connections: [{ from: 't1', to: 't2', type: 'sea' as const }] };
    state.players[0]!.tech_points = 0;
    const allowed = executeTechAbility({ state, map: seaMap, playerId: 'p1', abilityId: 'privateer', territoryId: 't2' });
    expect(allowed.success).toBe(true);
    expect(state.territories.t2!.unit_count).toBe(3);
    expect(state.players[0]!.tech_points).toBe(1);
  });
});

describe('satellite_uplink (Terran Federation)', () => {
  function uplinkState(): GameState {
    const state = baseState();
    state.era = 'space_age';
    state.phase = 'draft';
    state.settings.factions_enabled = true;
    state.players[0]!.faction_id = 'terran_federation';
    state.players[0]!.tech_points = 10;
    // t3: owned but only bordering another owned tile (t1) — no enemy contact.
    state.territories.t3 = { territory_id: 't3', owner_id: 'p1', unit_count: 2, buildings: [], naval_units: 0 };
    return state;
  }
  const uplinkMap = { ...map, connections: [...map.connections, { from: 't1', to: 't3', type: 'land' as const }] };

  it('places 2 units on an owned territory bordering an enemy and spends 4 tech points', () => {
    const state = uplinkState();
    const result = executeTechAbility({ state, map: uplinkMap, playerId: 'p1', abilityId: 'satellite_uplink', territoryId: 't1' });
    expect(result.success).toBe(true);
    expect(state.territories.t1!.unit_count).toBe(7);
    expect(state.players[0]!.tech_points).toBe(6);
  });

  it('rejects an owned territory with no enemy neighbour', () => {
    const state = uplinkState();
    const result = executeTechAbility({ state, map: uplinkMap, playerId: 'p1', abilityId: 'satellite_uplink', territoryId: 't3' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Must target an owned territory next to an enemy');
    expect(state.territories.t3!.unit_count).toBe(2);
    expect(state.players[0]!.tech_points).toBe(10);
  });

  it('treats a neutral neighbour as no enemy contact', () => {
    const state = uplinkState();
    state.territories.t2!.owner_id = null;
    const result = executeTechAbility({ state, map: uplinkMap, playerId: 'p1', abilityId: 'satellite_uplink', territoryId: 't1' });
    expect(result.success).toBe(false);
  });

  it('rejects when the player cannot afford the tech cost', () => {
    const state = uplinkState();
    state.players[0]!.tech_points = 3;
    const result = executeTechAbility({ state, map: uplinkMap, playerId: 'p1', abilityId: 'satellite_uplink', territoryId: 't1' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Not enough tech points (need 4)');
    expect(state.territories.t1!.unit_count).toBe(5);
  });
});

describe('solar_surge (Solar Caliphate)', () => {
  function surgeState(economyEnabled: boolean): GameState {
    const state = baseState();
    state.era = 'space_age';
    state.phase = 'draft';
    state.settings.factions_enabled = true;
    state.settings.economy_enabled = economyEnabled;
    state.players[0]!.faction_id = 'solar_caliphate';
    state.players[0]!.special_resource = 5;
    return state;
  }

  it('places 1 unit and grants 2 production when economy is on', () => {
    const state = surgeState(true);
    const result = executeTechAbility({ state, map, playerId: 'p1', abilityId: 'solar_surge', territoryId: 't1' });
    expect(result.success).toBe(true);
    expect(state.territories.t1!.unit_count).toBe(6);
    expect(state.players[0]!.special_resource).toBe(7);
  });

  it('still places the unit but grants no production when economy is off', () => {
    const state = surgeState(false);
    const result = executeTechAbility({ state, map, playerId: 'p1', abilityId: 'solar_surge', territoryId: 't1' });
    expect(result.success).toBe(true);
    expect(state.territories.t1!.unit_count).toBe(6);
    expect(state.players[0]!.special_resource).toBe(5);
  });

  it('rejects a territory the player does not own', () => {
    const state = surgeState(true);
    const result = executeTechAbility({ state, map, playerId: 'p1', abilityId: 'solar_surge', territoryId: 't2' });
    expect(result.success).toBe(false);
    expect(state.players[0]!.special_resource).toBe(5);
  });
});

describe('mercenary_contract tech cost', () => {
  it('costs 6 tech points, matching the published faction copy', () => {
    const state = baseState();
    state.phase = 'draft';
    state.players[0]!.tech_points = 5;
    state.territories.t1!.buildings = ['production_1'];
    const short = executeTechAbility({ state, map, playerId: 'p1', abilityId: 'mercenary_contract', territoryId: 't1' });
    expect(short.success).toBe(false);
    expect(short.error).toBe('Not enough tech points (need 6)');
    state.players[0]!.tech_points = 6;
    const ok = executeTechAbility({ state, map, playerId: 'p1', abilityId: 'mercenary_contract', territoryId: 't1' });
    expect(ok.success).toBe(true);
    expect(state.players[0]!.tech_points).toBe(0);
  });
});
