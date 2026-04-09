// ============================================================
// Tech Manager — technology tree research, passive bonuses
// ============================================================

import type { GameState, GameMap } from '../../types';
import type { TechNode } from '../eras/types';
import { getEraTechTree, getFactionById, getTechNodeById } from '../eras';
import { getWonderTechCostMultiplier } from './wonderManager';

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

  const node = getTechNodeById(state.era, techId);
  if (!node) {
    return { valid: false, error: `Tech node '${techId}' does not exist for era '${state.era}'` };
  }

  const unlocked = player.unlocked_techs ?? [];
  if (unlocked.includes(techId)) {
    return { valid: false, error: 'Technology already researched' };
  }

  if (node.prerequisite && !unlocked.includes(node.prerequisite)) {
    return { valid: false, error: `Must research '${node.prerequisite}' first` };
  }

  const techPoints = player.tech_points ?? 0;
  const costMultiplier = state.settings.economy_enabled
    ? getWonderTechCostMultiplier(state, playerId)
    : 1;
  const effectiveCost = Math.ceil(node.cost * costMultiplier);
  if (techPoints < effectiveCost) {
    return { valid: false, error: `Not enough tech points (need ${effectiveCost}, have ${techPoints})` };
  }

  return { valid: true, node };
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

  const costMultiplier = state.settings.economy_enabled
    ? getWonderTechCostMultiplier(state, playerId)
    : 1;
  const effectiveCost = Math.ceil(node.cost * costMultiplier);
  player.tech_points = (player.tech_points ?? 0) - effectiveCost;
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
  const tree = getEraTechTree(state.era);
  return unlocked.reduce((sum, tid) => {
    const node = tree.find((n) => n.tech_id === tid);
    return sum + (node?.attack_bonus ?? 0);
  }, 0);
}

/**
 * Compute cumulative passive defense dice bonus from all tech nodes unlocked by a player.
 */
export function getPlayerDefenseBonus(state: GameState, playerId: string): number {
  if (!state.settings.tech_trees_enabled) return 0;
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return 0;
  const unlocked = player.unlocked_techs ?? [];
  const tree = getEraTechTree(state.era);
  return unlocked.reduce((sum, tid) => {
    const node = tree.find((n) => n.tech_id === tid);
    return sum + (node?.defense_bonus ?? 0);
  }, 0);
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
    const faction = getFactionById(state.era, player.faction_id);
    if (faction) bonus += faction.reinforce_bonus ?? 0;
  }

  // Tech node reinforce bonuses
  if (state.settings.tech_trees_enabled) {
    const unlocked = player.unlocked_techs ?? [];
    const tree = getEraTechTree(state.era);
    bonus += unlocked.reduce((sum, tid) => {
      const node = tree.find((n) => n.tech_id === tid);
      return sum + (node?.reinforce_bonus ?? 0);
    }, 0);
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
  const tree = getEraTechTree(state.era);
  return unlocked.reduce((sum, tid) => {
    const node = tree.find((n) => n.tech_id === tid);
    return sum + (node?.tech_point_income ?? 0);
  }, 0);
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
