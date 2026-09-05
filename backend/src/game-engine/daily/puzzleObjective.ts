import type { GameMap, GameState } from '../../types';
import type { DailyPuzzleArchetype, DailyPuzzleSpec } from './dailyPuzzleTypes';

export type PuzzleObjectiveStatus = 'pending' | 'solved' | 'failed';

/**
 * What a verb means, in three parts: the condition the board has to satisfy,
 * whether satisfying it once is enough or it has to survive the AI's reply,
 * and what the clock running out means.
 *
 * "Achieve and hold" is the difference between a puzzle and a dice roll. A
 * capture that counts the instant the target falls never lets the relief
 * column move, so the authored tension — win with enough left to hold it —
 * was never tested. With `holdThroughAiTurn` the condition has to be true at
 * the start of the player's NEXT turn: the AI gets its counterattack, and
 * strike-now-or-mass-first becomes a real decision.
 *
 * For the verbs that ask the player to DO something, time is failure. For
 * the verb that asks them to KEEP something, time is the win.
 */
export interface PuzzleObjectiveDef {
  condition: (state: GameState, map: GameMap, spec: DailyPuzzleSpec, humanPlayerId: string) => boolean;
  /** True: solved only once the condition has survived an AI turn. */
  holdThroughAiTurn: boolean;
  /** For hold verbs: the condition lapsing is the loss, not a setback. */
  lapseIsFailure: boolean;
  onTimeout: 'fail' | 'solve';
}

const humanOwns = (state: GameState, tid: string | undefined, humanPlayerId: string): boolean =>
  !!tid && state.territories[tid]?.owner_id === humanPlayerId;

/** Territory ids that belong to a map region. */
export function regionTerritoryIds(map: GameMap, regionId: string): string[] {
  const list = Array.isArray(map.territories) ? map.territories : Object.values(map.territories ?? {});
  return (list as Array<{ territory_id: string; region_id?: string }>)
    .filter((t) => t.region_id === regionId)
    .map((t) => t.territory_id);
}

export const PUZZLE_OBJECTIVES: Record<Exclude<DailyPuzzleArchetype, 'domination'>, PuzzleObjectiveDef> = {
  military_capture: {
    condition: (state, _map, spec, humanPlayerId) => humanOwns(state, spec.target_territory_id, humanPlayerId),
    holdThroughAiTurn: true,
    lapseIsFailure: false,
    onTimeout: 'fail',
  },
  capture_chain: {
    condition: (state, _map, spec, humanPlayerId) =>
      (spec.target_territory_ids ?? []).length > 0
      && (spec.target_territory_ids ?? []).every((tid) => humanOwns(state, tid, humanPlayerId)),
    holdThroughAiTurn: true,
    lapseIsFailure: false,
    onTimeout: 'fail',
  },
  control_region: {
    condition: (state, map, spec, humanPlayerId) => {
      if (!spec.region_id) return false;
      const ids = regionTerritoryIds(map, spec.region_id);
      return ids.length > 0 && ids.every((tid) => humanOwns(state, tid, humanPlayerId));
    },
    holdThroughAiTurn: true,
    lapseIsFailure: false,
    onTimeout: 'fail',
  },
  hold_territory: {
    // The target starts in human hands. Losing it, even for a turn, is the
    // loss; still holding it when the clock runs out is the win.
    condition: (state, _map, spec, humanPlayerId) => humanOwns(state, spec.target_territory_id, humanPlayerId),
    holdThroughAiTurn: false,
    lapseIsFailure: true,
    onTimeout: 'solve',
  },
  economy_build: {
    condition: (state, _map, spec, humanPlayerId) => {
      if (!spec.building_type) return false;
      for (const terr of Object.values(state.territories)) {
        if (terr.owner_id !== humanPlayerId) continue;
        if ((terr.buildings ?? []).includes(spec.building_type)) return true;
      }
      return false;
    },
    holdThroughAiTurn: false,
    lapseIsFailure: false,
    onTimeout: 'fail',
  },
  tech_research: {
    condition: (state, _map, spec, humanPlayerId) => {
      const human = state.players.find((p) => p.player_id === humanPlayerId);
      if (!spec.tech_id || !human) return false;
      return (human.unlocked_techs ?? []).includes(spec.tech_id);
    },
    holdThroughAiTurn: false,
    lapseIsFailure: false,
    onTimeout: 'fail',
  },
};

/**
 * Non-domination puzzle outcomes. Domination uses normal {@link checkVictory}.
 *
 * Mutates one field: `state.puzzle_objective_reached_turn`, the bookkeeping
 * for achieve-and-hold verbs. Called after every action and at every turn
 * boundary, so it sees the condition become true (records the turn) and, one
 * turn later with the condition still true, reports solved.
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

  const def = PUZZLE_OBJECTIVES[spec.archetype];
  if (!def) return 'pending';
  const met = def.condition(state, map, spec, humanPlayerId);

  if (def.lapseIsFailure) return met ? 'pending' : 'failed';
  if (!def.holdThroughAiTurn) return met ? 'solved' : 'pending';

  if (!met) {
    state.puzzle_objective_reached_turn = null;
    return 'pending';
  }
  if (state.puzzle_objective_reached_turn == null) {
    state.puzzle_objective_reached_turn = state.turn_number;
  }
  // The turn counter advances when play comes back round to the human, so
  // "past the turn it was reached" means the AI has replied and it held.
  return state.turn_number > state.puzzle_objective_reached_turn ? 'solved' : 'pending';
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
