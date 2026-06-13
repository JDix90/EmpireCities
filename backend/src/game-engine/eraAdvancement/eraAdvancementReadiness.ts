import type { GameState } from '../../types';
import { getEraTechTree } from '../eras';
import { countPlayerBuildings } from '../state/economyManager';
import { resolvePlayerEraId } from './constants';
import { getEffectiveMilestoneGate } from './spines';

export type EraAdvancementTechGateMode = 'milestone' | 'percent';

export interface EraAdvancementReadinessCheck {
  met: boolean;
  current: number;
  required: number;
  label: string;
}

export interface EraAdvancementReadinessResult {
  met: boolean;
  mode: EraAdvancementTechGateMode;
  error?: string;
  tier1?: EraAdvancementReadinessCheck;
  tier2?: EraAdvancementReadinessCheck;
  /** Present only when the active gate requires tier-3 techs (later spine steps). */
  tier3?: EraAdvancementReadinessCheck;
  buildings?: EraAdvancementReadinessCheck;
  percent?: { unlocked: number; required: number };
}

export function countUnlockedTechsByTier(
  state: GameState,
  playerId: string,
  minTier: number,
  maxTier: number,
): number {
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return 0;
  const eraId = resolvePlayerEraId(state, player);
  const tree = getEraTechTree(eraId);
  const unlocked = new Set(player.unlocked_techs ?? []);
  return tree.filter(
    (node) => unlocked.has(node.tech_id) && node.tier >= minTier && node.tier <= maxTier,
  ).length;
}

export function resolveTechGateMode(state: GameState): EraAdvancementTechGateMode {
  const mode = state.settings.era_advancement_tech_gate_mode;
  return mode === 'percent' ? 'percent' : 'milestone';
}

export function evaluateEraAdvancementReadiness(
  state: GameState,
  playerId: string,
): EraAdvancementReadinessResult {
  if (!state.settings.tech_trees_enabled) {
    return { met: true, mode: 'milestone' };
  }

  const mode = resolveTechGateMode(state);
  const player = state.players.find((p) => p.player_id === playerId);

  if (mode === 'percent') {
    const eraId = player ? resolvePlayerEraId(state, player) : state.era;
    const treeLen = getEraTechTree(eraId).length;
    const unlocked = (player?.unlocked_techs ?? []).length;
    const pct = state.settings.era_advancement_tech_gate_pct ?? 0.33;
    const required = Math.ceil(treeLen * pct);
    const met = treeLen === 0 || unlocked >= required;
    return {
      met,
      mode,
      error: met ? undefined : `Research more technologies (${unlocked}/${required} required)`,
      percent: { unlocked, required },
    };
  }

  // The effective gate overlays per-spine-step overrides and catch-up relaxation
  // onto the global milestone settings.
  const gate = getEffectiveMilestoneGate(state, playerId);

  const tier1Current = countUnlockedTechsByTier(state, playerId, 1, 1);
  const tier2Current = countUnlockedTechsByTier(state, playerId, 2, 2);
  const tier3Current = gate.min_tier3_techs > 0 ? countUnlockedTechsByTier(state, playerId, 3, 3) : 0;
  const buildingsCurrent = countPlayerBuildings(state, playerId);

  const tier1: EraAdvancementReadinessCheck = {
    met: tier1Current >= gate.min_tier1_techs,
    current: tier1Current,
    required: gate.min_tier1_techs,
    label: 'tier-1 technologies',
  };
  const tier2: EraAdvancementReadinessCheck = {
    met: tier2Current >= gate.min_tier2_techs,
    current: tier2Current,
    required: gate.min_tier2_techs,
    label: 'tier-2 technologies',
  };
  const tier3: EraAdvancementReadinessCheck | undefined = gate.min_tier3_techs > 0
    ? {
      met: tier3Current >= gate.min_tier3_techs,
      current: tier3Current,
      required: gate.min_tier3_techs,
      label: 'tier-3 technologies',
    }
    : undefined;
  const buildings: EraAdvancementReadinessCheck = {
    met: buildingsCurrent >= gate.min_buildings,
    current: buildingsCurrent,
    required: gate.min_buildings,
    label: 'buildings',
  };

  const met = tier1.met && tier2.met && (tier3?.met ?? true) && buildings.met;
  let error: string | undefined;
  if (!tier1.met) {
    error = `Research ${gate.min_tier1_techs} tier-1 technologies (${tier1Current}/${gate.min_tier1_techs})`;
  } else if (!tier2.met) {
    error = `Research at least ${gate.min_tier2_techs} tier-2 technolog${gate.min_tier2_techs === 1 ? 'y' : 'ies'} (${tier2Current}/${gate.min_tier2_techs})`;
  } else if (tier3 && !tier3.met) {
    error = `Research at least ${gate.min_tier3_techs} tier-3 technolog${gate.min_tier3_techs === 1 ? 'y' : 'ies'} (${tier3Current}/${gate.min_tier3_techs})`;
  } else if (!buildings.met) {
    error = `Build at least ${gate.min_buildings} building${gate.min_buildings === 1 ? '' : 's'} (${buildingsCurrent}/${gate.min_buildings})`;
  }

  return {
    met,
    mode,
    error,
    tier1,
    tier2,
    tier3,
    buildings,
  };
}
