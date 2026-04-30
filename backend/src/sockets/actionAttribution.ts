/**
 * Per-action win-probability attribution.
 *
 * The post-match coaching system used to infer turning points by diffing
 * end-of-turn state snapshots, which conflated the player's choices with luck
 * and opponent moves on the same turn. This module captures the *exact*
 * contribution of each player decision: snap the win probability before the
 * mutation, run the action, snap it again, and record the delta.
 *
 * Storage is in-memory keyed by gameId, mirroring `gameCombatStats`. The log
 * is flushed into `match_insight_reports.insights_json` when the game is
 * finalized, then dropped via `clearDecisionLog`.
 *
 * Design choices:
 *   - Only the human player's actions are logged. AI moves are noise for
 *     coaching the human; capturing them would 4× the log size on a
 *     1-human + 3-AI game.
 *   - The wrapper accepts a synchronous `mutate` thunk and a deferred
 *     `summary` string-builder. The summary is built *after* the mutation
 *     so it can describe outcomes (e.g. "lost 3 attackers, captured Siam").
 *   - A monotonic per-game step counter ensures stable ordering even when
 *     two actions land in the same turn with identical deltas.
 */

import type { GameState, GameMap, ActionDecision, ActionDecisionType } from '../types';
import { computeWinProbabilities } from '../game-engine/state/gameStateManager';

/** Resolves a territory_id to its human-readable name from the map document. */
export function territoryName(map: GameMap, territoryId: string): string {
  return map.territories.find((t) => t.territory_id === territoryId)?.name ?? territoryId;
}

interface DecisionLog {
  decisions: ActionDecision[];
  nextStep: number;
}

const decisionLogs = new Map<string, DecisionLog>();

function ensureLog(gameId: string): DecisionLog {
  let log = decisionLogs.get(gameId);
  if (!log) {
    log = { decisions: [], nextStep: 0 };
    decisionLogs.set(gameId, log);
  }
  return log;
}

/** Returns true if the given player is the (first) human in the game. */
function isHumanPlayer(state: GameState, playerId: string): boolean {
  const human = state.players.find((p) => !p.is_ai);
  return !!human && human.player_id === playerId;
}

/**
 * Captures the human player's current win probability, or null if the action
 * is being taken by an AI / non-human player (in which case nothing should be
 * recorded). Pair with `commitActionDecision`.
 */
export function captureProbBefore(state: GameState, playerId: string): number | null {
  if (!isHumanPlayer(state, playerId)) return null;
  return computeWinProbabilities(state)[playerId] ?? 0;
}

/**
 * Commits a decision row using a previously-captured `probBefore` value. The
 * post-mutation probability is read from the *current* state. No-op if
 * `probBefore` is null (i.e. an AI took the action).
 */
export function commitActionDecision(
  gameId: string,
  state: GameState,
  playerId: string,
  actionType: ActionDecisionType,
  summary: string,
  probBefore: number | null,
): void {
  if (probBefore === null) return;
  const probAfter = computeWinProbabilities(state)[playerId] ?? 0;
  const log = ensureLog(gameId);
  log.decisions.push({
    step: log.nextStep++,
    turn: state.turn_number,
    player_id: playerId,
    action_type: actionType,
    summary,
    prob_before: probBefore,
    prob_after: probAfter,
    prob_delta: probAfter - probBefore,
  });
}

/**
 * Wraps a mutating action so its before/after win-probability is captured.
 *
 * The mutation runs unconditionally; only the *recording* is gated by
 * "is this the human player?" so callers don't need to branch.
 *
 * @param summary  Either a static string or a thunk; thunks see the
 *                 post-mutation state, useful for outcomes like "captured X".
 */
export function recordActionDecision<T>(
  gameId: string,
  state: GameState,
  playerId: string,
  actionType: ActionDecisionType,
  summary: string | (() => string),
  mutate: () => T,
): T {
  const probBefore = captureProbBefore(state, playerId);
  const result = mutate();
  const summaryText = typeof summary === 'function' ? summary() : summary;
  commitActionDecision(gameId, state, playerId, actionType, summaryText, probBefore);
  return result;
}

/** Returns a defensive copy of the decision log (or [] if none). */
export function getDecisionLog(gameId: string): ActionDecision[] {
  const log = decisionLogs.get(gameId);
  return log ? [...log.decisions] : [];
}

/** Clear all decisions for a game (call on finalize / room eviction). */
export function clearDecisionLog(gameId: string): void {
  decisionLogs.delete(gameId);
}

/**
 * Aggregate a decision log into a tiny summary for the post-game Match Stats
 * panel. Returns the player's single best move, single worst move, and the
 * single largest |delta| swing — only including actions whose absolute
 * impact crossed a small minimum so we don't surface noise.
 *
 * Decisions are filtered by `playerId` first; in solo-vs-AI games this
 * resolves to the human's row, but the function is generic so it'll work
 * unchanged for multi-human games once we extend logging beyond the first
 * human.
 */
export interface DecisionSummary {
  best?: ActionDecision;
  worst?: ActionDecision;
  biggest_swing?: ActionDecision;
  total_decisions: number;
}

const DECISION_SUMMARY_MIN_ABS_DELTA = 0.02;

export function summarizeDecisionLog(
  decisions: ActionDecision[],
  playerId: string,
): DecisionSummary {
  const mine = decisions.filter((d) => d.player_id === playerId);
  if (mine.length === 0) return { total_decisions: 0 };

  const meaningful = mine.filter(
    (d) => Math.abs(d.prob_delta) >= DECISION_SUMMARY_MIN_ABS_DELTA,
  );
  if (meaningful.length === 0) return { total_decisions: mine.length };

  let best: ActionDecision | undefined;
  let worst: ActionDecision | undefined;
  let biggest: ActionDecision | undefined;
  for (const d of meaningful) {
    if (!best || d.prob_delta > best.prob_delta) best = d;
    if (!worst || d.prob_delta < worst.prob_delta) worst = d;
    if (!biggest || Math.abs(d.prob_delta) > Math.abs(biggest.prob_delta)) biggest = d;
  }
  return { best, worst, biggest_swing: biggest, total_decisions: mine.length };
}

/** Test/ops helper. */
export function _resetActionAttribution(): void {
  decisionLogs.clear();
}
