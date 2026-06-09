import type { GameState } from '../../types';
import { getEraTechTree } from '../eras';
import { countPlayerBuildings } from '../state/economyManager';
import { resolvePlayerEraId } from './constants';

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

  const tier1Required = state.settings.era_advancement_min_tier1_techs ?? 3;
  const tier2Required = state.settings.era_advancement_min_tier2_techs ?? 1;
  const buildingsRequired = state.settings.era_advancement_min_buildings ?? 1;

  const tier1Current = countUnlockedTechsByTier(state, playerId, 1, 1);
  const tier2Current = countUnlockedTechsByTier(state, playerId, 2, 2);
  const buildingsCurrent = countPlayerBuildings(state, playerId);

  const tier1: EraAdvancementReadinessCheck = {
    met: tier1Current >= tier1Required,
    current: tier1Current,
    required: tier1Required,
    label: 'tier-1 technologies',
  };
  const tier2: EraAdvancementReadinessCheck = {
    met: tier2Current >= tier2Required,
    current: tier2Current,
    required: tier2Required,
    label: 'tier-2 technologies',
  };
  const buildings: EraAdvancementReadinessCheck = {
    met: buildingsCurrent >= buildingsRequired,
    current: buildingsCurrent,
    required: buildingsRequired,
    label: 'buildings',
  };

  const met = tier1.met && tier2.met && buildings.met;
  let error: string | undefined;
  if (!tier1.met) {
    error = `Research ${tier1Required} tier-1 technologies (${tier1Current}/${tier1Required})`;
  } else if (!tier2.met) {
    error = `Research at least ${tier2Required} tier-2 technolog${tier2Required === 1 ? 'y' : 'ies'} (${tier2Current}/${tier2Required})`;
  } else if (!buildings.met) {
    error = `Build at least ${buildingsRequired} building${buildingsRequired === 1 ? '' : 's'} (${buildingsCurrent}/${buildingsRequired})`;
  }

  return {
    met,
    mode,
    error,
    tier1,
    tier2,
    buildings,
  };
}
