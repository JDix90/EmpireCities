import type { GameMap, GameState } from '../../types';
import type { DailyPuzzleSpec } from './dailyPuzzleTypes';

export type PuzzleObjectiveStatus = 'pending' | 'solved' | 'failed';

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

  if (spec.archetype === 'military_capture' && spec.target_territory_id) {
    const t = state.territories[spec.target_territory_id];
    if (t?.owner_id === humanPlayerId) return 'solved';
    return 'pending';
  }

  if (spec.archetype === 'economy_build' && spec.building_type) {
    for (const terr of Object.values(state.territories)) {
      if (terr.owner_id !== humanPlayerId) continue;
      if ((terr.buildings ?? []).includes(spec.building_type)) return 'solved';
    }
    return 'pending';
  }

  if (spec.archetype === 'tech_research' && spec.tech_id) {
    if ((human.unlocked_techs ?? []).includes(spec.tech_id)) return 'solved';
    return 'pending';
  }

  return 'pending';
}

/**
 * Time loss — human did not meet goal before max turns (checked after turn advances).
 */
export function isPuzzleTimedOut(state: GameState, spec: DailyPuzzleSpec): boolean {
  if (spec.archetype === 'domination') return false;
  return state.turn_number > spec.max_turns;
}
