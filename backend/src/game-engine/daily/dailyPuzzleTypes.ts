/**
 * Daily puzzle system — MVP archetypes (Tier A coaching + optional Tier B dice queue).
 * Tier C (golden solution lines) is reserved for future curated content.
 */

import type { BuildingType, EraId } from '../../types';

/** High-level puzzle categories rotated deterministically by date. */
export type DailyPuzzleArchetype =
  | 'domination'
  | 'military_capture'
  | 'economy_build'
  | 'tech_research';

export interface DailyPuzzleSpec {
  archetype: DailyPuzzleArchetype;
  /** Display */
  title: string;
  intro: string;
  goal: string;
  /** Map / session */
  era_id: EraId;
  map_id: string;
  seed: number;
  player_count: number;
  /** Failure: lose if the game passes this turn number (human perspective rounds). */
  max_turns: number;
  /** Seed for Tier B deterministic combat dice (mulberry32 stream). */
  dice_queue_seed: number;
  /** military_capture: must capture this territory */
  target_territory_id?: string;
  /** military_capture: human starts owning this adjacent territory */
  anchor_territory_id?: string;
  /** economy_build: build this on any owned territory */
  building_type?: BuildingType;
  /** tech_research: research this node */
  tech_id?: string;
  /** Hint shown after mistakes (optional future use). */
  hint?: string;
}

/** Feedback tiers for Tier A strategic coaching (evaluateBoard delta). */
export type PuzzleFeedbackTier = 'strong' | 'ok' | 'risky';

export const PUZZLE_FEEDBACK_THRESHOLDS = {
  /** Delta >= this (heuristic) counts as a “strong” move. */
  strong: 0.015,
  /** Delta <= this counts as “risky”. */
  risky: -0.015,
} as const;
