/**
 * Effective continent (region) reinforcement bonus for a given player count.
 *
 * Mirrors the backend `scaleRegionBonus` EXACTLY: continent bonuses scale by
 * active player count relative to a 6-player reference, so smaller games don't
 * over-reward full-region control (holding a whole region is far more common
 * with fewer players). At 6 players the bonus is unscaled; at 4 players a raw +4
 * becomes +2; at 2 players +1. A held region is never worth +0: the scaled
 * value floors at +1.
 *
 * Keep in sync with
 * backend/src/game-engine/combat/combatResolver.ts → scaleRegionBonus.
 */
export function effectiveContinentBonus(rawBonus: number, playerCount: number): number {
  if (rawBonus <= 0) return 0;
  const pc = Math.max(2, Math.min(playerCount, 12));
  return Math.max(1, Math.floor((rawBonus * pc) / 6));
}

/** True when player-count scaling makes the effective bonus differ from raw. */
export function isContinentBonusScaled(rawBonus: number, playerCount: number): boolean {
  return effectiveContinentBonus(rawBonus, playerCount) !== rawBonus;
}

/**
 * A region pays only with at least this many of its territories on the board:
 * one territory alone is never a region, on a growing board before its second
 * territory unlocks or on a map that authored one.
 *
 * Keep in sync with
 * backend/src/game-engine/state/regionsOnBoard.ts → MIN_REGION_TERRITORIES.
 */
export const MIN_REGION_TERRITORIES = 2;

/**
 * What a region pays its holder on this board: nothing with fewer than
 * MIN_REGION_TERRITORIES of its territories on the board, else the
 * table-scaled bonus. `territoriesOnBoard` counts only the territories in
 * play (a growing board's locked frontier is not on it).
 */
export function regionBonusOnBoard(rawBonus: number, territoriesOnBoard: number, playerCount: number): number {
  if (territoriesOnBoard < MIN_REGION_TERRITORIES) return 0;
  return effectiveContinentBonus(rawBonus, playerCount);
}
