import type { EraId, EraSpineStep, GameState } from '../../types';

/**
 * An era advancement spine: the ordered, linear sequence of rules eras a game
 * climbs through. Spines are defined here in code (same data-driven pattern as
 * the era definitions in `../eras`) and the resolved steps are snapshotted onto
 * `GameState.era_spine` at game creation, so in-flight games are immune to
 * registry changes.
 */
export interface EraAdvancementSpine {
  spine_id: string;
  /** Human-readable name for lobby display. */
  label: string;
  /** Ordered steps; index 0 is the starting era. */
  steps: EraSpineStep[];
}

export const DEFAULT_ERA_SPINE_ID = 'poc';

export const ERA_ADVANCEMENT_SPINES: Record<string, EraAdvancementSpine> = {
  poc: {
    spine_id: 'poc',
    label: 'Ancient → Medieval',
    steps: [
      { era_id: 'ancient' },
      { era_id: 'medieval', signature_id: 'levy_of_knights' },
    ],
  },
};

export function getSpineById(spineId: string | undefined): EraAdvancementSpine {
  return ERA_ADVANCEMENT_SPINES[spineId ?? DEFAULT_ERA_SPINE_ID] ?? ERA_ADVANCEMENT_SPINES[DEFAULT_ERA_SPINE_ID];
}

export function isValidSpineId(spineId: unknown): spineId is string {
  return typeof spineId === 'string' && spineId in ERA_ADVANCEMENT_SPINES;
}

/**
 * The spine steps governing a game: the creation-time snapshot when present,
 * otherwise resolved from settings (pre-spine saves are given a snapshot by
 * `repairLegacyGameState`, so the fallback only covers bare test states).
 */
export function getStateSpineSteps(state: GameState): EraSpineStep[] {
  if (state.era_spine && state.era_spine.length > 0) return state.era_spine;
  return getSpineById(state.settings.era_advancement_spine_id).steps;
}

/** Era id at `index` along the game's spine, clamped to the final step. */
export function getSpineEraIdAtIndex(state: GameState, index: number): EraId {
  const steps = getStateSpineSteps(state);
  const clamped = Math.min(Math.max(index, 0), steps.length - 1);
  return steps[clamped].era_id;
}

/**
 * Highest reachable era index for a game: the spine bounds it, and the
 * `era_advancement_max_era_index` setting may cap it further.
 */
export function getMaxEraIndex(state: GameState): number {
  const spineMax = getStateSpineSteps(state).length - 1;
  const settingMax = state.settings.era_advancement_max_era_index ?? spineMax;
  return Math.min(settingMax, spineMax);
}
