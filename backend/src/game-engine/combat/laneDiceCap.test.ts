/**
 * Galactic Age corridors — the lane dice cap.
 *
 * Under corridors a hyperspace-lane crossing rolls at most 2 attacker dice (3
 * with Lane Charts), the structural cap sea lanes already carry, so a defended
 * gateway holds like a coast. Same-world attacks are untouched, and the kill
 * switch restores the classic 3 dice.
 */
import { describe, it, expect } from 'vitest';
import type { GameState, MapConnection } from '../../types';
import { computeLandCombatModifiers } from './combatModifiers';

const ORBIT: MapConnection = { from: 'sol_a', to: 'verdan_a', type: 'orbit' };
const LAND: MapConnection = { from: 'sol_a', to: 'sol_b', type: 'land' };

function mkState(opts: { corridors?: boolean; techs?: string[]; factions?: boolean; anchor?: boolean } = {}): GameState {
  return {
    era: 'galaxy_age',
    settings: {
      galaxy_corridors_enabled: opts.corridors ?? true,
      tech_trees_enabled: true,
      factions_enabled: opts.factions ?? false,
      economy_enabled: false,
      events_enabled: false,
    },
    players: [
      { player_id: 'p1', unlocked_techs: opts.techs ?? [] },
      { player_id: 'p2', unlocked_techs: [] },
    ],
    territories: {
      sol_a: {
        territory_id: 'sol_a', owner_id: 'p1', unit_count: 10, world_id: 'sol',
        buildings: opts.anchor ? ['wonder_hyperlane_anchor'] : [],
      },
      sol_b: { territory_id: 'sol_b', owner_id: 'p2', unit_count: 4, world_id: 'sol' },
      verdan_a: { territory_id: 'verdan_a', owner_id: 'p2', unit_count: 4, world_id: 'verdan' },
    },
  } as unknown as GameState;
}

function attackerDice(state: GameState, connection: MapConnection): number | undefined {
  return computeLandCombatModifiers({
    state,
    fromId: connection.from,
    toId: connection.to,
    attackerId: 'p1',
    defenderId: 'p2',
    attackingUnits: 10,
    defendingUnits: 4,
    connection,
  }).finalAttackerDiceOverride;
}

describe('lane dice cap', () => {
  it('caps a lane crossing at 2 attacker dice', () => {
    expect(attackerDice(mkState(), ORBIT)).toBe(2);
  });

  it('gives the third die back with Lane Charts', () => {
    expect(attackerDice(mkState({ techs: ['ga_hyperspace_chart'] }), ORBIT)).toBe(3);
  });

  it('stacks later attack-dice techs on top of the cap', () => {
    // Hyperdrive Doctrine is +1 on all attacks: 2 (cap) + 1.
    expect(attackerDice(mkState({ techs: ['ga_hyperdrive_doctrine'] }), ORBIT)).toBe(3);
    expect(attackerDice(mkState({ techs: ['ga_hyperspace_chart', 'ga_hyperdrive_doctrine'] }), ORBIT)).toBe(4);
  });

  it('lifts the cap entirely for the Hyperlane Anchor owner', () => {
    // The wonder used to skip the Chart gate; with no gate it removes the lane
    // penalty instead, so the resolver falls back to the classic dice.
    expect(attackerDice(mkState({ anchor: true }), ORBIT)).toBeUndefined();
    // Classic 3 + Hyperdrive Doctrine's +1, exactly as on the ground.
    expect(attackerDice(mkState({ anchor: true, techs: ['ga_hyperdrive_doctrine'] }), ORBIT)).toBe(4);
  });

  it('never caps a same-world attack', () => {
    // No override at all: the resolver falls back to the classic min(units-1, 3).
    expect(attackerDice(mkState(), LAND)).toBeUndefined();
  });

  it('is off with the kill switch', () => {
    expect(attackerDice(mkState({ corridors: false }), ORBIT)).toBeUndefined();
  });
});
