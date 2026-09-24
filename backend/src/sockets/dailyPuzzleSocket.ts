import type { Server } from 'socket.io';
import type { GameState, GameMap } from '../types';
import type { DailyPuzzleSpec } from '../game-engine/daily/dailyPuzzleTypes';
import { evaluatePuzzleObjective, isPuzzleTimedOut, puzzleTimeoutOutcome } from '../game-engine/daily/puzzleObjective';
import { computePuzzleMoveFeedback } from '../game-engine/daily/puzzleMoveFeedback';

export function getDailyPuzzleSpec(state: GameState): DailyPuzzleSpec | null {
  const raw = state.settings.daily_challenge_spec;
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as unknown as DailyPuzzleSpec;
  return s.archetype ? s : null;
}

/**
 * How a daily run settled, from the human's side. Winning the game is not
 * winning the challenge: on an objective day the objective has to have been
 * met as well, so eliminating the only rival before it is done ends the game
 * in the human's favour and still scores the run as a loss.
 *
 * - `solved`: the objective was met.
 * - `unmet`: the human won the game by another road first — conquest ended it
 *   before the objective was met.
 * - `failed`: the human lost the game, or the objective failed or ran out of time.
 *
 * `outcome` is null on a domination day, where the game's result is the run's.
 */
export interface DailyRunResult {
  won: boolean;
  outcome: 'solved' | 'unmet' | 'failed' | null;
}

export function settleDailyRun(state: GameState, humanPlayerId: string, winnerIds: string[]): DailyRunResult {
  const wonGame = winnerIds.includes(humanPlayerId);
  const spec = getDailyPuzzleSpec(state);
  if (!spec || spec.archetype === 'domination') return { won: wonGame, outcome: null };
  if (!wonGame) return { won: false, outcome: 'failed' };
  return state.puzzle_objective_met === true
    ? { won: true, outcome: 'solved' }
    : { won: false, outcome: 'unmet' };
}

export type FinalizeGameFn = (
  io: Server,
  gameId: string,
  state: GameState,
  winnerIds: string[],
) => void | Promise<void>;

/**
 * Returns true if the game was finalized (puzzle objective solved, time loss, etc.).
 * @param finalizeGame — injected to avoid circular imports with game lifecycle in gameSocket.
 */
export function maybeResolveDailyPuzzle(
  io: Server,
  gameId: string,
  room: { state: GameState; map: GameMap },
  stateBefore: GameState | null,
  actingUserId: string,
  finalizeGame: FinalizeGameFn,
): boolean {
  const { state, map } = room;
  const spec = getDailyPuzzleSpec(state);
  if (!spec || spec.archetype === 'domination') return false;

  const human = state.players.find((p) => !p.is_ai);
  if (!human) return false;

  if (stateBefore && actingUserId === human.player_id) {
    const fb = computePuzzleMoveFeedback(stateBefore, state, map, human.player_id, spec);
    if (fb) {
      if (fb.tier === 'risky') {
        state.puzzle_feedback_mistakes = (state.puzzle_feedback_mistakes ?? 0) + 1;
      }
      io.to(gameId).emit('game:puzzle_feedback', { ...fb, gameId });
    }
  }

  const status = evaluatePuzzleObjective(state, map, spec, human.player_id);
  if (status === 'solved') {
    state.puzzle_objective_met = true;
    state.phase = 'game_over';
    state.winner_id = human.player_id;
    state.winner_ids = [human.player_id];
    state.victory_condition = 'domination';
    void finalizeGame(io, gameId, state, [human.player_id]);
    return true;
  }

  if (status === 'failed') {
    const ai = state.players.find((p) => p.is_ai);
    if (ai) {
      state.puzzle_objective_met = false;
      state.phase = 'game_over';
      state.winner_id = ai.player_id;
      state.winner_ids = [ai.player_id];
      state.victory_condition = 'last_standing';
      void finalizeGame(io, gameId, state, [ai.player_id]);
      return true;
    }
  }

  if (isPuzzleTimedOut(state, spec)) {
    // For a "keep it" verb the clock IS the win: the objective stayed pending
    // (still held) all the way to the end.
    if (puzzleTimeoutOutcome(spec) === 'solve' && status === 'pending') {
      state.puzzle_objective_met = true;
      state.phase = 'game_over';
      state.winner_id = human.player_id;
      state.winner_ids = [human.player_id];
      state.victory_condition = 'domination';
      void finalizeGame(io, gameId, state, [human.player_id]);
      return true;
    }
    const ai = state.players.find((p) => p.is_ai);
    if (ai) {
      state.puzzle_objective_met = false;
      state.phase = 'game_over';
      state.winner_id = ai.player_id;
      state.winner_ids = [ai.player_id];
      state.victory_condition = 'last_standing';
      void finalizeGame(io, gameId, state, [ai.player_id]);
      return true;
    }
  }

  return false;
}
