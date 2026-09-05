import type { GameMap, GameState } from '../../types';
import type { DailyPuzzleArchetype, DailyPuzzleSpec } from './dailyPuzzleTypes';

export type PuzzleObjectiveStatus = 'pending' | 'solved' | 'failed';

/**
 * What a verb means, in two parts: how to read the board, and what the clock
 * running out means for it. For every verb that asks the player to DO
 * something, time is failure. For a verb that asks them to KEEP something,
 * time is the win: the objective was pending the whole way, and that was the
 * point.
 */
export interface PuzzleObjectiveDef {
  evaluate: (state: GameState, map: GameMap, spec: DailyPuzzleSpec, humanPlayerId: string) => PuzzleObjectiveStatus;
  onTimeout: 'fail' | 'solve';
}

const humanOwns = (state: GameState, tid: string | undefined, humanPlayerId: string): boolean =>
  !!tid && state.territories[tid]?.owner_id === humanPlayerId;

export const PUZZLE_OBJECTIVES: Record<Exclude<DailyPuzzleArchetype, 'domination'>, PuzzleObjectiveDef> = {
  military_capture: {
    evaluate: (state, _map, spec, humanPlayerId) =>
      humanOwns(state, spec.target_territory_id, humanPlayerId) ? 'solved' : 'pending',
    onTimeout: 'fail',
  },
  hold_territory: {
    // The target starts in human hands. Losing it, even for a turn, is the
    // loss; still holding it when the clock runs out is the win.
    evaluate: (state, _map, spec, humanPlayerId) =>
      humanOwns(state, spec.target_territory_id, humanPlayerId) ? 'pending' : 'failed',
    onTimeout: 'solve',
  },
  economy_build: {
    evaluate: (state, _map, spec, humanPlayerId) => {
      if (!spec.building_type) return 'pending';
      for (const terr of Object.values(state.territories)) {
        if (terr.owner_id !== humanPlayerId) continue;
        if ((terr.buildings ?? []).includes(spec.building_type)) return 'solved';
      }
      return 'pending';
    },
    onTimeout: 'fail',
  },
  tech_research: {
    evaluate: (state, _map, spec, humanPlayerId) => {
      const human = state.players.find((p) => p.player_id === humanPlayerId);
      if (!spec.tech_id || !human) return 'pending';
      return (human.unlocked_techs ?? []).includes(spec.tech_id) ? 'solved' : 'pending';
    },
    onTimeout: 'fail',
  },
};

/**
 * Non-domination puzzle outcomes. Domination uses normal {@link checkVictory}.
 */
export function evaluatePuzzleObjective(
  state: GameState,
  map: GameMap,
  spec: DailyPuzzleSpec,
  humanPlayerId: string,
): PuzzleObjectiveStatus {
  if (spec.archetype === 'domination') return 'pending';

  const human = state.players.find((p) => p.player_id === humanPlayerId);
  if (!human || human.is_eliminated) return 'failed';

  return PUZZLE_OBJECTIVES[spec.archetype]?.evaluate(state, map, spec, humanPlayerId) ?? 'pending';
}

/**
 * Time up — human did not meet goal before max turns (checked after turn advances).
 */
export function isPuzzleTimedOut(state: GameState, spec: DailyPuzzleSpec): boolean {
  if (spec.archetype === 'domination') return false;
  return state.turn_number > spec.max_turns;
}

/** What the clock running out means for this verb. */
export function puzzleTimeoutOutcome(spec: DailyPuzzleSpec): 'fail' | 'solve' {
  if (spec.archetype === 'domination') return 'fail';
  return PUZZLE_OBJECTIVES[spec.archetype]?.onTimeout ?? 'fail';
}
