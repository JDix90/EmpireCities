import { describe, it, expect } from 'vitest';
import {
  CORE_TUTORIAL_GRANT_GOLD,
  CORE_TUTORIAL_GRANT_TECH_POINTS,
  ERA_LESSON_GRANT_GOLD,
  ERA_LESSON_GRANT_TECH_POINTS,
} from './tutorialGrants';
import { normalizeGameSettings } from '../state/gameSettings';
import { computeAdvanceCost } from '../eraAdvancement/advanceEra';
import { getEffectiveMilestoneGate } from '../eraAdvancement/spines';
import { ANCIENT_TECH_TREE } from '../eras/ancient';
import type { GameState, PlayerState } from '../../types';

/**
 * The tutorial's headline beat is advancing an era in the first session. Whether
 * that is reachable is arithmetic between three things tuned in three different
 * files: the grant, the era-advancement cost formula, and the milestone gate.
 * These tests recompute the second and third from the real settings, so a change
 * to `cost_income_floor`, `cost_mult` or the Skirmish preset fails here rather
 * than in a first-time player's session.
 */

/** The settings `POST /games/tutorial/start` writes for the core lesson. */
function coreTutorialState(): GameState {
  const settings = normalizeGameSettings({
    tutorial: true,
    economy_enabled: true,
    tech_trees_enabled: true,
    stability_enabled: false,
    era_advancement_enabled: true,
    era_advancement_preset: 'skirmish',
    era_advancement_min_buildings: 0,
    era_advancement_min_tier2_techs: 0,
    max_players: 2,
  });
  const player: PlayerState = {
    player_id: 'human',
    current_era_index: 0,
    // Tutorial Island is 6 territories, so base production income is
    // max(1, floor(owned/3)) — nowhere near the cost formula's income floor.
    last_turn_production_income: 2,
    special_resource: CORE_TUTORIAL_GRANT_GOLD,
    unlocked_techs: [],
    buildings: [],
  } as unknown as PlayerState;
  return { settings, players: [player], territories: {} } as unknown as GameState;
}

describe('tutorial grants', () => {
  it('funds the core tutorial past the advance cost', () => {
    const state = coreTutorialState();
    const cost = computeAdvanceCost(state, state.players[0]);
    expect(CORE_TUTORIAL_GRANT_GOLD).toBeGreaterThanOrEqual(cost);
    // Slack, not a fortune: the player should be able to buy one cheap building
    // and still advance, but the number has to stay legible next to the cost.
    expect(CORE_TUTORIAL_GRANT_GOLD).toBeLessThanOrEqual(cost * 2);
  });

  it('funds exactly the two tier-1 technologies the core gate asks for', () => {
    const state = coreTutorialState();
    const gate = getEffectiveMilestoneGate(state, 'human');
    expect(gate.min_tier1_techs).toBe(2);
    // Softened for the first session; the wrap-up card says a real game wants more.
    expect(gate.min_tier2_techs).toBe(0);
    expect(gate.min_buildings).toBe(0);

    const tier1Costs = ANCIENT_TECH_TREE
      .filter((t) => t.tier === 1)
      .map((t) => t.cost)
      .sort((a, b) => a - b);
    expect(tier1Costs.length).toBeGreaterThanOrEqual(gate.min_tier1_techs);
    const cheapestPair = tier1Costs.slice(0, gate.min_tier1_techs).reduce((a, b) => a + b, 0);
    const dearestPair = tier1Costs.slice(-gate.min_tier1_techs).reduce((a, b) => a + b, 0);
    // Any pair is affordable, so the choice between them is real…
    expect(CORE_TUTORIAL_GRANT_TECH_POINTS).toBeGreaterThanOrEqual(dearestPair);
    // …and a third is not, so the budget stays a budget.
    expect(CORE_TUTORIAL_GRANT_TECH_POINTS).toBeLessThan(cheapestPair + tier1Costs[0]);
  });

  it('funds the Era Advancement deep dive through its stiffer gate', () => {
    // That lesson keeps the tier-2 requirement, so it needs the prerequisite
    // chain: min_tier1 tier-1 nodes plus a tier-2 built on one of them.
    const state = coreTutorialState();
    state.settings.era_advancement_min_tier2_techs = 1;
    const gate = getEffectiveMilestoneGate(state, 'human');
    const cheapestOfTier = (tier: number) =>
      Math.min(...ANCIENT_TECH_TREE.filter((t) => t.tier === tier).map((t) => t.cost));
    const needed =
      cheapestOfTier(1) * gate.min_tier1_techs + cheapestOfTier(2) * gate.min_tier2_techs;
    expect(ERA_LESSON_GRANT_TECH_POINTS).toBeGreaterThanOrEqual(needed);
    expect(ERA_LESSON_GRANT_GOLD).toBeGreaterThanOrEqual(
      computeAdvanceCost(state, state.players[0]),
    );
  });
});
