/**
 * The turn clock of a game the lobby builds for one player against bots —
 * Quick Match (the first match included) and Full Game (`solo_untimed_enabled`).
 *
 * Nobody waits on a solo player. One who leaves is already handled: the seat
 * waits for them (the away-AI covers a seat only while another human is at
 * the table) and the game is closed as abandoned once it sits idle. So the
 * clock only ended turns for players still at the screen — reading, thinking,
 * or stuck — 72 times in 30 days, more often than solo games finished.
 *
 * Custom Game is not one of these: it opens a room other players can join, so
 * its Turn Timer stays what the host picks.
 */
export const SOLO_TIMED_TURN_SECONDS = 300;

export function soloTurnTimerSeconds(soloUntimed: boolean): number {
  return soloUntimed ? 0 : SOLO_TIMED_TURN_SECONDS;
}
