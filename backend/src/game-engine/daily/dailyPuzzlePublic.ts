/**
 * What a client may see of a Daily v2 day while it is live.
 *
 * The stored v2 block carries the solution (the best line and every graded
 * decision) and the opponent's raw plan. The solution is the answer key and
 * never leaves the server before the day is over; the raw plan is what the
 * intent arrows draw, so it goes out on an arrows day and stays back on a
 * prose day (Friday reads the plan in words only). Used by GET /daily/today
 * directly, and through `redactSettingsForClient` by the game state (live and
 * spectator), the waiting-lobby snapshot, GET /api/games/:id and both replay
 * routes. A new path that hands a client a daily's settings or state goes
 * through that redactor too, or it hands over the answer key.
 */
import type { DailyPuzzleV2, PublicDailyPuzzleV2 } from './dailyPuzzleTypes';

export function toPublicDailyPuzzleV2(v2: DailyPuzzleV2): PublicDailyPuzzleV2 {
  const { solution, plan, ...rest } = v2;
  return {
    ...rest,
    ...(v2.intent === 'arrows' ? { plan } : {}),
    decisions: Array.isArray(solution?.decisions) ? solution.decisions.length : v2.decisions_target,
  };
}
