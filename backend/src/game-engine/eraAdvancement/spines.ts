import type { EraId, EraMilestoneGate, EraSpineStep, GameState, PlayerState } from '../../types';

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
  // Classic timeline: Ancient → Modern. `gate_overrides` on a step set the
  // requirements to advance OUT of that era, so later transitions demand deeper
  // tech. Signatures beyond levy_of_knights are referenced here but implemented
  // in EA-301 — grantEraSignature safely no-ops for unimplemented ids.
  classic: {
    spine_id: 'classic',
    label: 'Ancient → Modern',
    steps: [
      { era_id: 'ancient' },
      { era_id: 'medieval', signature_id: 'levy_of_knights' },
      { era_id: 'discovery', signature_id: 'age_of_sail', gate_overrides: { min_tier2_techs: 2, min_buildings: 2 } },
      { era_id: 'ww2', signature_id: 'mobilization', gate_overrides: { min_tier2_techs: 2, min_tier3_techs: 1, min_buildings: 2 } },
      { era_id: 'coldwar', signature_id: 'intelligence_coup', gate_overrides: { min_tier2_techs: 2, min_tier3_techs: 1, min_buildings: 3 } },
      { era_id: 'modern', signature_id: 'precision_strike' },
    ],
  },
  // Full Ascension: the classic timeline extended into the Space Age. The
  // orbital_window signature is map-independent, so reaching space_age works on
  // any theater — lunar mechanics simply stay inert on moonless maps.
  full_ascension: {
    spine_id: 'full_ascension',
    label: 'Ancient → Space Age',
    steps: [
      { era_id: 'ancient' },
      { era_id: 'medieval', signature_id: 'levy_of_knights' },
      { era_id: 'discovery', signature_id: 'age_of_sail', gate_overrides: { min_tier2_techs: 2, min_buildings: 2 } },
      { era_id: 'ww2', signature_id: 'mobilization', gate_overrides: { min_tier2_techs: 2, min_tier3_techs: 1, min_buildings: 2 } },
      { era_id: 'coldwar', signature_id: 'intelligence_coup', gate_overrides: { min_tier2_techs: 2, min_tier3_techs: 1, min_buildings: 3 } },
      { era_id: 'modern', signature_id: 'precision_strike', gate_overrides: { min_tier2_techs: 2, min_tier3_techs: 1, min_buildings: 3 } },
      { era_id: 'space_age', signature_id: 'orbital_window' },
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

/** Highest era index reached by any non-eliminated player (the match leader). */
export function getEraLeaderIndex(state: GameState): number {
  let leader = 0;
  for (const p of state.players) {
    if (p.is_eliminated) continue;
    leader = Math.max(leader, p.current_era_index ?? 0);
  }
  return leader;
}

/** Eras a player trails the leader by (0 when leading or tied). */
export function getCatchupGap(state: GameState, player: PlayerState): number {
  return Math.max(0, getEraLeaderIndex(state) - (player.current_era_index ?? 0));
}

/**
 * The milestone gate a player must satisfy to advance out of their current era:
 * global settings overlaid with the current spine step's overrides, then
 * relaxed by one rank per requirement when the player is catching up (behind
 * the leader). tier-1 keeps a floor of 1 so a gate never fully vanishes.
 */
export function getEffectiveMilestoneGate(state: GameState, playerId: string): EraMilestoneGate {
  const player = state.players.find((p) => p.player_id === playerId);
  const currentIndex = player?.current_era_index ?? 0;
  const override = getStateSpineSteps(state)[currentIndex]?.gate_overrides ?? {};
  const base: EraMilestoneGate = {
    min_tier1_techs: override.min_tier1_techs ?? state.settings.era_advancement_min_tier1_techs ?? 3,
    min_tier2_techs: override.min_tier2_techs ?? state.settings.era_advancement_min_tier2_techs ?? 1,
    min_tier3_techs: override.min_tier3_techs ?? state.settings.era_advancement_min_tier3_techs ?? 0,
    min_buildings: override.min_buildings ?? state.settings.era_advancement_min_buildings ?? 1,
  };
  const gap = player ? getCatchupGap(state, player) : 0;
  if (gap === 0) return base;
  // Relax one rank per era behind the leader: a far-behind player faces an
  // almost-trivial gate so a suppressed economy can't lock them out of catching
  // up. tier-1 keeps a floor of 1 so the gate never fully vanishes.
  return {
    min_tier1_techs: Math.max(1, base.min_tier1_techs - gap),
    min_tier2_techs: Math.max(0, base.min_tier2_techs - gap),
    min_tier3_techs: Math.max(0, base.min_tier3_techs - gap),
    min_buildings: Math.max(0, base.min_buildings - gap),
  };
}
