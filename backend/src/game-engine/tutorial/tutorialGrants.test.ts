import { describe, it, expect } from 'vitest';
import {
  CORE_TUTORIAL_GRANT_GOLD,
  CORE_TUTORIAL_GRANT_TECH_POINTS,
  ERA_LESSON_GRANT_GOLD,
  ERA_LESSON_GRANT_TECH_POINTS,
  GALAXY_LANE_SOVEREIGNTY_GRANT_TECH_POINTS,
  GALAXY_TRANSCENDENCE_GRANT_GOLD,
  GALAXY_TRANSCENDENCE_GRANT_TECH_POINTS,
} from './tutorialGrants';
import { GALAXY_AGE_TECH_TREE, GALAXY_AGE_WONDER } from '../eras/galaxyage';
import { SPACE_AGE_TECH_TREE } from '../eras/spaceage';
import { DEFAULT_BUILDING_COSTS } from '../state/economyManager';
import { galaxyTutorialGameSpec } from './galaxyTutorialGames';
import { GALAXY_TRANSCENDENCE_RESEARCH_PATH } from './galaxyTranscendenceScenario';
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
    // The tutorial board is 6 territories, so base production income is
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

  it('funds Lane Charts for the Lane Sovereignty lesson, and nothing more', () => {
    const laneCharts = GALAXY_AGE_TECH_TREE.find((n) => n.tech_id === 'ga_hyperspace_chart')!;
    expect(GALAXY_LANE_SOVEREIGNTY_GRANT_TECH_POINTS).toBe(laneCharts.cost);
    const cheapest = Math.min(...GALAXY_AGE_TECH_TREE.map((n) => n.cost));
    expect(GALAXY_LANE_SOVEREIGNTY_GRANT_TECH_POINTS).toBeLessThan(laneCharts.cost + cheapest);
  });

  it('funds the Transcendence lesson through the Space to Stars gate, the advance and the Anchor', () => {
    // The gate out of the Space Age is the spine step's own: 2 tier-2, 1
    // tier-3, 3 buildings, plus the lesson's 2 tier-1. The research grant must
    // cover the named path through it, and the gold the two Workshops the
    // Launch Pad does not supply, the advance and the Hyperlane Anchor.
    const spec = galaxyTutorialGameSpec('galaxy_transcendence');
    const settings = normalizeGameSettings(spec.settings);
    const human: PlayerState = {
      player_id: 'human', player_index: 0, username: 'Human', color: '#fff', is_ai: false,
      is_eliminated: false, territory_count: 6, cards: [], capital_territory_id: null,
      secret_mission: null, mmr: 1000, current_era_index: 0, last_turn_production_income: 0,
    };
    const state = {
      game_id: 'g', era: 'space_age', map_id: 'era_ascension_galaxy', phase: 'draft',
      current_player_index: 0, turn_number: 1, players: [human], territories: {}, card_deck: [],
      card_set_redemption_count: 0, diplomacy: [], settings, draft_units_remaining: 0,
      draft_placements_this_turn: {}, turn_started_at: 0, win_probability_history: [],
      fortify_moves_used: 0, influence_cooldown_remaining: 0, blitzkrieg_attacked: false,
    } as unknown as GameState;

    const gate = getEffectiveMilestoneGate(state, 'human');
    expect(gate).toEqual({ min_tier1_techs: 2, min_tier2_techs: 2, min_tier3_techs: 1, min_buildings: 3 });

    const byId = new Map(SPACE_AGE_TECH_TREE.map((n) => [n.tech_id, n]));
    const path = GALAXY_TRANSCENDENCE_RESEARCH_PATH.map((id) => byId.get(id)!);
    // The path clears the tiers the gate asks for, with every prerequisite inside it.
    const tiers = (t: number) => path.filter((n) => n.tier === t).length;
    expect(tiers(1)).toBeGreaterThanOrEqual(gate.min_tier1_techs);
    expect(tiers(2)).toBeGreaterThanOrEqual(gate.min_tier2_techs);
    expect(tiers(3)).toBeGreaterThanOrEqual(gate.min_tier3_techs);
    const inPath = new Set(path.map((n) => n.tech_id));
    for (const n of path) if (n.prerequisite) expect(inPath.has(n.prerequisite), n.tech_id).toBe(true);
    const pathCost = path.reduce((sum, n) => sum + n.cost, 0);
    expect(GALAXY_TRANSCENDENCE_GRANT_TECH_POINTS).toBeGreaterThanOrEqual(pathCost);
    // …and no more than one cheap detour over it: a budget, not a pile.
    const cheapest = Math.min(...SPACE_AGE_TECH_TREE.map((n) => n.cost));
    expect(GALAXY_TRANSCENDENCE_GRANT_TECH_POINTS).toBeLessThan(pathCost + 2 * cheapest);

    const workshops = (gate.min_buildings - 1) * DEFAULT_BUILDING_COSTS.production_1; // the pad is the third
    const advance = computeAdvanceCost(state, human);
    const anchor = DEFAULT_BUILDING_COSTS[GALAXY_AGE_WONDER.wonder_id];
    expect(anchor).toBe(GALAXY_AGE_WONDER.cost);
    expect(GALAXY_TRANSCENDENCE_GRANT_GOLD).toBeGreaterThanOrEqual(workshops + advance + anchor);
    expect(GALAXY_TRANSCENDENCE_GRANT_GOLD).toBeLessThan(workshops + advance + anchor + DEFAULT_BUILDING_COSTS.production_1 * 3);
  });
});
