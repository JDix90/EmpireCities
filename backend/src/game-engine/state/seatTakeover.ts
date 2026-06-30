import type { PlayerState } from '../../types';

/**
 * Seat takeover / reclaim flag transitions, factored out of the socket layer so
 * the core rules are unit-testable in isolation.
 *
 * A "takeover" turns a disconnected human's seat over to the AI while keeping a
 * marker (`ai_takeover`) that distinguishes it from an original AI seat, so the
 * human can reclaim control when they reconnect.
 */

/** Mark a disconnected human's seat as AI-driven, reclaimable on return. */
export function markAiTakeover(player: PlayerState): void {
  player.is_ai = true;
  player.ai_difficulty = player.ai_difficulty ?? 'medium';
  player.ai_takeover = true;
}

/** Whether this seat is an AI'd human (not an original AI) that can be reclaimed. */
export function canReclaimSeat(player: PlayerState): boolean {
  return !!player.ai_takeover && !player.is_eliminated;
}

/**
 * Hand a taken-over seat back to the returning human. Returns true when a
 * reclaim actually happened (so callers can persist/broadcast only then);
 * original AI seats and eliminated players are left untouched.
 */
export function applySeatReclaim(player: PlayerState): boolean {
  if (!canReclaimSeat(player)) return false;
  player.is_ai = false;
  player.ai_takeover = false;
  // markAiTakeover defaulted ai_difficulty when it seized the seat; clear it so a
  // reclaimed human carries no stale AI tier (kept in sync with the DB reset).
  player.ai_difficulty = undefined;
  return true;
}
