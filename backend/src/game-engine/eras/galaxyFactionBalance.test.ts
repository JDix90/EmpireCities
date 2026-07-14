import { describe, it, expect } from 'vitest';
import type { GameState } from '../../types';
import type { TechNode } from './types';
import { GALAXY_AGE_FACTIONS } from './galaxyage';
import { getEffectiveTechCost, validateResearch } from '../state/techManager';

/**
 * Galaxy faction tempo guards, from the 2026-07 400-game sim tuning pass under
 * the threshold-60% endgame default: Sol sat at ~13% — its old copy claimed a
 * +1 defense die that was never wired (always-on defensive dice are banned;
 * see factionDefense.test.ts), leaving it the only passive-less faction. Its
 * passive is a RESEARCH DISCOUNT, deliberately not per-turn tech income:
 * +1 TP/turn compounds all game and sim-tested at ~39% (while collapsing
 * Helion to ~17%); the discount is worth ~1 TP per research.
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
        tech_points: 4,
      },
    ],
  } as unknown as GameState;
}

const node = (cost: number): TechNode => ({ tech_id: 't', name: 't', description: '', tier: 1, cost });

describe('Stellar Mandate research discount', () => {
  it('every research costs 2 less', () => {
    const state = galaxyState('stellar_mandate');
    expect(getEffectiveTechCost(state, state.players[0], node(5))).toBe(3);
  });

  it('cost never drops below 1', () => {
    const state = galaxyState('stellar_mandate');
    expect(getEffectiveTechCost(state, state.players[0], node(2))).toBe(1);
  });

  it('does not apply when factions are disabled', () => {
    const state = galaxyState('stellar_mandate', { factions: false });
    expect(getEffectiveTechCost(state, state.players[0], node(5))).toBe(5);
  });

  it('other galaxy factions pay full cost', () => {
    for (const f of ['forge_syndicate', 'helion_navigators', 'void_custodians']) {
      const state = galaxyState(f);
      expect(getEffectiveTechCost(state, state.players[0], node(5))).toBe(5);
    }
  });

  it('lets Sol research the 5-cost Hyperspace Chart with 4 tech points', () => {
    // (Discount is 2; 4 TP comfortably covers the effective cost of 3.)
    // The discount's headline effect: Sol reaches the era's central mechanic
    // one income-tick earlier than an undiscounted faction.
    const state = galaxyState('stellar_mandate');
    const result = validateResearch(state, 'p1', 'ga_hyperspace_chart');
    expect(result.valid).toBe(true);
  });
});

describe('galaxy faction sustained perks', () => {
  it('every galaxy faction carries one', () => {
    // Sol: research discount · Rust: +1 reinforce · Verdan: free hyperspace
    // (structural, via getOrbitAccessResult) · Nexus: +1 reinforce + stability.
    for (const f of GALAXY_AGE_FACTIONS) {
      const hasPerk =
        (f.reinforce_bonus ?? 0) > 0 ||
        (f.tech_cost_discount ?? 0) > 0 ||
        (f.stability_recovery_bonus ?? 0) > 0 ||
        f.faction_id === 'helion_navigators';
      expect(hasPerk, `${f.faction_id} has no sustained perk`).toBe(true);
    }
  });
});
