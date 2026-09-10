/**
 * Galactic Age repairs — regression cover for defects measured on the real map.
 *
 * Each case here failed before the repair commit:
 *   • Cyber Strike removed a unit across a hyperspace lane with no Hyperspace
 *     Chart researched (the strike checked adjacency, never the orbit gate).
 *   • Forge Syndicate's Supply Insert had no TERRITORY_ABILITY_DEFS entry, so
 *     the shared executor answered "not implemented" and the AI parity path,
 *     which reads that table, could never fire it.
 *   • Helion Navigators' advertised active (`orbital_recon`) had no handler in
 *     any era; the faction's one advertised ability did nothing at all.
 *   • A fully held Nexus Station paid ZERO tech points: 16 × 0.05 floors to 0.
 *     (That yield is now the Vault — see state/worldRules.test.ts.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap, GameSettings, GameState } from '../../types';
import { GALAXY_AGE_FACTIONS } from './galaxyage';
import { initializeGameState } from '../state/gameStateManager';
import { executeTechAbility } from '../abilities/executeTechAbility';
import {
  TERRITORY_ABILITY_DEFS,
  expandFogVisibilityFromFactionPassive,
} from '../abilities/techAbilities';

const AUTHORED = JSON.parse(
  readFileSync(join(__dirname, '../../../../database/maps/era_galaxy.json'), 'utf-8'),
) as GameMap;

/** An authored sol↔verdan lane: both ends, on different worlds. */
const LANE = { sol: 'sol_guinea', verdan: 'verdan_chlorophage_span' };

const FACTIONS = ['stellar_mandate', 'forge_syndicate', 'helion_navigators', 'void_custodians'] as const;
const SEAT = ['p_sol', 'p_rust', 'p_verdan', 'p_nexus'] as const;

function settings(overrides: Partial<GameSettings> = {}): GameSettings {
  return {
    fog_of_war: false, turn_timer_seconds: 0, initial_unit_count: 3, card_set_escalating: false,
    diplomacy_enabled: false, factions_enabled: true, naval_enabled: false, events_enabled: false,
    economy_enabled: true, tech_trees_enabled: true, stability_enabled: false,
    era_advancement_enabled: false,
    allowed_victory_conditions: ['domination'], victory_type: 'domination', max_turns: 90,
    ...overrides,
  } as unknown as GameSettings;
}

function freshGalaxyState(overrides: Partial<GameSettings> = {}): GameState {
  const map = JSON.parse(JSON.stringify(AUTHORED)) as GameMap;
  const players = SEAT.map((id, i) => ({
    player_id: id, player_index: i, username: id, color: '#fff',
    is_ai: false, is_eliminated: false, mmr: 1000, faction_id: FACTIONS[i],
  }));
  return initializeGameState('t_galaxy', 'galaxy_age', map, players as never, settings(overrides), {
    forceStartingPlayerIndex: 0,
  });
}

function freshMap(): GameMap {
  return JSON.parse(JSON.stringify(AUTHORED)) as GameMap;
}

/** Adjacency in the shape buildClientState hands the fog helpers. */
function adjacencyOf(map: GameMap): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  const push = (a: string, b: string) => adj.set(a, [...(adj.get(a) ?? []), b]);
  for (const c of map.connections) { push(c.from, c.to); push(c.to, c.from); }
  return adj;
}

describe('Cyber Strike respects the hyperspace gate', () => {
  it('refuses a strike across an orbit lane when the attacker has no lane access', () => {
    const state = freshGalaxyState();
    const map = freshMap();
    state.phase = 'attack';
    // Sol holds its end of the lane; Verdan holds the far end. No Chart.
    expect(state.territories[LANE.sol].owner_id).toBe(SEAT[0]);
    expect(state.territories[LANE.verdan].owner_id).toBe(SEAT[2]);
    const before = state.territories[LANE.verdan].unit_count;

    const result = executeTechAbility({
      state, map, playerId: SEAT[0], abilityId: 'cyber_attack', territoryId: LANE.verdan,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/out of range/i);
    expect(state.territories[LANE.verdan].unit_count).toBe(before);
  });

  it('allows the same strike once Hyperspace Chart is researched', () => {
    const state = freshGalaxyState();
    const map = freshMap();
    state.phase = 'attack';
    state.players[0].unlocked_techs = ['ga_hyperspace_chart'];
    const before = state.territories[LANE.verdan].unit_count;

    const result = executeTechAbility({
      state, map, playerId: SEAT[0], abilityId: 'cyber_attack', territoryId: LANE.verdan,
    });

    expect(result.success).toBe(true);
    expect(state.territories[LANE.verdan].unit_count).toBe(before - 1);
  });

  it('leaves same-world strikes alone (no lane crossed, no gate consulted)', () => {
    const state = freshGalaxyState();
    const map = freshMap();
    state.phase = 'attack';
    // Hand Sol's neighbour tile to a rival so it is a legal strike target.
    const neighbourId = map.connections.find(
      (c) => c.type !== 'orbit' && (c.from === LANE.sol || c.to === LANE.sol),
    )!;
    const targetId = neighbourId.from === LANE.sol ? neighbourId.to : neighbourId.from;
    state.territories[targetId].owner_id = SEAT[1];
    state.territories[targetId].unit_count = 4;

    const result = executeTechAbility({
      state, map, playerId: SEAT[0], abilityId: 'cyber_attack', territoryId: targetId,
    });

    expect(result.success).toBe(true);
    expect(state.territories[targetId].unit_count).toBe(3);
  });
});

describe("Forge Syndicate's Supply Insert", () => {
  it('is defined in the shared ability table, so human and AI paths share it', () => {
    const forge = GALAXY_AGE_FACTIONS.find((f) => f.faction_id === 'forge_syndicate')!;
    expect(forge.ability_id).toBe('guerrilla_warfare');
    expect(TERRITORY_ABILITY_DEFS[forge.ability_id!]).toBeDefined();
    expect(TERRITORY_ABILITY_DEFS[forge.ability_id!].ownPlacement?.units).toBe(1);
  });

  it('places a free unit on an owned territory through the shared executor', () => {
    const state = freshGalaxyState();
    const map = freshMap();
    state.phase = 'draft';
    const owned = Object.values(state.territories).find((t) => t.owner_id === SEAT[1])!;
    const before = owned.unit_count;

    const result = executeTechAbility({
      state, map, playerId: SEAT[1], abilityId: 'guerrilla_warfare', territoryId: owned.territory_id,
    });

    expect(result.success).toBe(true);
    expect(state.territories[owned.territory_id].unit_count).toBe(before + 1);
  });
});

describe("Helion Navigators' Long-Range Sensors", () => {
  it('is a passive; the dead orbital_recon active is gone', () => {
    const helion = GALAXY_AGE_FACTIONS.find((f) => f.faction_id === 'helion_navigators')!;
    expect(helion.ability_id).not.toBe('orbital_recon');
    expect(helion.description).toMatch(/gateway/i);
  });

  it('reveals both ends of every lane under fog, and nothing else', () => {
    const state = freshGalaxyState({ fog_of_war: true });
    const map = freshMap();
    const adjacency = adjacencyOf(map);
    const visible = new Set<string>();

    expandFogVisibilityFromFactionPassive(state, SEAT[2], visible, adjacency);

    const gateways = new Set<string>();
    for (const c of map.connections) {
      if (c.type !== 'orbit') continue;
      gateways.add(c.from);
      gateways.add(c.to);
    }
    expect(gateways.size).toBe(16);
    expect([...visible].sort()).toEqual([...gateways].sort());
  });

  it('reveals nothing for the other factions, or when factions are off', () => {
    const map = freshMap();
    const adjacency = adjacencyOf(map);

    const mandateView = new Set<string>();
    expandFogVisibilityFromFactionPassive(freshGalaxyState({ fog_of_war: true }), SEAT[0], mandateView, adjacency);
    expect(mandateView.size).toBe(0);

    const factionsOff = new Set<string>();
    const state = freshGalaxyState({ fog_of_war: true, factions_enabled: false });
    expandFogVisibilityFromFactionPassive(state, SEAT[2], factionsOff, adjacency);
    expect(factionsOff.size).toBe(0);
  });
});

describe('Void Custodians kit', () => {
  it('carries no flat reinforcement bonus — the trade that paid for the Vault', () => {
    const custodians = GALAXY_AGE_FACTIONS.find((f) => f.faction_id === 'void_custodians')!;
    expect(custodians.reinforce_bonus).toBeUndefined();
    expect(custodians.description).toMatch(/Vault/);
  });
});
