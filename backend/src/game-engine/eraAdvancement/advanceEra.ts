import type { AdvanceEraClientPreview, GameState, PlayerState } from '../../types';
import { getEmpireWeightedStability } from '../state/stabilityManager';
import { getEraIdForAdvancementIndex, resolvePlayerEraId } from './constants';
import { evaluateEraAdvancementReadiness, resolveTechGateMode } from './eraAdvancementReadiness';
import { applyLineageOnAdvance } from '../eras/factionLineage';
import { ERA_SIGNATURES, grantEraSignature } from './signatures';
import { getCatchupGap, getMaxEraIndex, getStateSpineSteps } from './spines';
import { captureTechEcho, storeTechEcho } from './techEcho';

export interface AdvanceEraGateResult {
  canAdvance: boolean;
  error?: string;
  cost?: number;
}

/**
 * Multiplier knocked off a trailing player's advance cost: `discount^gap`,
 * clamped to the configured floor. 1.0 when leading or tied.
 */
export function getCatchupCostMultiplier(state: GameState, player: PlayerState): number {
  const gap = getCatchupGap(state, player);
  if (gap <= 0) return 1;
  const discount = state.settings.era_advancement_catchup_discount ?? 0.85;
  const floor = state.settings.era_advancement_catchup_discount_floor ?? 0.6;
  return Math.max(floor, discount ** gap);
}

export function computeAdvanceCost(state: GameState, player: PlayerState): number {
  const fromIndex = player.current_era_index ?? 0;
  const mult = state.settings.era_advancement_cost_mult ?? 2.0;
  const escalation = state.settings.era_advancement_cost_escalation ?? 1.5;
  const escalationCap = state.settings.era_advancement_cost_escalation_cap ?? 4.0;
  const incomeFloor = state.settings.era_advancement_cost_income_floor ?? 8;
  // Income floor blocks the "starve income the turn before advancing" exploit;
  // the escalation cap keeps late advances reachable instead of exponential.
  const income = Math.max(player.last_turn_production_income ?? 0, incomeFloor);
  const effectiveEscalation = Math.min(escalation ** fromIndex, escalationCap);
  const catchup = getCatchupCostMultiplier(state, player);
  return Math.ceil(income * mult * effectiveEscalation * catchup);
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
  const maxIndex = getMaxEraIndex(state);
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

  const departingEraId = resolvePlayerEraId(state, player);
  storeTechEcho(player, departingEraId, captureTechEcho(state, player));
  player.unlocked_techs = [];

  const nextIndex = (player.current_era_index ?? 0) + 1;
  player.current_era_index = nextIndex;
  player.era_transition_turns_remaining = state.settings.era_advancement_vuln_turns ?? 1;

  const arrivingEraId = getEraIdForAdvancementIndex(state, nextIndex);
  const arrivalStep = getStateSpineSteps(state)[nextIndex];
  if (arrivalStep?.signature_id) {
    grantEraSignature(state, player, arrivalStep.signature_id);
  }
  // Remap the player's faction along its lineage into the arriving era.
  applyLineageOnAdvance(state, player, departingEraId, arrivingEraId);

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
  const nextIndex = Math.min(currentIndex + 1, getMaxEraIndex(state));

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
    nextEraId: getEraIdForAdvancementIndex(state, nextIndex),
    stability: state.settings.stability_enabled && player
      ? getEmpireWeightedStability(state, playerId)
      : undefined,
    techProgress,
    readiness,
  };
}

/**
 * Viewer-facing era advancement status attached to each `game:state` emit.
 * The single source of truth for the client's Advance Era panel — the
 * frontend renders these numbers verbatim instead of mirroring gate math.
 */
export function buildAdvanceEraClientPreview(
  state: GameState,
  playerId: string,
): AdvanceEraClientPreview | null {
  if (!state.settings.era_advancement_enabled) return null;
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return null;

  const preview = getAdvanceEraPreview(state, playerId);
  const catchupGap = getCatchupGap(state, player);
  const catchupDiscount = getCatchupCostMultiplier(state, player);
  const nextIndex = Math.min(preview.currentEraIndex + 1, getMaxEraIndex(state));
  const nextSignatureId = preview.currentEraIndex < getMaxEraIndex(state)
    ? getStateSpineSteps(state)[nextIndex]?.signature_id
    : undefined;
  const nextSignatureDef = nextSignatureId ? ERA_SIGNATURES[nextSignatureId] : undefined;
  return {
    cost: preview.cost,
    can_advance: preview.canAdvance,
    error: preview.error,
    current_era_index: preview.currentEraIndex,
    max_era_index: getMaxEraIndex(state),
    current_era_id: getEraIdForAdvancementIndex(state, preview.currentEraIndex),
    next_era_id: getEraIdForAdvancementIndex(
      state,
      Math.min(preview.currentEraIndex + 1, getMaxEraIndex(state)),
    ),
    stability: preview.stability,
    stability_gate: state.settings.stability_enabled
      ? (state.settings.era_advancement_stability_gate ?? 60)
      : undefined,
    gate_mode: resolveTechGateMode(state),
    catchup_gap: catchupGap,
    catchup_discount_pct: catchupGap > 0 ? Math.round((1 - catchupDiscount) * 100) : undefined,
    next_signature: nextSignatureDef
      ? { id: nextSignatureDef.signature_id, name: nextSignatureDef.name, description: nextSignatureDef.description }
      : undefined,
    readiness: preview.readiness,
  };
}
