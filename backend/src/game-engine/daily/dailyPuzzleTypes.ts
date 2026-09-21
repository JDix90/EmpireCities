/**
 * Daily puzzle system — MVP archetypes (Tier A coaching + optional Tier B dice queue).
 * Tier C (golden solution lines) is reserved for future curated content.
 */

import type { AuthoredScenario, BuildingType, EraId } from '../../types';
import type { OpponentPlan } from './puzzle/opponent';

/** A human action in the stored solution, by territory id (puzzle/actions.ts serializeAction). */
export type StoredPuzzleAction =
  | { kind: 'draft'; to: string; split?: string }
  | { kind: 'assault'; from: string; to: string; keep: number }
  | { kind: 'end_attack' }
  | { kind: 'fortify'; from: string; to: string; units: 'all_but_1' | 'half' }
  | { kind: 'end_turn' };

export interface StoredPuzzleDecision {
  turn: number;
  phase: 'draft' | 'attack' | 'fortify';
  best: StoredPuzzleAction;
  best_equity: number;
  /** The rival graded against: the obvious line's move when it differs and loses, else the strongest move of another kind. */
  alternative: StoredPuzzleAction | null;
  alternative_equity: number;
  gap: number;
}

/**
 * Daily Challenge v2 (docs/DAILY_PUZZLE_V2.md): the day as a decision puzzle.
 * Present only on a day the v2 schedule sized and proved; its absence means a
 * v1 day. Stored inside spec_json and carried in game settings like the rest
 * of the spec, so play, the archive and the review all read one record.
 */
export interface DailyPuzzleV2 {
  version: 2;
  /** The idea the day teaches, e.g. "cut the supply line". */
  theme: string;
  /** The scripted opponent (puzzle/opponent.ts). */
  plan: OpponentPlan;
  /** The plan in the player's words, one line per step. */
  plan_prose: string[];
  /** The weekday tier. */
  decisions_target: number;
  verdicts: 'before_dice' | 'silent';
  intent: 'arrows' | 'prose';
  solution: {
    /** Best-play win probability from the opening position. */
    equity: number;
    /** The obvious line's win probability. */
    obvious_equity: number;
    /** Opening actions within five points of the best. */
    near_best: number;
    decisions: StoredPuzzleDecision[];
    line: Array<{ turn: number; action: StoredPuzzleAction; equity: number }>;
    /** Positions the exact search visited. */
    nodes: number;
  };
}

/** What the client may see of the v2 block while the day is live: no solution, no plan on a prose day. */
export interface PublicDailyPuzzleV2 {
  version: 2;
  theme: string;
  plan_prose: string[];
  decisions_target: number;
  verdicts: DailyPuzzleV2['verdicts'];
  intent: DailyPuzzleV2['intent'];
  /** The raw plan, for the intent arrows; only on an arrows day. */
  plan?: OpponentPlan;
  /** Decisions along the best line: the number the intro promises. */
  decisions: number;
}

/** Grades by points of win probability lost (docs/DAILY_PUZZLE_V2.md §4). */
export type PuzzleGrade = 'best' | 'good' | 'inaccuracy' | 'blunder';

/**
 * One graded decision of a v2 run, kept on the game state (puzzlePlay.ts)
 * and stored in the entry's decisions_json at game over. Equities are win
 * probabilities (0–1); `loss` is in points (0–100) and is what accuracy
 * records: the first proposal's loss, or 100 after a second takeback.
 */
export interface PuzzleDecisionRecord {
  /** Canonical position key; one record per position. */
  key: string;
  turn: number;
  phase: 'draft' | 'attack' | 'fortify';
  best: StoredPuzzleAction;
  best_equity: number;
  /** The first proposal (or the committed move when nothing was proposed). */
  first: StoredPuzzleAction | null;
  first_equity: number;
  loss: number;
  grade: PuzzleGrade;
  takebacks: number;
  /** Set after the second takeback: the best move was shown. */
  revealed?: boolean;
  /** The move actually played, and what it was worth. */
  chosen?: StoredPuzzleAction | null;
  chosen_equity?: number;
  chosen_loss?: number;
  /** The last proposal, to tell a takeback from a repeat. */
  last?: StoredPuzzleAction | null;
}

/** High-level puzzle categories rotated deterministically by date. */
export type DailyPuzzleArchetype =
  | 'domination'
  | 'military_capture'
  | 'hold_territory'
  | 'control_region'
  | 'capture_chain'
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
  /** military_capture: must capture this territory. hold_territory: must still own it at the clock. */
  target_territory_id?: string;
  /** capture_chain: every one of these must be taken (order-free) and held. */
  target_territory_ids?: string[];
  /** control_region: every territory of this region must be held. */
  region_id?: string;
  /** military_capture: the human's main force starts here. hold_territory: the AI's assault stack does. */
  anchor_territory_id?: string;
  /** economy_build: build this on any owned territory */
  building_type?: BuildingType;
  /** tech_research: research this node */
  tech_id?: string;
  /** Hint shown after mistakes (optional future use). */
  hint?: string;

  // ── Designed-board fields, set by the dated calendar (dailyCalendar.ts) and
  // by the schedule when it sizes a set-piece (dailySchedule.ts); only the
  // last-resort generator omits them. The spec is the single source of truth
  // for a day's content: it is persisted as JSONB and rides inside game
  // settings as an opaque extension, so designed boards survive
  // re-normalization and room reloads unchanged. ──

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
  /**
   * Par: the turn the obvious line solves this day on, median over the
   * simulator's games (puzzleSim.ts). Scoring beats or misses it. Capture days
   * only; a hold day is solved at the clock.
   */
  par_turns?: number;
  /** v2 decision-puzzle data; absent on a v1 day. */
  v2?: DailyPuzzleV2;
}

/** Feedback tiers for Tier A strategic coaching (evaluateBoard delta). */
export type PuzzleFeedbackTier = 'strong' | 'ok' | 'risky';

export const PUZZLE_FEEDBACK_THRESHOLDS = {
  /** Delta >= this (heuristic) counts as a “strong” move. */
  strong: 0.015,
  /** Delta <= this counts as “risky”. */
  risky: -0.015,
} as const;
