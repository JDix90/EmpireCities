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
 * territory. In a team game the side's territories count together, as
 * `checkTeamVictory` (backend victory/teamVictory.ts) reads the threshold.
 */

import type { GameState } from '../store/gameStore';
import { allowedVictoryConditions } from './lunarHegemony';
import { allyIdsOf } from './teams';

export interface MapControlProgress {
  /** Territories the player holds (the server's `territory_count`), or their side holds between them. */
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
  /** True in a team game: `held` counts the player's whole side. */
  side?: boolean;
  /**
   * Era-tied conquest (the server's `conquest_status`), in a game that has it.
   * `thresholdPct` and `needed` above are then the share as it stands this
   * round, taken from the server and not worked out here.
   */
  conquest?: {
    /** The share before any fall. */
    basePct: number;
    /** The era the player must reach before the share counts for them; absent once it does. */
    lockedUntilEraId?: string;
    /** The share next round, when it will be lower. */
    nextPct?: number;
    /** The round the share starts to fall, while that is still ahead. */
    fallsFromRound?: number;
    /** A win is claimed only as the holder's own turn opens. */
    claimAtTurnStart: boolean;
    /** The player wins as their next turn opens unless a rival takes territory from them. */
    onCourse: boolean;
    /** Rivals who win as their next turn opens unless someone takes territory from them. */
    rivalsOnCourse: string[];
  };
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
  gameState: (Pick<GameState, 'settings' | 'territories' | 'players'> & Partial<Pick<GameState, 'teams' | 'conquest_status'>>) | null | undefined,
  playerId: string | null | undefined,
): MapControlProgress | null {
  if (!gameState || !playerId) return null;
  const thresholdPct = mapControlThreshold(gameState.settings);
  if (thresholdPct == null) return null;
  const player = gameState.players.find((p) => p.player_id === playerId);
  if (!player || player.is_eliminated) return null;
  const total = Object.keys(gameState.territories).length;
  if (total === 0) return null;
  const allies = allyIdsOf(gameState, playerId);
  const held = gameState.players.reduce(
    (n, p) => (p.player_id === playerId || allies.includes(p.player_id) ? n + p.territory_count : n),
    0,
  );
  // Era-tied conquest: the share moves with the round and the era, so the
  // server's own figures stand in for the settings' fixed one.
  const status = gameState.conquest_status;
  const sharePct = status ? status.share_pct : thresholdPct;
  const needed = status ? status.needed : Math.ceil((total * sharePct) / 100);
  return {
    held,
    total,
    heldPct: Math.floor((held * 100) / total),
    thresholdPct: sharePct,
    needed,
    remaining: Math.max(0, needed - held),
    ...(allies.length > 0 ? { side: true } : {}),
    ...(status
      ? {
        conquest: {
          basePct: status.base_share_pct,
          ...(!status.open_for_viewer && status.required_era_id ? { lockedUntilEraId: status.required_era_id } : {}),
          ...(status.next_share_pct != null ? { nextPct: status.next_share_pct } : {}),
          ...(status.falls_from_round != null ? { fallsFromRound: status.falls_from_round } : {}),
          claimAtTurnStart: status.claim_at_turn_start,
          onCourse: status.on_course_ids.includes(playerId),
          rivalsOnCourse: gameState.players
            .filter((p) => p.player_id !== playerId && status.on_course_ids.includes(p.player_id))
            .map((p) => p.username),
        },
      }
      : {}),
  };
}
