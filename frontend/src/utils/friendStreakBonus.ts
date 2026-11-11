/**
 * The friend-streak bonus on a win's gold (backend friendStreakService), as
 * game_over's `progression[id].friend_streak_bonus` sends it: the multiplier,
 * the longest streak and the friends it was with.
 */
export interface FriendStreakBonus {
  multiplier: number;
  streak: number;
  friends: string[];
}

/**
 * The bonus as the percentage the results and the share card show: a 1.1×
 * multiplier is +10%. The client read the field as a number while the server
 * sent this object, so `(bonus ?? 0) > 0` was never true and the chip never
 * showed. A bare number is taken as a percentage already.
 */
export function friendStreakPercent(bonus: FriendStreakBonus | number | null | undefined): number {
  if (typeof bonus === 'number') return bonus > 0 ? bonus : 0;
  if (!bonus || typeof bonus.multiplier !== 'number' || bonus.multiplier <= 1) return 0;
  return Math.round((bonus.multiplier - 1) * 100);
}
