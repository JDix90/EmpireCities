/**
 * Every bot difficulty's settings, in one table.
 *
 * Before this table they sat in a dozen constants and `difficulty === ...`
 * branches across the planner, the attack budget, era advancement, research,
 * building, the lane powers, the worker budget, territory picks and ratings.
 * Each of those now reads its level's row here, and the values are the ones
 * those constants and branches held, unchanged.
 *
 * Every function that takes a difficulty also takes a profile (AiLevel), so a
 * harness can seat a bot whose settings differ from its level's row
 * (scripts/simAiArena.ts). The live game passes the difficulty string.
 *
 * Feature flags decide which capabilities exist; the profile decides how each
 * level uses them.
 */
import type { AiDifficulty } from '../../types';

/**
 * What a bot builds (economy games):
 *   none       never builds.
 *   gate_only  only in era-advancement games, the cheapest building until the
 *              era gate's building count is met, then stops.
 *   greedy     launch pads, jump gates and ports where they open the board,
 *              then the production chain on its least developed territory.
 *   threat     as greedy, plus naval bases and coastal batteries; then defence
 *              on its most threatened border, and the production chain on its
 *              strongest territories.
 */
export type AiBuildMode = 'none' | 'gate_only' | 'greedy' | 'threat';

/**
 * What a bot researches (tech-tree games):
 *   none       nothing.
 *   gate_only  only in era-advancement games (toward the era gate, then
 *              stops) and in the Galactic Age (the Hyperspace Chart).
 *   cheapest   the gate first, the era ladders, then the cheapest node it can
 *              afford.
 *   strategic  as cheapest, but the last step scores nodes by attack, defence,
 *              income and reinforcements for the era's character.
 */
export type AiResearchMode = 'none' | 'gate_only' | 'cheapest' | 'strategic';

/**
 * How a bot claims territories in a territory-select opening:
 *   random             any unclaimed territory.
 *   cluster            next to its own; its first pick from the three
 *                      highest-bonus regions.
 *   cluster_by_region  as cluster, but each pick next to its own goes to the
 *                      highest-bonus region.
 */
export type AiTerritoryPick = 'random' | 'cluster' | 'cluster_by_region';

export interface AiProfile {
  /** The level this profile plays. */
  difficulty: AiDifficulty;

  // ── Planning ──────────────────────────────────────────────────────────────
  /**
   * The tutorial bot: places every reinforcement on a random territory of its
   * own and passes the rest of the turn. No attacks, card trades, building,
   * research or era advances.
   */
  passive: boolean;
  /** Time the planning worker gets before the fallback plan (runAiWithTimeout). */
  planBudgetMs: number;
  /**
   * Score jitter: every draft candidate gains rng() × noise × 10 and every
   * attack candidate rng() × noise × 3. The only thing separating levels in
   * the scoring itself.
   */
  noise: number;

  // ── Attacks ───────────────────────────────────────────────────────────────
  /** Attacks the planner lists per turn. */
  attackCap: number;
  /** Dice exchanges the turn may spend across those attacks (aiAttackGrind). */
  exchangeBudget: number;
  /** Lists attacks that score zero or below, which no other level makes. */
  takesLongShots: boolean;
  /**
   * Kill shots: +5 to attack a rival's last territory and +2.5 its second to
   * last, and up to FINISHER_OVERCAP such attacks past the cap.
   */
  finisher: boolean;
  /**
   * Presses a decided game (ai_decided_game_press_enabled): past the win
   * probability threshold, a doubled exchange budget and the attack cap lifted
   * by FINISHER_OVERCAP. A daily siege lifts the cap only for these levels.
   */
  decidedPress: boolean;
  /** Score bonus for taking a neutral frontier territory; +1.5 more across a sea lane. */
  neutralExpansionBonus: number;
  /** Score bonus against a rival in its era-transition vulnerability window. */
  vulnerabilityBonus: number;
  /** Spreads influence where its era grants it. */
  influence: boolean;

  // ── Economy ───────────────────────────────────────────────────────────────
  build: AiBuildMode;
  research: AiResearchMode;
  /** Garrison doctrines bought per turn (Galactic Age). */
  doctrinesPerTurn: number;
  /** Puts a Forward garrison on the source of its first planned lane crossing. */
  forwardDoctrine: boolean;
  /** Fires lane powers: Lance Battery, Orbital Muster, Seal Breaker, Surge Projector. */
  lanePowers: boolean;
  /** Researches toward and drops the WW2 bomb when the game's ww2_bomb_ai is on. */
  pursuesBomb: boolean;

  // ── Era advancement ───────────────────────────────────────────────────────
  /** The advance score it needs to climb an era while not behind. */
  advanceThreshold: number;
  /** May climb before turn 4. */
  advancesEarly: boolean;
  /** Skips 85% of the climbs it qualifies for while not behind. */
  dawdles: boolean;

  // ── Outside the turn ──────────────────────────────────────────────────────
  territoryPick: AiTerritoryPick;
  /** Rating of a synthetic opponent at this level, relative to a new player's. */
  ratingOffset: number;
}

export const AI_PROFILES: Readonly<Record<AiDifficulty, Readonly<AiProfile>>> = {
  tutorial: {
    difficulty: 'tutorial',
    passive: true,
    planBudgetMs: 750,
    // Unread: the passive turn scores nothing.
    noise: 0.9,
    attackCap: 8,
    exchangeBudget: 0,
    takesLongShots: false,
    finisher: false,
    decidedPress: false,
    neutralExpansionBonus: 1,
    vulnerabilityBonus: 4,
    influence: false,
    build: 'none',
    research: 'none',
    doctrinesPerTurn: 0,
    forwardDoctrine: false,
    lanePowers: false,
    pursuesBomb: false,
    advanceThreshold: Number.POSITIVE_INFINITY,
    advancesEarly: false,
    dawdles: false,
    territoryPick: 'random',
    ratingOffset: -400,
  },
  easy: {
    difficulty: 'easy',
    passive: false,
    planBudgetMs: 1_000,
    noise: 0.35,
    attackCap: 2,
    exchangeBudget: 2,
    takesLongShots: true,
    finisher: false,
    decidedPress: false,
    neutralExpansionBonus: 1.5,
    vulnerabilityBonus: 1,
    influence: false,
    build: 'gate_only',
    research: 'gate_only',
    doctrinesPerTurn: 0,
    forwardDoctrine: false,
    lanePowers: false,
    pursuesBomb: false,
    advanceThreshold: 12,
    advancesEarly: false,
    dawdles: true,
    territoryPick: 'random',
    ratingOffset: -200,
  },
  medium: {
    difficulty: 'medium',
    passive: false,
    planBudgetMs: 1_500,
    noise: 0.15,
    attackCap: 4,
    exchangeBudget: 4,
    takesLongShots: false,
    finisher: true,
    decidedPress: true,
    neutralExpansionBonus: 2,
    vulnerabilityBonus: 2,
    influence: true,
    build: 'greedy',
    research: 'cheapest',
    doctrinesPerTurn: 1,
    forwardDoctrine: false,
    lanePowers: true,
    pursuesBomb: false,
    advanceThreshold: 6,
    advancesEarly: false,
    dawdles: false,
    territoryPick: 'random',
    ratingOffset: 0,
  },
  hard: {
    difficulty: 'hard',
    passive: false,
    planBudgetMs: 3_000,
    noise: 0.05,
    attackCap: 8,
    exchangeBudget: 8,
    takesLongShots: false,
    finisher: true,
    decidedPress: true,
    neutralExpansionBonus: 2.5,
    vulnerabilityBonus: 4,
    influence: true,
    build: 'threat',
    research: 'strategic',
    doctrinesPerTurn: 2,
    forwardDoctrine: true,
    lanePowers: true,
    pursuesBomb: true,
    advanceThreshold: 4,
    advancesEarly: false,
    dawdles: false,
    territoryPick: 'cluster',
    ratingOffset: 150,
  },
  expert: {
    difficulty: 'expert',
    passive: false,
    planBudgetMs: 5_000,
    noise: 0,
    attackCap: 8,
    exchangeBudget: 8,
    takesLongShots: false,
    finisher: true,
    decidedPress: true,
    neutralExpansionBonus: 3,
    vulnerabilityBonus: 4,
    influence: true,
    build: 'threat',
    research: 'strategic',
    doctrinesPerTurn: 2,
    forwardDoctrine: true,
    lanePowers: true,
    pursuesBomb: true,
    advanceThreshold: 3,
    advancesEarly: true,
    dawdles: false,
    territoryPick: 'cluster_by_region',
    ratingOffset: 300,
  },
};

/** A difficulty, or a profile standing in for one (a harness seat with its own settings). */
export type AiLevel = AiDifficulty | AiProfile;

/**
 * The profile a level plays. A value that is not a known difficulty plays
 * medium, the level the game falls back to wherever a seat has none.
 */
export function aiProfile(level: AiLevel | string): Readonly<AiProfile> {
  if (typeof level === 'object') return level;
  return Object.prototype.hasOwnProperty.call(AI_PROFILES, level)
    ? AI_PROFILES[level as AiDifficulty]
    : AI_PROFILES.medium;
}
