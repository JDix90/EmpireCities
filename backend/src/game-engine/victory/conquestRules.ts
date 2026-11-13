/**
 * Conquest tied to the eras (full_game_ages_ending_enabled).
 *
 * The threshold victory ("hold 65% of the map") is counted on the board in
 * play, and an era-advancement game starts on a third of its board: 22
 * territories win on turn one's 33, 38 on the 57 the eras open. Measured over
 * 52,340 simulated Full Games (docs/full-game-pacing/REPORT.md), that ended one
 * even game in five by round 20 with the winner still in the Ancient era, a
 * strong player's game in 11 rounds, and a two-player game in three; while
 * the games that got past it stood off until a round cap called them.
 *
 * Three settings, baked at create, change what the threshold asks:
 *
 *   conquest_final_era_only        it counts only for a player in the spine's
 *                                  last era, so the winner has played the eras;
 *   conquest_decay_points_per_round, conquest_decay_delay_rounds
 *                                  once any player reaches that era, the share
 *                                  needed holds for the delay and then falls by
 *                                  the points each round, until someone holds
 *                                  it. This is what ends a standoff without a
 *                                  round cap: nobody is handed the game for
 *                                  being ahead when time runs out;
 *   conquest_claim_at_turn_start   a player over the line wins only if still
 *                                  over it as their own next turn opens, so
 *                                  every rival sees it coming and has one turn
 *                                  to take it back (as Lane Sovereignty banks
 *                                  its streak, victory/laneSovereignty.ts).
 *
 * With none of them set, every function here answers exactly what the plain
 * threshold did, so a game created before them is not re-ruled.
 *
 * This file is the single source of truth for "what share wins now, and for
 * whom". checkVictory reads it, and so do the bots' ending play, their
 * resignation and the surrender offer (ai/aiEnding.ts winStandings), so
 * players, bots and the offer agree. A team game's threshold is judged by
 * victory/teamVictory.ts and is not touched: no lobby path creates a team game
 * with these settings.
 */
import type { GameState, PlayerState } from '../../types';
import { getMaxEraIndex } from '../eraAdvancement/spines';
import { getAllowedVictoryConditions } from '../state/gameSettings';

/** The share needed never falls below this: one territory in a hundred. */
const CONQUEST_SHARE_FLOOR = 1;

/** Whether the threshold victory is in play at all, and at what share before any fall. */
function baseSharePct(state: GameState): number | null {
  const raw = state.settings.victory_threshold;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  if (!getAllowedVictoryConditions(state.settings).includes('threshold')) return null;
  return Math.max(1, Math.min(99, Math.floor(raw)));
}

/** Whether any of the era-tied conquest settings governs this game. */
export function erasConquestActive(state: GameState): boolean {
  const s = state.settings;
  return baseSharePct(state) != null && s.era_advancement_enabled === true
    && (s.conquest_final_era_only === true || (s.conquest_decay_points_per_round ?? 0) > 0 || s.conquest_claim_at_turn_start === true);
}

/**
 * The share of the board that wins in round `turnNumber` (the current round by
 * default), in percent, or null when the game cannot be won on a threshold.
 */
export function conquestSharePct(state: GameState, turnNumber: number = state.turn_number): number | null {
  const base = baseSharePct(state);
  if (base == null) return null;
  const points = state.settings.conquest_decay_points_per_round ?? 0;
  const reached = state.final_era_reached_turn;
  if (!(points > 0) || reached == null || state.settings.era_advancement_enabled !== true) return base;
  const delay = state.settings.conquest_decay_delay_rounds ?? 0;
  const fallen = points * Math.max(0, turnNumber - reached - delay);
  return Math.max(CONQUEST_SHARE_FLOOR, base - fallen);
}

/** The territories that share comes to, on the board as it stands. */
export function conquestTerritoriesNeeded(state: GameState, turnNumber: number = state.turn_number): number | null {
  const pct = conquestSharePct(state, turnNumber);
  if (pct == null) return null;
  // Integer maths, as checkVictory always did: `total * (pct / 100)` rounds in
  // binary floating point, so 55% of 100 came out a hair over 55.
  return Math.ceil((Object.keys(state.territories).length * pct) / 100);
}

/** Whether `player` may win on the threshold yet: in the last era, when the game asks for that. */
export function conquestOpenFor(state: GameState, player: PlayerState): boolean {
  if (state.settings.conquest_final_era_only !== true || state.settings.era_advancement_enabled !== true) return true;
  return (player.current_era_index ?? 0) >= getMaxEraIndex(state);
}

/** Whether `player` holds the share that wins in round `turnNumber`, and may win on it. */
export function holdsConquestShare(state: GameState, player: PlayerState, turnNumber: number = state.turn_number): boolean {
  const needed = conquestTerritoriesNeeded(state, turnNumber);
  if (needed == null || player.is_eliminated || !conquestOpenFor(state, player)) return false;
  return (player.territory_count ?? 0) >= needed;
}

/**
 * Whether `player` has won on the threshold. With the claim rule, only the
 * player whose turn opened with the share in hand, and who still has it.
 */
export function hasConquestVictory(state: GameState, player: PlayerState): boolean {
  if (state.settings.conquest_claim_at_turn_start === true && state.conquest_claimant_id !== player.player_id) return false;
  return holdsConquestShare(state, player);
}

/**
 * The hand-off: `playerId`'s turn is opening. Under the claim rule, record
 * whether it opens with the winning share in hand; checkVictory, which every
 * caller runs right after the hand-off, reads the record.
 */
export function tickConquestClaim(state: GameState, playerId: string): void {
  if (state.settings.conquest_claim_at_turn_start !== true) return;
  const player = state.players.find((p) => p.player_id === playerId);
  state.conquest_claimant_id = player && holdsConquestShare(state, player) ? playerId : undefined;
}

/**
 * A player has advanced to `eraIndex`. The first arrival in the spine's last
 * era starts the share falling; recorded only in a game whose share falls.
 */
export function noteEraReached(state: GameState, eraIndex: number): void {
  if (!((state.settings.conquest_decay_points_per_round ?? 0) > 0)) return;
  if (state.final_era_reached_turn != null || eraIndex < getMaxEraIndex(state)) return;
  state.final_era_reached_turn = state.turn_number;
}
