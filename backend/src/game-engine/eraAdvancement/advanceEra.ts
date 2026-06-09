import type { GameState, PlayerState } from '../../types';
import { getEraTechTree } from '../eras';
import { getEmpireWeightedStability } from '../state/stabilityManager';
import {
  ERA_ADVANCEMENT_SEQUENCE,
  getEraIdForAdvancementIndex,
  resolvePlayerEraId,
} from './constants';
import { evaluateEraAdvancementReadiness } from './eraAdvancementReadiness';

export interface AdvanceEraGateResult {
  canAdvance: boolean;
  error?: string;
  cost?: number;
}

export function computeAdvanceCost(state: GameState, player: PlayerState): number {
  const fromIndex = player.current_era_index ?? 0;
  const mult = state.settings.era_advancement_cost_mult ?? 2.0;
  const escalation = state.settings.era_advancement_cost_escalation ?? 1.5;
  const income = player.last_turn_production_income ?? 0;
  return Math.ceil(income * mult * escalation ** fromIndex);
}

function captureTechEcho(state: GameState, player: PlayerState): Record<string, number> {
  const departingEra = resolvePlayerEraId(state, player);
  const tree = getEraTechTree(departingEra);
  const unlocked = player.unlocked_techs ?? [];
  const echo: Record<string, number> = {};

  for (const techId of unlocked) {
    const node = tree.find((n) => n.tech_id === techId);
    if (!node) continue;
    if (node.attack_bonus) echo.attack_bonus = (echo.attack_bonus ?? 0) + node.attack_bonus;
    if (node.defense_bonus) echo.defense_bonus = (echo.defense_bonus ?? 0) + node.defense_bonus;
    if (node.reinforce_bonus) echo.reinforce_bonus = (echo.reinforce_bonus ?? 0) + node.reinforce_bonus;
    if (node.tech_point_income) {
      echo.tech_point_income = (echo.tech_point_income ?? 0) + node.tech_point_income;
    }
  }

  return echo;
}

function distributeConvertedUnits(
  territories: Array<{ territory_id: string; unit_count: number }>,
  ratio: number,
): void {
  const total = territories.reduce((sum, t) => sum + t.unit_count, 0);
  if (total <= 0) return;

  const targetTotal = Math.max(1, Math.floor(total * ratio));
  if (targetTotal === total) return;

  const allocations = territories.map((t) => {
    const exact = (t.unit_count / total) * targetTotal;
    const floored = Math.floor(exact);
    return { ...t, floored, remainder: exact - floored };
  });

  let assigned = allocations.reduce((sum, a) => sum + a.floored, 0);
  const sorted = [...allocations].sort((a, b) => b.remainder - a.remainder);
  for (const entry of sorted) {
    if (assigned >= targetTotal) break;
    entry.floored += 1;
    assigned += 1;
  }

  for (const entry of allocations) {
    const t = territories.find((x) => x.territory_id === entry.territory_id);
    if (t) t.unit_count = Math.max(1, entry.floored);
  }
}

export function canAdvanceEra(state: GameState, playerId: string): AdvanceEraGateResult {
  if (!state.settings.era_advancement_enabled) {
    return { canAdvance: false, error: 'Era advancement is not enabled for this game' };
  }
  if (state.settings.is_campaign) {
    return { canAdvance: false, error: 'Era advancement is not available in campaign games' };
  }
  if (!state.settings.economy_enabled) {
    return { canAdvance: false, error: 'Economy must be enabled for era advancement' };
  }

  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return { canAdvance: false, error: 'Player not found' };
  if (player.is_eliminated) return { canAdvance: false, error: 'Eliminated players cannot advance' };
  const maxIndex = state.settings.era_advancement_max_era_index ?? 1;
  const currentIndex = player.current_era_index ?? 0;
  if (currentIndex >= maxIndex) {
    return { canAdvance: false, error: 'Already at the maximum era for this match' };
  }

  const cost = computeAdvanceCost(state, player);
  if ((player.special_resource ?? 0) < cost) {
    return { canAdvance: false, error: `Not enough gold (need ${cost}, have ${player.special_resource ?? 0})`, cost };
  }

  if (state.settings.stability_enabled) {
    const gate = state.settings.era_advancement_stability_gate ?? 60;
    const stability = getEmpireWeightedStability(state, playerId);
    if (stability < gate) {
      return { canAdvance: false, error: `Empire stability too low (${stability.toFixed(0)}%; need ${gate})`, cost };
    }
  }

  if (state.settings.tech_trees_enabled) {
    const readiness = evaluateEraAdvancementReadiness(state, playerId);
    if (!readiness.met) {
      return {
        canAdvance: false,
        error: readiness.error ?? 'Research and economy requirements not met',
        cost,
      };
    }
  }

  return { canAdvance: true, cost };
}

export function executeAdvanceEra(state: GameState, playerId: string): { success: boolean; error?: string } {
  const gate = canAdvanceEra(state, playerId);
  if (!gate.canAdvance) return { success: false, error: gate.error };

  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return { success: false, error: 'Player not found' };

  const cost = gate.cost ?? computeAdvanceCost(state, player);
  player.special_resource = Math.max(0, (player.special_resource ?? 0) - cost);

  const ratio = state.settings.era_advancement_conversion_ratio ?? 0.7;
  const owned = Object.values(state.territories)
    .filter((t) => t.owner_id === playerId && t.unit_count > 0)
    .map((t) => ({ territory_id: t.territory_id, unit_count: t.unit_count }));
  distributeConvertedUnits(owned, ratio);
  for (const { territory_id, unit_count } of owned) {
    state.territories[territory_id].unit_count = unit_count;
  }

  const departingEcho = captureTechEcho(state, player);
  player.era_advancement_tech_echo = {
    ...(player.era_advancement_tech_echo ?? {}),
    ...departingEcho,
  };
  player.unlocked_techs = [];

  const nextIndex = (player.current_era_index ?? 0) + 1;
  player.current_era_index = nextIndex;
  player.era_transition_turns_remaining = state.settings.era_advancement_vuln_turns ?? 1;

  const nextEraId = getEraIdForAdvancementIndex(nextIndex);
  if (nextEraId === 'medieval') {
    player.medieval_signature_charges = (player.medieval_signature_charges ?? 0) + 1;
  }

  if (state.phase === 'attack') {
    player.era_advanced_this_turn = true;
  }

  return { success: true };
}

export function getAdvanceEraPreview(state: GameState, playerId: string): {
  canAdvance: boolean;
  error?: string;
  cost: number;
  currentEraIndex: number;
  nextEraId: string;
  stability?: number;
  techProgress?: { unlocked: number; required: number };
  readiness?: ReturnType<typeof evaluateEraAdvancementReadiness>;
} {
  const gate = canAdvanceEra(state, playerId);
  const player = state.players.find((p) => p.player_id === playerId);
  const currentIndex = player?.current_era_index ?? 0;
  const nextIndex = Math.min(
    currentIndex + 1,
    state.settings.era_advancement_max_era_index ?? ERA_ADVANCEMENT_SEQUENCE.length - 1,
  );

  let techProgress: { unlocked: number; required: number } | undefined;
  let readiness: ReturnType<typeof evaluateEraAdvancementReadiness> | undefined;
  if (player && state.settings.tech_trees_enabled) {
    readiness = evaluateEraAdvancementReadiness(state, playerId);
    if (readiness.mode === 'percent' && readiness.percent) {
      techProgress = readiness.percent;
    }
  }

  return {
    canAdvance: gate.canAdvance,
    error: gate.error,
    cost: gate.cost ?? (player ? computeAdvanceCost(state, player) : 0),
    currentEraIndex: currentIndex,
    nextEraId: getEraIdForAdvancementIndex(nextIndex),
    stability: state.settings.stability_enabled && player
      ? getEmpireWeightedStability(state, playerId)
      : undefined,
    techProgress,
    readiness,
  };
}
