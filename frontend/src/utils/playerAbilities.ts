import type { GameState, PlayerState } from '../store/gameStore';
import {
  getTerritoryPanelAbilities as getTechTerritoryAbilities,
  getGlobalPanelAbilities as getTechGlobalAbilities,
} from './techAbilities';
import {
  getFactionTerritoryAbilities,
  getFactionGlobalAbilities,
} from './factionAbilities';

/** All territory-targeted abilities (tech + faction) for the current phase and context. */
export function getPlayerTerritoryAbilities(
  gameState: GameState,
  player: PlayerState,
  techTree: Array<{ tech_id: string; unlocks_ability?: string }>,
  context: { isEnemy: boolean; isMine: boolean; isUnowned?: boolean },
): string[] {
  const ids = new Set<string>();
  if (gameState.settings.tech_trees_enabled) {
    for (const id of getTechTerritoryAbilities(gameState, player, techTree, context)) {
      ids.add(id);
    }
  }
  if (gameState.settings.factions_enabled) {
    for (const id of getFactionTerritoryAbilities(gameState, player, context)) {
      ids.add(id);
    }
  }
  return [...ids];
}

/** Self-activated abilities with no territory target (tech + faction). */
export function getPlayerGlobalAbilities(
  gameState: GameState,
  player: PlayerState,
  techTree: Array<{ tech_id: string; unlocks_ability?: string }>,
): string[] {
  const ids = new Set<string>();
  if (gameState.settings.tech_trees_enabled) {
    for (const id of getTechGlobalAbilities(gameState, player, techTree)) {
      ids.add(id);
    }
  }
  if (gameState.settings.factions_enabled) {
    for (const id of getFactionGlobalAbilities(gameState, player)) {
      ids.add(id);
    }
  }
  return [...ids];
}

/** Attack-phase self-buffs that arm on the next land assault. */
export function isAttackSelfBuffAbility(
  abilityId: string,
  def: { phase?: string; enemyTarget?: boolean | null },
): boolean {
  return def.phase === 'attack' && (def.enemyTarget === false || def.enemyTarget === null);
}
