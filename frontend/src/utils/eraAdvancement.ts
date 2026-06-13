import type { GameState, PlayerState } from '../store/gameStore';

/**
 * Era advancement display helpers. All gate math (cost, tech tiers, stability)
 * is server-authoritative: the backend attaches a viewer-scoped
 * `era_advancement_preview` to every `game:state` payload and broadcasts the
 * spine snapshot as `era_spine`. This module only reshapes that data for the
 * UI — it deliberately contains no mirrored rules or tech-tier tables.
 */

export type EraAdvancementTechGateMode = 'milestone' | 'percent';

/** Era id at `index` along the match's spine snapshot, clamped to the final step. */
export function getEraIdForAdvancementIndex(gameState: GameState, index: number): string {
  const steps = gameState.era_spine ?? [];
  if (steps.length === 0) return gameState.era;
  const clamped = Math.min(Math.max(index, 0), steps.length - 1);
  return steps[clamped].era_id;
}

/** Which era's tech tree / rules apply to this player right now. */
export function resolvePlayerTechEraId(
  gameState: GameState,
  player: PlayerState | null | undefined,
): string {
  if (!gameState.settings.era_advancement_enabled || !player) return gameState.era;
  return getEraIdForAdvancementIndex(gameState, player.current_era_index ?? 0);
}

export interface AdvanceEraClientStatus {
  enabled: boolean;
  atMaxEra: boolean;
  canPhase: boolean;
  cost: number;
  gold: number;
  gateMode: EraAdvancementTechGateMode;
  techUnlocked: number;
  techRequired: number;
  techMet: boolean;
  tier1Met: boolean;
  tier1Current: number;
  tier1Required: number;
  tier2Met: boolean;
  tier2Current: number;
  tier2Required: number;
  buildingsMet: boolean;
  buildingsCurrent: number;
  buildingsRequired: number;
  stability?: number;
  stabilityGate?: number;
  stabilityMet: boolean;
  goldMet: boolean;
  blockers: string[];
  ready: boolean;
  currentEraId: string;
  nextEraId: string;
}

/**
 * Reshape the server's era advancement preview into the panel/banner status.
 * Only phase and turn awareness are layered in client-side; every gate value
 * comes from the server. Returns null when the mode is off or no preview has
 * arrived yet (e.g. mid-deploy against an older server).
 */
export function getAdvanceEraClientStatus(
  gameState: GameState,
  player: PlayerState | null | undefined,
): AdvanceEraClientStatus | null {
  if (!gameState.settings.era_advancement_enabled || !player) return null;
  const preview = gameState.era_advancement_preview;
  if (!preview) return null;

  const atMaxEra = preview.current_era_index >= preview.max_era_index;
  const canPhase = gameState.phase === 'draft' || gameState.phase === 'attack';
  const cost = preview.cost;
  const gold = player.special_resource ?? 0;
  const gateMode = preview.gate_mode;
  const readiness = preview.readiness;

  const tier1Current = readiness?.tier1?.current ?? 0;
  const tier1Required = readiness?.tier1?.required ?? 0;
  const tier2Current = readiness?.tier2?.current ?? 0;
  const tier2Required = readiness?.tier2?.required ?? 0;
  const buildingsCurrent = readiness?.buildings?.current ?? 0;
  const buildingsRequired = readiness?.buildings?.required ?? 0;
  const techUnlocked = readiness?.percent?.unlocked ?? 0;
  const techRequired = readiness?.percent?.required ?? 0;

  const tier1Met = readiness?.tier1?.met ?? true;
  const tier2Met = readiness?.tier2?.met ?? true;
  const buildingsMet = readiness?.buildings?.met ?? true;
  const techMet = readiness?.met ?? true;

  const stability = preview.stability;
  const stabilityGate = preview.stability_gate;
  const stabilityMet = stabilityGate == null || (stability ?? 0) >= stabilityGate;
  const goldMet = gold >= cost && cost > 0;

  const blockers: string[] = [];
  if (atMaxEra) blockers.push('Already at maximum era');
  if (!canPhase) blockers.push('Available during Reinforcement or Attack phase');
  if (readiness && !readiness.met) {
    if (gateMode === 'percent') {
      blockers.push(`Research ${techRequired} technologies (${techUnlocked}/${techRequired})`);
    } else {
      if (!tier1Met) {
        blockers.push(`Research ${tier1Required} tier-1 technologies (${tier1Current}/${tier1Required})`);
      }
      if (!tier2Met) {
        blockers.push(`Research at least ${tier2Required} tier-2 technolog${tier2Required === 1 ? 'y' : 'ies'} (${tier2Current}/${tier2Required})`);
      }
      if (!buildingsMet) {
        blockers.push(`Build at least ${buildingsRequired} building${buildingsRequired === 1 ? '' : 's'} (${buildingsCurrent}/${buildingsRequired})`);
      }
    }
  }
  if (!stabilityMet && stabilityGate != null) {
    blockers.push(`Empire stability ${Math.round(stability ?? 0)}% (need ${stabilityGate}%)`);
  }
  if (cost <= 0) blockers.push('Wait for production income on your next turn');
  else if (!goldMet) blockers.push(`Need ${cost} gold (have ${gold})`);

  return {
    enabled: true,
    atMaxEra,
    canPhase,
    cost,
    gold,
    gateMode,
    techUnlocked,
    techRequired,
    techMet,
    tier1Met,
    tier1Current,
    tier1Required,
    tier2Met,
    tier2Current,
    tier2Required,
    buildingsMet,
    buildingsCurrent,
    buildingsRequired,
    stability,
    stabilityGate,
    stabilityMet,
    goldMet,
    blockers,
    // cost > 0 mirrors the legacy client rule: a free advance (no income yet)
    // stays locked even though the server's gold gate trivially passes.
    ready: canPhase && cost > 0 && preview.can_advance,
    currentEraId: preview.current_era_id,
    nextEraId: preview.next_era_id,
  };
}
