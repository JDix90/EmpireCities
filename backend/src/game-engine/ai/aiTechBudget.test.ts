import { describe, it, expect } from 'vitest';
import type { GameState, PlayerState } from '../../types';
import { aiResearchesTech, nextResearchReserve, shouldSpendTechPointsOnAbility } from './aiTechBudget';

/**
 * The AI used to fire any affordable draft-phase faction ability every turn.
 * For tech-costed ones that traded the whole tech tree for a trickle of units:
 * Sino-Pacific (AI Surge, 5 TP) won 4.2% of 120 six-player games firing it
 * every turn against 21.7% with it silenced. The bot must now keep back the
 * price of its next research.
 *
 * Space Age tier-1 costs, used throughout: sa_megacity and sa_climate_shield 4,
 * sa_digital_warfare 5, sa_orbital_recon 6 (needs sa_digital_warfare).
 */

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    player_id: 'ai1',
    player_index: 0,
    is_ai: true,
    is_eliminated: false,
    unlocked_techs: [],
    tech_points: 0,
    special_resource: 0,
    ...overrides,
  } as PlayerState;
}

function spaceAgeState(p: PlayerState, settings: Record<string, unknown> = {}): GameState {
  return {
    era: 'space_age',
    players: [p],
    territories: {},
    settings: { tech_trees_enabled: true, era_advancement_enabled: false, ...settings },
  } as unknown as GameState;
}

describe('aiResearchesTech', () => {
  it('is false when tech trees are off, or for tutorial bots', () => {
    expect(aiResearchesTech(spaceAgeState(player(), { tech_trees_enabled: false }), 'medium')).toBe(false);
    expect(aiResearchesTech(spaceAgeState(player()), 'tutorial')).toBe(false);
  });

  it('is false for easy in a normal game, true where easy must research', () => {
    expect(aiResearchesTech(spaceAgeState(player()), 'easy')).toBe(false);
    expect(aiResearchesTech(spaceAgeState(player(), { era_advancement_enabled: true }), 'easy')).toBe(true);
    const galaxy = { ...spaceAgeState(player()), era: 'galaxy_age' } as GameState;
    expect(aiResearchesTech(galaxy, 'easy')).toBe(true);
  });

  it('is true for medium and above', () => {
    for (const d of ['medium', 'hard', 'expert'] as const) {
      expect(aiResearchesTech(spaceAgeState(player()), d)).toBe(true);
    }
  });
});

describe('nextResearchReserve', () => {
  it('is the cheapest node whose prerequisites are met', () => {
    expect(nextResearchReserve(spaceAgeState(player()), 'ai1', 'medium')).toBe(4);
  });

  it('rises as the cheap nodes are bought', () => {
    const p = player({ unlocked_techs: ['sa_megacity', 'sa_climate_shield'] });
    // Cheapest remaining with prerequisites met is sa_digital_warfare at 5;
    // sa_fusion_power (9) is now unlocked-for-research by sa_megacity but dearer.
    expect(nextResearchReserve(spaceAgeState(p), 'ai1', 'medium')).toBe(5);
  });

  it('ignores nodes whose prerequisite is still locked', () => {
    // sa_orbital_recon (6) needs sa_digital_warfare, so it is not a candidate
    // while the cheapest open nodes are the 4-cost tier-1 pair.
    const reserve = nextResearchReserve(spaceAgeState(player()), 'ai1', 'medium');
    expect(reserve).toBe(4);
  });

  it('is null when the tree is exhausted', () => {
    const all = [
      'sa_digital_warfare', 'sa_megacity', 'sa_climate_shield', 'sa_orbital_recon',
      'sa_ai_command', 'sa_fusion_power', 'sa_launch_pad_tech', 'sa_hypersonic_swarm',
      'sa_quantum_grid', 'sa_space_station', 'sa_singularity_war', 'sa_dyson_array',
      'sa_lunar_expansion',
    ];
    expect(nextResearchReserve(spaceAgeState(player({ unlocked_techs: all })), 'ai1', 'medium')).toBeNull();
  });

  it('is null when the bot never researches', () => {
    expect(nextResearchReserve(spaceAgeState(player()), 'ai1', 'easy')).toBeNull();
    expect(nextResearchReserve(spaceAgeState(player(), { tech_trees_enabled: false }), 'ai1', 'medium')).toBeNull();
  });

  it('is null for an unknown player', () => {
    expect(nextResearchReserve(spaceAgeState(player()), 'nobody', 'medium')).toBeNull();
  });
});

describe('shouldSpendTechPointsOnAbility', () => {
  it('fires a free ability regardless of tech points', () => {
    expect(shouldSpendTechPointsOnAbility(spaceAgeState(player({ tech_points: 0 })), 'ai1', 'medium', 0)).toBe(true);
  });

  it('refuses when the ability itself is unaffordable', () => {
    expect(shouldSpendTechPointsOnAbility(spaceAgeState(player({ tech_points: 4 })), 'ai1', 'medium', 5)).toBe(false);
  });

  it('refuses when paying would leave less than the next research (the bug)', () => {
    // AI Surge at 5 TP with 5 in hand: affordable, but leaves 0 against a
    // 4-cost next tech, which is exactly the starvation loop.
    expect(shouldSpendTechPointsOnAbility(spaceAgeState(player({ tech_points: 5 })), 'ai1', 'medium', 5)).toBe(false);
    expect(shouldSpendTechPointsOnAbility(spaceAgeState(player({ tech_points: 8 })), 'ai1', 'medium', 5)).toBe(false);
  });

  it('fires once the surplus covers both', () => {
    // 9 TP: 5 for the ability leaves 4, the cost of the next tech.
    expect(shouldSpendTechPointsOnAbility(spaceAgeState(player({ tech_points: 9 })), 'ai1', 'medium', 5)).toBe(true);
    expect(shouldSpendTechPointsOnAbility(spaceAgeState(player({ tech_points: 20 })), 'ai1', 'medium', 5)).toBe(true);
  });

  it('fires freely once the tree is exhausted', () => {
    const all = [
      'sa_digital_warfare', 'sa_megacity', 'sa_climate_shield', 'sa_orbital_recon',
      'sa_ai_command', 'sa_fusion_power', 'sa_launch_pad_tech', 'sa_hypersonic_swarm',
      'sa_quantum_grid', 'sa_space_station', 'sa_singularity_war', 'sa_dyson_array',
      'sa_lunar_expansion',
    ];
    const state = spaceAgeState(player({ tech_points: 5, unlocked_techs: all }));
    expect(shouldSpendTechPointsOnAbility(state, 'ai1', 'medium', 5)).toBe(true);
  });

  it('keeps the naive rule for bots that never research', () => {
    // Easy in a normal game, and any bot with tech trees off, have nothing to
    // save for, so affordability is the only test.
    expect(shouldSpendTechPointsOnAbility(spaceAgeState(player({ tech_points: 5 })), 'ai1', 'easy', 5)).toBe(true);
    const noTech = spaceAgeState(player({ tech_points: 5 }), { tech_trees_enabled: false });
    expect(shouldSpendTechPointsOnAbility(noTech, 'ai1', 'medium', 5)).toBe(true);
  });

  it('respects a faction research discount when sizing the reserve', () => {
    // Stellar Mandate-style discount is applied through getEffectiveTechCost,
    // so a cheaper next tech frees the ability sooner. Without factions the
    // discount is inert, so the reserve stays at the list price.
    const state = spaceAgeState(player({ tech_points: 8, pending_tech_discount: 1 }));
    expect(shouldSpendTechPointsOnAbility(state, 'ai1', 'medium', 5)).toBe(true);
  });

  it('refuses for an unknown player', () => {
    expect(shouldSpendTechPointsOnAbility(spaceAgeState(player()), 'nobody', 'medium', 5)).toBe(false);
  });
});
