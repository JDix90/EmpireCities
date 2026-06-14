/**
 * Effective continent (region) reinforcement bonus for a given player count.
 *
 * Mirrors the backend `calculateReinforcements` scaling EXACTLY: continent
 * bonuses scale by active player count relative to a 6-player reference, so
 * smaller games don't over-reward full-region control (holding a whole region is
 * far more common with fewer players). At 6 players the bonus is unscaled; at 4
 * players a raw +4 becomes +2; at 2 players +1.
 *
 * Keep in sync with
 * backend/src/game-engine/combat/combatResolver.ts → calculateReinforcements.
 */
export function effectiveContinentBonus(rawBonus: number, playerCount: number): number {
  const pc = Math.max(2, Math.min(playerCount, 12));
  return Math.floor((rawBonus * pc) / 6);
}

/** True when player-count scaling makes the effective bonus differ from raw. */
export function isContinentBonusScaled(rawBonus: number, playerCount: number): boolean {
  return effectiveContinentBonus(rawBonus, playerCount) !== rawBonus;
}
