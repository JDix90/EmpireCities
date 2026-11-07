import { featureFlags } from '../../config/featureFlags';
import { boardUserSql } from '../../services/statsExclusion';

/**
 * Whose runs the Daily Challenge board ranks, on today's board and the
 * archive's, and so who "N attempted" counts. Never a test account. A guest's
 * run only with guest_daily_board_enabled: a guest identity is one
 * unauthenticated POST away, so a new guest is a fresh set of daily attempts,
 * which is why this board has its own switch. `alias` is the `users` alias.
 */
export function dailyBoardUserSql(alias: string): string {
  return boardUserSql(alias, featureFlags.guestDailyBoardEnabled);
}
