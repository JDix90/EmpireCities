// ============================================================
// Tech Manager — technology tree research, passive bonuses
// ============================================================

import type { EraId, GameState, PlayerState } from '../../types';
import type { TechNode } from '../eras/types';
import { getEraTechTree, getTechNodeById } from '../eras';
import { getPlayerFaction } from '../eras/factionLineage';
import { resolvePlayerEraId } from '../eraAdvancement/constants';
import { getTechEchoBonus } from '../eraAdvancement/techEcho';
import { getWonderTechCostMultiplier } from './wonderManager';

function getPlayerTechEra(state: GameState, playerId: string): EraId {
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return state.era;
  return resolvePlayerEraId(state, player);
}

/** Era-specific tech tree for a player (respects per-player era when advancement is on). */
export function getEraTechTreeForPlayer(state: GameState, playerId: string): TechNode[] {
  return getEraTechTree(getPlayerTechEra(state, playerId));
}

// ── Research ──────────────────────────────────────────────────────────────────

export interface ResearchValidationResult {
  valid: boolean;
  error?: string;
  node?: TechNode;
}

/**
 * Validate whether a player can research a tech node.
 *
 * Rules:
 * - tech_trees_enabled must be true.
 * - Tech node must exist for this era.
 * - Player must not already have it unlocked.
 * - Prerequisite (if any) must be unlocked first.
 * - Player must have enough tech_points.
 */
export function validateResearch(
  state: GameState,
  playerId: string,
  techId: string
): ResearchValidationResult {
  if (!state.settings.tech_trees_enabled) {
    return { valid: false, error: 'Technology trees are not enabled for this game' };
  }

  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return { valid: false, error: 'Player not found' };

  const playerEra = getPlayerTechEra(state, playerId);
  const node = getTechNodeById(playerEra, techId);
  if (!node) {
    return { valid: false, error: `Tech node '${techId}' does not exist for era '${playerEra}'` };
  }

  const unlocked = player.unlocked_techs ?? [];
  if (unlocked.includes(techId)) {
    return { valid: false, error: 'Technology already researched' };
  }

  if (node.prerequisite && !unlocked.includes(node.prerequisite)) {
    return { valid: false, error: `Must research '${node.prerequisite}' first` };
  }

  const techPoints = player.tech_points ?? 0;
  const effectiveCost = getEffectiveTechCost(state, player, node);
  if (techPoints < effectiveCost) {
    return { valid: false, error: `Not enough tech points (need ${effectiveCost}, have ${techPoints})` };
  }

  return { valid: true, node };
}

/**
 * Effective research cost for a player: wonder multiplier (economy), then the
 * one-shot House of Wisdom discount and the faction research discount
 * (e.g. Stellar Mandate), floored at 1. Single source of truth for
 * validateResearch and applyResearch.
 */
export function getEffectiveTechCost(state: GameState, player: PlayerState, node: TechNode): number {
  const costMultiplier = state.settings.economy_enabled
    ? getWonderTechCostMultiplier(state, player.player_id)
    : 1;
  let factionDiscount = 0;
  if (state.settings.factions_enabled && player.faction_id) {
    factionDiscount = getPlayerFaction(state, player)?.tech_cost_discount ?? 0;
  }
  return Math.max(1, Math.ceil(node.cost * costMultiplier) - (player.pending_tech_discount ?? 0) - factionDiscount);
}

/**
 * Apply a researched tech node: deduct cost, mark unlocked, apply immediate effects.
 */
export function applyResearch(
  state: GameState,
  playerId: string,
  node: TechNode
): void {
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return;

  const effectiveCost = getEffectiveTechCost(state, player, node);
  player.tech_points = (player.tech_points ?? 0) - effectiveCost;
  // House of Wisdom: the discount applies to a single research, then clears.
  if (player.pending_tech_discount) player.pending_tech_discount = 0;
  if (!player.unlocked_techs) player.unlocked_techs = [];
  player.unlocked_techs.push(node.tech_id);

  // Apply immediate passive bonuses
  if (node.reinforce_bonus) {
    // Stored for next draft calculation — nothing to change in state immediately,
    // getPlayerReinforceBonus reads unlocked_techs each turn.
  }
}

// ── Passive Bonus Computation ─────────────────────────────────────────────────

/**
 * Compute cumulative passive attack dice bonus from all tech nodes unlocked by a player.
 */
export function getPlayerAttackBonus(state: GameState, playerId: string): number {
  if (!state.settings.tech_trees_enabled) return 0;
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return 0;
  const unlocked = player.unlocked_techs ?? [];
  const tree = getEraTechTree(getPlayerTechEra(state, playerId));
  const fromTech = unlocked.reduce((sum, tid) => {
    const node = tree.find((n) => n.tech_id === tid);
    return sum + (node?.attack_bonus ?? 0);
  }, 0);
  return fromTech + getTechEchoBonus(state, player, 'attack_bonus');
}

/**
 * Compute cumulative passive defense dice bonus from all tech nodes unlocked by a player.
 */
export function getPlayerDefenseBonus(state: GameState, playerId: string): number {
  if (!state.settings.tech_trees_enabled) return 0;
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return 0;
  const unlocked = player.unlocked_techs ?? [];
  const tree = getEraTechTree(getPlayerTechEra(state, playerId));
  const fromTech = unlocked.reduce((sum, tid) => {
    const node = tree.find((n) => n.tech_id === tid);
    return sum + (node?.defense_bonus ?? 0);
  }, 0);
  return fromTech + getTechEchoBonus(state, player, 'defense_bonus');
}

/**
 * Compute total extra reinforcements per turn from unlocked tech nodes + faction passive.
 */
export function getPlayerReinforceBonus(state: GameState, playerId: string): number {
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return 0;

  let bonus = 0;

  // Faction passive reinforce bonus
  if (state.settings.factions_enabled && player.faction_id) {
    const faction = getPlayerFaction(state, player);
    if (faction) bonus += faction.reinforce_bonus ?? 0;
  }

  // Tech node reinforce bonuses
  if (state.settings.tech_trees_enabled) {
    const unlocked = player.unlocked_techs ?? [];
    const tree = getEraTechTree(getPlayerTechEra(state, playerId));
    bonus += unlocked.reduce((sum, tid) => {
      const node = tree.find((n) => n.tech_id === tid);
      return sum + (node?.reinforce_bonus ?? 0);
    }, 0);
    bonus += getTechEchoBonus(state, player, 'reinforce_bonus');
  }

  return bonus;
}

/**
 * Compute total tech point income per turn from unlocked tech nodes.
 */
export function getPlayerTechPointIncome(state: GameState, playerId: string): number {
  if (!state.settings.tech_trees_enabled) return 0;
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return 0;
  const unlocked = player.unlocked_techs ?? [];
  const tree = getEraTechTree(getPlayerTechEra(state, playerId));
  const fromTech = unlocked.reduce((sum, tid) => {
    const node = tree.find((n) => n.tech_id === tid);
    return sum + (node?.tech_point_income ?? 0);
  }, 0);
  return fromTech + getTechEchoBonus(state, player, 'tech_point_income');
}

/**
 * Apply tech point income to a player at the start of their turn.
 * (Called alongside collectProduction in advanceToNextPlayer.)
 */
export function applyTechPointIncome(state: GameState, playerId: string): number {
  const income = getPlayerTechPointIncome(state, playerId);
  if (income <= 0) return 0;
  const player = state.players.find((p) => p.player_id === playerId);
  if (player) {
    player.tech_points = (player.tech_points ?? 0) + income;
  }
  return income;
}
