/**
 * Daily puzzle system — MVP archetypes (Tier A coaching + optional Tier B dice queue).
 * Tier C (golden solution lines) is reserved for future curated content.
 */

import type { AuthoredScenario, BuildingType, EraId } from '../../types';

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

  // ── Authored-puzzle fields (dailyCalendar.ts). Generator days omit all of
  // these. The spec is the single source of truth for a day's content: it is
  // persisted as JSONB and rides inside game settings as an opaque extension,
  // so authored boards survive re-normalization and room reloads unchanged. ──

  /** Designed opening position, applied via the shared applyAuthoredScenario. */
  starting_board?: AuthoredScenario['starting_board'];
  /** Wipe the dealt board to neutral/0 before applying starting_board. */
  clear_board?: boolean;
  /** Resource floors for the human seat (tech points / gold). */
  grants?: AuthoredScenario['grants'];
  /**
   * Open the puzzle mid-turn: 'attack' skips the human's first draft so a
   * tactical board is fought exactly as authored. Default: normal draft start.
   */
  starting_phase?: 'attack';
  /** AI difficulty for this day (generator days keep the route default). */
  ai_difficulty?: 'easy' | 'medium' | 'hard' | 'expert';
  /**
   * Extra game-settings keys merged at game creation (e.g. naval_enabled).
   * Protected keys (daily_challenge_date/spec, seed, max_players) are ignored;
   * everything else still passes the normal settings normalizer.
   */
  settings_overrides?: Record<string, unknown>;
}

/** Feedback tiers for Tier A strategic coaching (evaluateBoard delta). */
export type PuzzleFeedbackTier = 'strong' | 'ok' | 'risky';

export const PUZZLE_FEEDBACK_THRESHOLDS = {
  /** Delta >= this (heuristic) counts as a “strong” move. */
  strong: 0.015,
  /** Delta <= this counts as “risky”. */
  risky: -0.015,
} as const;
