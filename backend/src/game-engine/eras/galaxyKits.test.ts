/**
 * Galactic Age faction kits, rebuilt around lanes (corridors).
 *
 *   Stellar Mandate  — the Cradle world rule; Blockade Runner: next lane crossing
 *                      ignores a seal. No research discount (see
 *                      galaxyFactionBalance.test.ts for why it was removed).
 *   Forge Syndicate  — +2 reinforcement, half-price Jump Gates; Supply Insert
 *                      (shared guerrilla_warfare def).
 *   Helion Navigators — gateways visible under fog; Drift Jump (fortify handler).
 *   Void Custodians  — +1 defence die against attacks across a lane; Emergency Seal.
 */
import { describe, it, expect } from 'vitest';
import type { GameState, MapConnection } from '../../types';
import { GALAXY_AGE_FACTIONS } from './galaxyage';
import { computeLandCombatModifiers } from '../combat/combatModifiers';
import { executeTechAbility } from '../abilities/executeTechAbility';
import { TERRITORY_ABILITY_DEFS, consumeBlockadeRunner } from '../abilities/techAbilities';

const byId = (id: string) => GALAXY_AGE_FACTIONS.find((f) => f.faction_id === id)!;

describe('kit shape', () => {
  it('every faction carries a lane-native kit', () => {
    expect(byId('stellar_mandate').tech_cost_discount ?? 0).toBe(0);
    expect(byId('stellar_mandate').ability_id).toBe('blockade_runner');
    expect(byId('forge_syndicate').reinforce_bonus).toBe(2);
    expect(byId('forge_syndicate').jump_gate_cost_mult).toBe(0.5);
    expect(byId('forge_syndicate').ability_id).toBe('guerrilla_warfare');
    expect(byId('helion_navigators').ability_id).toBe('drift_jump');
    expect(byId('void_custodians').lane_defense_bonus).toBe(1);
    expect(byId('void_custodians').ability_id).toBe('emergency_seal');
    expect(TERRITORY_ABILITY_DEFS.blockade_runner?.selfBuff).toBe('ignore_lane_seal');
  });
});

const ORBIT: MapConnection = { from: 'sol_a', to: 'nexus_a', type: 'orbit' };
const LAND: MapConnection = { from: 'nexus_b', to: 'nexus_a', type: 'land' };

function state(defenderFaction: string): GameState {
  return {
    era: 'galaxy_age',
    settings: { galaxy_corridors_enabled: true, tech_trees_enabled: true, factions_enabled: true, economy_enabled: false, events_enabled: false },
    players: [
      { player_id: 'p1', faction_id: 'stellar_mandate', unlocked_techs: [] },
      { player_id: 'p4', faction_id: defenderFaction, unlocked_techs: [] },
    ],
    territories: {
      sol_a: { territory_id: 'sol_a', owner_id: 'p1', unit_count: 10, world_id: 'sol' },
      nexus_a: { territory_id: 'nexus_a', owner_id: 'p4', unit_count: 4, world_id: 'nexus_station' },
      nexus_b: { territory_id: 'nexus_b', owner_id: 'p1', unit_count: 10, world_id: 'nexus_station' },
    },
  } as unknown as GameState;
}

function defenderDice(s: GameState, connection: MapConnection): number | undefined {
  return computeLandCombatModifiers({
    state: s, fromId: connection.from, toId: connection.to, attackerId: 'p1', defenderId: 'p4',
    attackingUnits: 10, defendingUnits: 4, connection,
  }).defenderDiceOverride;
}

describe('Void Custodians lane defence', () => {
  it('rolls an extra die against an attack across a lane', () => {
    expect(defenderDice(state('void_custodians'), ORBIT)).toBe(3);
  });
  it('does not fire on a same-world attack, nor for other factions', () => {
    expect(defenderDice(state('void_custodians'), LAND)).toBeUndefined();
    expect(defenderDice(state('forge_syndicate'), ORBIT)).toBeUndefined();
  });
});

describe('Blockade Runner', () => {
  it('arms a one-shot seal pass, consumed by the next sealed crossing', () => {
    const s = state('void_custodians');
    s.phase = 'attack';
    const r = executeTechAbility({ state: s, map: { territories: [], connections: [ORBIT] } as never, playerId: 'p1', abilityId: 'blockade_runner' });
    expect(r.success).toBe(true);
    const mandate = s.players[0];
    expect(mandate.pending_ignore_lane_seal).toBe(true);
    expect(consumeBlockadeRunner(mandate)).toBe(true);
    expect(mandate.pending_ignore_lane_seal).toBeUndefined();
    expect(consumeBlockadeRunner(mandate)).toBe(false);
  });
});
