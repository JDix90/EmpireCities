/**
 * How much of the map a player holds, measured against the Territory Threshold
 * victory ("control 65% of the map").
 *
 * Quick Match's Blitz (50%) and Conquest (65%) endings, the campaign's stage
 * targets and any Custom Game with the threshold ticked are all won this way,
 * and nothing on screen said how close anyone was. This is what the tracker
 * reads.
 *
 * Mirrors the `threshold` branch of `checkVictory` in
 * `backend/src/game-engine/state/gameStateManager.ts`, which is authoritative:
 * the share is of EVERY territory in the game state, unowned ones included,
 * and the count needed is `Math.ceil((total * threshold) / 100)` — the same
 * expression, so the tracker and the server never disagree about the last
 * territory.
 */

import type { GameState } from '../store/gameStore';
import { allowedVictoryConditions } from './lunarHegemony';

export interface MapControlProgress {
  /** Territories the player holds (the server's `territory_count`). */
  held: number;
  /** Every territory in the game — the denominator the server divides by. */
  total: number;
  /** Share of the map held, rounded DOWN so it never claims a win the server has not given. */
  heldPct: number;
  /** The threshold this game is won at, percent of the map. */
  thresholdPct: number;
  /** Territories that satisfy the threshold. */
  needed: number;
  /** Territories still to take; 0 once the threshold is met. */
  remaining: number;
}

/**
 * The threshold this game can be won at, or null when it cannot be won that
 * way. Normalized as `normalizeGameSettings` does: an integer from 1 to 99.
 */
export function mapControlThreshold(settings: GameState['settings'] | null | undefined): number | null {
  if (!settings || !allowedVictoryConditions(settings).includes('threshold')) return null;
  const raw = settings.victory_threshold;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return Math.max(1, Math.min(99, Math.floor(raw)));
}

/**
 * Progress toward the Territory Threshold for one player, or null when the
 * game has no threshold victory, the viewer is not a live player (spectators,
 * the eliminated), or the board is empty.
 */
export function mapControlProgress(
  gameState: Pick<GameState, 'settings' | 'territories' | 'players'> | null | undefined,
  playerId: string | null | undefined,
): MapControlProgress | null {
  if (!gameState || !playerId) return null;
  const thresholdPct = mapControlThreshold(gameState.settings);
  if (thresholdPct == null) return null;
  const player = gameState.players.find((p) => p.player_id === playerId);
  if (!player || player.is_eliminated) return null;
  const total = Object.keys(gameState.territories).length;
  if (total === 0) return null;
  const held = player.territory_count;
  const needed = Math.ceil((total * thresholdPct) / 100);
  return {
    held,
    total,
    heldPct: Math.floor((held * 100) / total),
    thresholdPct,
    needed,
    remaining: Math.max(0, needed - held),
  };
}
