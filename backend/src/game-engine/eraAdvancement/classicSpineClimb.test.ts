import { describe, it, expect } from 'vitest';
import type { GameState, PlayerState, TerritoryState } from '../../types';
import { getEraTechTree } from '../eras';
import { canAdvanceEra, computeAdvanceCost, executeAdvanceEra } from './advanceEra';
import { resolvePlayerEraId } from './constants';
import { ERA_ADVANCEMENT_SPINES, getEffectiveMilestoneGate } from './spines';

/**
 * EA-201 acceptance: a deterministic end-to-end climb of the classic spine
 * (Ancient → Modern) through the pure engine — no sockets. At each step we
 * satisfy exactly the effective milestone gate from the real era tech tree,
 * which also proves every step's gate (including the tier-3 requirements on
 * later steps) is actually satisfiable from that era's tree.
 */

function climbState(): GameState {
  const territories: Record<string, TerritoryState> = {
    cap: {
      territory_id: 'cap',
      owner_id: 'climber',
      unit_count: 20,
      unit_type: 'infantry',
      buildings: ['production_1', 'production_2', 'defense_1'],
    },
    t2: { territory_id: 't2', owner_id: 'climber', unit_count: 10, unit_type: 'infantry' },
  };
  const player = {
    player_id: 'climber',
    player_index: 0,
    is_eliminated: false,
    special_resource: 100_000,
    last_turn_production_income: 20,
    current_era_index: 0,
    unlocked_techs: [],
    era_signature_charges: {},
    era_advancement_tech_echo: {},
  } as PlayerState;
  return {
    game_id: 'climb',
    era: 'ancient',
    phase: 'draft',
    players: [player],
    territories,
    era_spine: ERA_ADVANCEMENT_SPINES.classic.steps,
    settings: {
      era_advancement_enabled: true,
      economy_enabled: true,
      tech_trees_enabled: true,
      stability_enabled: false,
      era_advancement_spine_id: 'classic',
    },
  } as GameState;
}

/** Unlock exactly enough techs from the current era's tree to clear its gate. */
function satisfyGate(state: GameState, player: PlayerState): void {
  const gate = getEffectiveMilestoneGate(state, player.player_id);
  const tree = getEraTechTree(resolvePlayerEraId(state, player));
  const byTier = (tier: number) => tree.filter((n) => n.tier === tier).map((n) => n.tech_id);
  const picked: string[] = [
    ...byTier(1).slice(0, gate.min_tier1_techs),
    ...byTier(2).slice(0, gate.min_tier2_techs),
    ...byTier(3).slice(0, gate.min_tier3_techs),
  ];
  // Guards: the era's tree must actually contain enough techs at each tier.
  expect(byTier(1).length, `tier1 in ${resolvePlayerEraId(state, player)}`).toBeGreaterThanOrEqual(gate.min_tier1_techs);
  expect(byTier(2).length, `tier2 in ${resolvePlayerEraId(state, player)}`).toBeGreaterThanOrEqual(gate.min_tier2_techs);
  expect(byTier(3).length, `tier3 in ${resolvePlayerEraId(state, player)}`).toBeGreaterThanOrEqual(gate.min_tier3_techs);
  player.unlocked_techs = picked;
  player.special_resource = 100_000;
}

describe('classic spine climb (EA-201 end-to-end)', () => {
  it('climbs Ancient → Modern, granting the medieval signature once', () => {
    const state = climbState();
    const player = state.players[0];
    const visited: string[] = [resolvePlayerEraId(state, player)];

    for (let step = 0; step < 5; step++) {
      satisfyGate(state, player);
      expect(canAdvanceEra(state, 'climber').canAdvance, `gate at step ${step}`).toBe(true);
      const result = executeAdvanceEra(state, 'climber');
      expect(result.success, `advance at step ${step}`).toBe(true);
      expect(player.current_era_index).toBe(step + 1);
      visited.push(resolvePlayerEraId(state, player));
    }

    expect(visited).toEqual(['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern']);
    // Each arrival fired its signature (stability off in this climb, so
    // intelligence_coup takes its charge fallback; mobilization/precision_strike/
    // orbital_window are instant and leave no charge).
    expect(player.era_signature_charges).toEqual({
      levy_of_knights: 1,
      age_of_sail: 2,
      intelligence_coup: 1,
    });
    // Precision Strike (modern arrival) armed a pending pre-attack strike.
    expect(player.pending_pre_attack_damage).toBe(2);
    // Cannot advance past the final era.
    expect(canAdvanceEra(state, 'climber').canAdvance).toBe(false);
  });

  it('accumulates era-keyed tech echo across the climb', () => {
    const state = climbState();
    const player = state.players[0];
    for (let step = 0; step < 3; step++) {
      satisfyGate(state, player);
      executeAdvanceEra(state, 'climber');
    }
    // Departed ancient, medieval, discovery each leave an echo bucket.
    const echo = player.era_advancement_tech_echo as Record<string, Record<string, number>>;
    expect(Object.keys(echo).sort()).toEqual(['ancient', 'discovery', 'medieval']);
  });

  it('enforces the tier-3 requirement introduced at the ww2 step', () => {
    const state = climbState();
    const player = state.players[0];
    // Reach ww2 (index 3).
    for (let step = 0; step < 3; step++) {
      satisfyGate(state, player);
      executeAdvanceEra(state, 'climber');
    }
    expect(resolvePlayerEraId(state, player)).toBe('ww2');
    // Satisfy only tier-1/tier-2, omit the required tier-3 → blocked.
    const tree = getEraTechTree('ww2');
    player.unlocked_techs = [
      ...tree.filter((n) => n.tier === 1).slice(0, 3).map((n) => n.tech_id),
      ...tree.filter((n) => n.tier === 2).slice(0, 2).map((n) => n.tech_id),
    ];
    const gate = canAdvanceEra(state, 'climber');
    expect(gate.canAdvance).toBe(false);
    expect(gate.error).toMatch(/tier-3/);
    // cost should still be computable and reflect the escalation cap region
    expect(computeAdvanceCost(state, player)).toBeGreaterThan(0);
  });
});
