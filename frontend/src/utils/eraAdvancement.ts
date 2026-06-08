import type { GameState, PlayerState, TerritoryState } from '../store/gameStore';

/** PoC advancement spine — mirrors backend ERA_ADVANCEMENT_SEQUENCE. */
const ERA_ADVANCEMENT_SEQUENCE = ['ancient', 'medieval'] as const;
/** PoC era trees are 12 nodes each; used for client-side gate preview only. */
const ERA_TECH_TREE_SIZES: Record<string, number> = {
  ancient: 12,
  medieval: 12,
};

export function getEraIdForAdvancementIndex(index: number): string {
  return ERA_ADVANCEMENT_SEQUENCE[index] ?? ERA_ADVANCEMENT_SEQUENCE[ERA_ADVANCEMENT_SEQUENCE.length - 1];
}

/** Which era's tech tree / rules apply to this player right now. */
export function resolvePlayerTechEraId(
  gameState: GameState,
  player: PlayerState | null | undefined,
): string {
  if (!gameState.settings.era_advancement_enabled || !player) return gameState.era;
  return getEraIdForAdvancementIndex(player.current_era_index ?? 0);
}

export function computeClientAdvanceCost(gameState: GameState, player: PlayerState): number {
  const fromIndex = player.current_era_index ?? 0;
  const mult = gameState.settings.era_advancement_cost_mult ?? 2;
  const escalation = gameState.settings.era_advancement_cost_escalation ?? 1.5;
  const income = player.last_turn_production_income ?? 0;
  return Math.ceil(income * mult * escalation ** fromIndex);
}

export function getEmpireWeightedStability(
  territories: Record<string, TerritoryState>,
  playerId: string,
): number {
  let weightedSum = 0;
  let popSum = 0;
  for (const territory of Object.values(territories)) {
    if (territory.owner_id !== playerId || territory.stability == null) continue;
    const pop = Math.max(1, territory.population ?? 1);
    weightedSum += territory.stability * pop;
    popSum += pop;
  }
  return popSum > 0 ? weightedSum / popSum : 100;
}

export interface AdvanceEraClientStatus {
  enabled: boolean;
  atMaxEra: boolean;
  canPhase: boolean;
  cost: number;
  gold: number;
  techUnlocked: number;
  techRequired: number;
  techMet: boolean;
  stability?: number;
  stabilityGate?: number;
  stabilityMet: boolean;
  goldMet: boolean;
  blockers: string[];
  ready: boolean;
  currentEraId: string;
  nextEraId: string;
}

export function getAdvanceEraClientStatus(
  gameState: GameState,
  player: PlayerState | null | undefined,
): AdvanceEraClientStatus | null {
  if (!gameState.settings.era_advancement_enabled || !player) return null;

  const currentIndex = player.current_era_index ?? 0;
  const maxIndex = gameState.settings.era_advancement_max_era_index ?? 1;
  const atMaxEra = currentIndex >= maxIndex;
  const canPhase = gameState.phase === 'draft' || gameState.phase === 'attack';
  const cost = computeClientAdvanceCost(gameState, player);
  const gold = player.special_resource ?? 0;
  const techGatePct = gameState.settings.era_advancement_tech_gate_pct ?? 0.25;
  const departingEraId = getEraIdForAdvancementIndex(player.current_era_index ?? 0);
  const treeSize = ERA_TECH_TREE_SIZES[departingEraId] ?? 12;
  const techRequired = gameState.settings.tech_trees_enabled
    ? Math.ceil(treeSize * techGatePct)
    : 0;
  const techUnlocked = (player.unlocked_techs ?? []).length;
  const techMet = !gameState.settings.tech_trees_enabled || techUnlocked >= techRequired;
  const stabilityGate = gameState.settings.stability_enabled ? 60 : undefined;
  const stability = gameState.settings.stability_enabled
    ? getEmpireWeightedStability(gameState.territories, player.player_id)
    : undefined;
  const stabilityMet = stabilityGate == null || (stability ?? 0) >= stabilityGate;
  const goldMet = gold >= cost && cost > 0;
  const blockers: string[] = [];
  if (atMaxEra) blockers.push('Already at maximum era');
  if (!canPhase) blockers.push('Available during Reinforcement or Attack phase');
  if (!techMet) blockers.push(`Research ${techRequired} technologies (${techUnlocked}/${techRequired})`);
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
    techUnlocked,
    techRequired,
    techMet,
    stability,
    stabilityGate,
    stabilityMet,
    goldMet,
    blockers,
    ready: !atMaxEra && canPhase && techMet && stabilityMet && goldMet,
    currentEraId: getEraIdForAdvancementIndex(currentIndex),
    nextEraId: getEraIdForAdvancementIndex(currentIndex + 1),
  };
}
