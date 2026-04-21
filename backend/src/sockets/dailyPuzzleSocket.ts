import type { Server } from 'socket.io';
import type { GameState, GameMap } from '../types';
import type { DailyPuzzleSpec } from '../game-engine/daily/dailyPuzzleTypes';
import { evaluatePuzzleObjective, isPuzzleTimedOut } from '../game-engine/daily/puzzleObjective';
import { computePuzzleMoveFeedback } from '../game-engine/daily/puzzleMoveFeedback';

export function getDailyPuzzleSpec(state: GameState): DailyPuzzleSpec | null {
  const raw = state.settings.daily_challenge_spec;
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as unknown as DailyPuzzleSpec;
  return s.archetype ? s : null;
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
