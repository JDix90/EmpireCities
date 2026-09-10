import { describe, it, expect } from 'vitest';
import type { GameState } from '../../types';
import type { TechNode } from './types';
import { GALAXY_AGE_FACTIONS } from './galaxyage';
import { getEffectiveTechCost, validateResearch } from '../state/techManager';

/**
 * Galaxy faction tempo guards.
 *
 * History, because the shape of this file changed twice: the Stellar Mandate
 * originally had no working passive (~13% win rate), was given a -2 research
 * discount, cut to -1 under corridors (the -2 compounded into 47% once gateway
 * fights were decided by dice), and then had it REMOVED entirely after Lane
 * Sovereignty and the Jump Gates landed — measured on the deterministic harness
 * at 400 games x 3 seeds, -1 was still worth about ten points of win rate on a
 * seat already worth ~24% (Sol 34.6% with it, 24.3% without). No galaxy faction
 * discounts research now, and this file guards that: a discount here is the one
 * lever the era has repeatedly proved it cannot afford.
 */

function galaxyState(factionId: string, overrides?: { factions?: boolean }): GameState {
  return {
    era: 'galaxy_age',
    settings: {
      factions_enabled: overrides?.factions ?? true,
      tech_trees_enabled: true,
    },
    players: [
      {
        player_id: 'p1',
        faction_id: factionId,
        unlocked_techs: [],
        tech_points: 5,
      },
    ],
  } as unknown as GameState;
}

const node = (cost: number): TechNode => ({ tech_id: 't', name: 't', description: '', tier: 1, cost });

describe('no galaxy faction discounts research', () => {
  it('every faction pays the list price', () => {
    for (const f of GALAXY_AGE_FACTIONS) {
      expect(f.tech_cost_discount ?? 0, `${f.faction_id} carries a research discount`).toBe(0);
      const state = galaxyState(f.faction_id);
      expect(getEffectiveTechCost(state, state.players[0], node(5))).toBe(5);
    }
  });

  it('the Mandate needs the full 5 tech points for Lane Charts', () => {
    const state = galaxyState('stellar_mandate');
    expect(validateResearch(state, 'p1', 'ga_hyperspace_chart').valid).toBe(true);
    state.players[0].tech_points = 4;
    expect(validateResearch(state, 'p1', 'ga_hyperspace_chart').valid).toBe(false);
  });
});

describe('galaxy faction sustained perks', () => {
  it('every galaxy faction carries one', () => {
    // Sol: the Cradle world rule (deploy cap + population growth, in the map's
    // `worlds[].rules`) · Rust: +2 reinforce and half-price Jump Gates · Verdan:
    // gateway visibility + Drift Jump · Nexus: lane defence, stability, the Vault.
    for (const f of GALAXY_AGE_FACTIONS) {
      const hasPerk =
        (f.reinforce_bonus ?? 0) > 0 ||
        (f.stability_recovery_bonus ?? 0) > 0 ||
        (f.lane_defense_bonus ?? 0) > 0 ||
        (f.jump_gate_cost_mult ?? 1) < 1 ||
        f.faction_id === 'helion_navigators' ||
        f.faction_id === 'stellar_mandate';
      expect(hasPerk, `${f.faction_id} has no sustained perk`).toBe(true);
    }
  });

  it('only the Forge Syndicate builds Jump Gates at a discount', () => {
    for (const f of GALAXY_AGE_FACTIONS) {
      expect(f.jump_gate_cost_mult ?? 1).toBe(f.faction_id === 'forge_syndicate' ? 0.5 : 1);
    }
  });
});
