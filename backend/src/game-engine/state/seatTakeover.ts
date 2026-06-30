import type { PlayerState } from '../../types';

/**
 * Away-seat transitions, factored out of the socket layer so the core rules are
 * unit-testable in isolation.
 *
 * When a human disconnects their seat is marked *away* (not converted to AI):
 * `is_ai` stays false so they always read as a human who is temporarily absent,
 * the AI merely covers their turns, and they reclaim instantly on reconnect.
 * `away_since` (disconnect time, ms) gates a short reconnect window before the AI
 * starts playing, and survives restarts because it lives in the persisted state.
 */

/** Reconnect window (ms) an away player's turn waits before the AI plays it. */
export const AWAY_AI_GRACE_MS = 45_000;

/** Mark a disconnected human's seat as away. No-op for AI/eliminated seats. */
export function markPlayerAway(player: PlayerState, now: number): boolean {
  if (player.is_ai || player.is_eliminated || player.is_away) return false;
  player.is_away = true;
  player.away_since = now;
  return true;
}

/** Whether this seat is an away human that can be reclaimed on return. */
export function canReclaimSeat(player: PlayerState): boolean {
  return !!player.is_away && !player.is_eliminated;
}

/**
 * Hand an away seat back to the returning human. Returns true when something
 * actually changed (so callers persist/broadcast only then); AI and non-away
 * seats are left untouched.
 */
export function applySeatReclaim(player: PlayerState): boolean {
  if (!player.is_away) return false;
  player.is_away = false;
  player.away_since = null;
  return true;
}

/**
 * Should the AI cover this away seat's *current* turn yet? True once the reconnect
 * window has elapsed since the player went away. Computed from the persisted
 * `away_since`, so it's correct even across a server restart (no in-memory timer
 * is authoritative). Returns false (with a positive remaining ms) during the
 * window so the caller can wait that long before re-checking.
 */
export function awayAiShouldPlay(
  player: PlayerState,
  now: number,
  graceMs: number = AWAY_AI_GRACE_MS,
): { play: boolean; remainingMs: number } {
  if (!player.is_away) return { play: false, remainingMs: 0 };
  const since = player.away_since ?? now;
  const elapsed = now - since;
  if (elapsed >= graceMs) return { play: true, remainingMs: 0 };
  return { play: false, remainingMs: graceMs - elapsed };
}
