import type { GameState, PlayerState } from '../store/gameStore';
import {
  getTerritoryPanelAbilities as getTechTerritoryAbilities,
  getGlobalPanelAbilities as getTechGlobalAbilities,
} from './techAbilities';
import {
  getFactionTerritoryAbilities,
  getFactionGlobalAbilities,
} from './factionAbilities';

/**
 * All territory-targeted abilities (tech + faction) for the current phase and
 * context.
 *
 * `lunarTilesOwned` carries the Moon's own powers, which answer to ground held
 * rather than to a tech. It is also why the tech branch below is entered even
 * with tech trees off: Lunar Export and Orbital Drop are not tech abilities,
 * and a Lunar Pioneer in a no-tech game still holds the Moon.
 */
export function getPlayerTerritoryAbilities(
  gameState: GameState,
  player: PlayerState,
  techTree: Array<{ tech_id: string; unlocks_ability?: string }>,
  context: { isEnemy: boolean; isMine: boolean; isUnowned?: boolean },
  lunarTilesOwned = 0,
): string[] {
  const ids = new Set<string>();
  if (gameState.settings.tech_trees_enabled || lunarTilesOwned > 0) {
    for (const id of getTechTerritoryAbilities(gameState, player, techTree, context, lunarTilesOwned)) {
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
  lunarTilesOwned = 0,
): string[] {
  const ids = new Set<string>();
  if (gameState.settings.tech_trees_enabled || lunarTilesOwned > 0) {
    for (const id of getTechGlobalAbilities(gameState, player, techTree, lunarTilesOwned)) {
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
