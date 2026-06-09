import type { GameState, PlayerState, TerritoryState } from '../store/gameStore';

/** PoC advancement spine — mirrors backend ERA_ADVANCEMENT_SEQUENCE. */
const ERA_ADVANCEMENT_SEQUENCE = ['ancient', 'medieval'] as const;

/** Tech tier lookup for client-side milestone gate preview (mirrors backend era trees). */
const ERA_TECH_TIERS: Record<string, Record<string, number>> = {
  ancient: {
    ancient_iron_weapons: 1,
    ancient_stone_walls: 1,
    ancient_granaries: 1,
    ancient_roads: 1,
    ancient_siege_engines: 2,
    ancient_fortified_camps: 2,
    ancient_trade_routes: 2,
    ancient_cavalry: 2,
    ancient_legion_tactics: 3,
    ancient_fortresses: 3,
    ancient_great_library: 3,
    ancient_pax_romana: 4,
  },
  medieval: {
    medieval_feudalism: 1,
    medieval_castle_keep: 1,
    medieval_guilds: 1,
    medieval_metallurgy: 1,
    medieval_siege_warfare: 2,
    medieval_concentric_castle: 2,
    medieval_banking: 2,
    medieval_chivalry: 2,
    medieval_gunpowder: 3,
    medieval_citadel: 3,
    medieval_renaissance: 3,
    medieval_dominion: 4,
  },
};

export type EraAdvancementTechGateMode = 'milestone' | 'percent';

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

function countUnlockedTechsByTier(
  gameState: GameState,
  player: PlayerState,
  minTier: number,
  maxTier: number,
): number {
  const eraId = resolvePlayerTechEraId(gameState, player);
  const tiers = ERA_TECH_TIERS[eraId] ?? {};
  const unlocked = player.unlocked_techs ?? [];
  return unlocked.filter((techId) => {
    const tier = tiers[techId];
    return tier != null && tier >= minTier && tier <= maxTier;
  }).length;
}

function countClientPlayerBuildings(
  territories: Record<string, TerritoryState>,
  playerId: string,
): number {
  let count = 0;
  for (const territory of Object.values(territories)) {
    if (territory.owner_id !== playerId) continue;
    for (const building of territory.buildings ?? []) {
      if (!building.startsWith('wonder_')) count += 1;
    }
  }
  return count;
}

function resolveTechGateMode(gameState: GameState): EraAdvancementTechGateMode {
  return gameState.settings.era_advancement_tech_gate_mode === 'percent' ? 'percent' : 'milestone';
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
  const gateMode = resolveTechGateMode(gameState);

  const tier1Required = gameState.settings.era_advancement_min_tier1_techs ?? 3;
  const tier2Required = gameState.settings.era_advancement_min_tier2_techs ?? 1;
  const buildingsRequired = gameState.settings.era_advancement_min_buildings ?? 1;

  const tier1Current = countUnlockedTechsByTier(gameState, player, 1, 1);
  const tier2Current = countUnlockedTechsByTier(gameState, player, 2, 2);
  const buildingsCurrent = countClientPlayerBuildings(gameState.territories, player.player_id);

  let techUnlocked = 0;
  let techRequired = 0;
  let techMet = true;
  let tier1Met = true;
  let tier2Met = true;
  let buildingsMet = true;

  if (gameState.settings.tech_trees_enabled) {
    if (gateMode === 'percent') {
      const departingEraId = resolvePlayerTechEraId(gameState, player);
      const treeSize = Object.keys(ERA_TECH_TIERS[departingEraId] ?? {}).length || 12;
      const techGatePct = gameState.settings.era_advancement_tech_gate_pct ?? 0.33;
      techRequired = Math.ceil(treeSize * techGatePct);
      techUnlocked = (player.unlocked_techs ?? []).length;
      techMet = techUnlocked >= techRequired;
    } else {
      tier1Met = tier1Current >= tier1Required;
      tier2Met = tier2Current >= tier2Required;
      buildingsMet = buildingsCurrent >= buildingsRequired;
      techMet = tier1Met && tier2Met && buildingsMet;
    }
  }

  const stabilityGate = gameState.settings.stability_enabled
    ? (gameState.settings.era_advancement_stability_gate ?? 60)
    : undefined;
  const stability = gameState.settings.stability_enabled
    ? getEmpireWeightedStability(gameState.territories, player.player_id)
    : undefined;
  const stabilityMet = stabilityGate == null || (stability ?? 0) >= stabilityGate;
  const goldMet = gold >= cost && cost > 0;
  const blockers: string[] = [];
  if (atMaxEra) blockers.push('Already at maximum era');
  if (!canPhase) blockers.push('Available during Reinforcement or Attack phase');
  if (gameState.settings.tech_trees_enabled) {
    if (gateMode === 'percent' && !techMet) {
      blockers.push(`Research ${techRequired} technologies (${techUnlocked}/${techRequired})`);
    } else if (gateMode === 'milestone') {
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
    ready: !atMaxEra && canPhase && techMet && stabilityMet && goldMet,
    currentEraId: getEraIdForAdvancementIndex(currentIndex),
    nextEraId: getEraIdForAdvancementIndex(currentIndex + 1),
  };
}
