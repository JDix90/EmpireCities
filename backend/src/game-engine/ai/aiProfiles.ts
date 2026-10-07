/**
 * Every bot difficulty's settings, in one table.
 *
 * Before this table they sat in a dozen constants and `difficulty === ...`
 * branches across the planner, the attack budget, era advancement, research,
 * building, the lane powers, the worker budget, territory picks and ratings.
 * Each of those now reads its level's row here, and the values are the ones
 * those constants and branches held, unchanged. The press settings are new,
 * and read only with ai_odds_press_enabled on.
 *
 * Every function that takes a difficulty also takes a profile (AiLevel), so a
 * harness can seat a bot whose settings differ from its level's row
 * (scripts/simAiArena.ts). The live game passes the difficulty string.
 *
 * Feature flags decide which capabilities exist; the profile decides how each
 * level uses them.
 */
import type { AiDifficulty, GameSettings } from '../../types';
import type { AiThreatModel } from './aiThreat';

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
   * The level whose plan stands in when planning overruns or fails: its own,
   * capped at medium. The fallback runs on the server's main thread, so it
   * must stay cheap whatever the higher levels' planning becomes. It used to
   * be easy for everyone: two attacks, long shots included, spent from the
   * real level's exchange budget.
   */
  timeoutFallback: AiDifficulty;
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

  // ── Pressing on the odds (ai_odds_press_enabled) ──────────────────────────
  // Read only with the flag on, in place of the exchange budget above: the
  // bot starts an attack at `pressStartOdds` or better (counting what the
  // capture is worth), keeps rolling while the odds alone stay at
  // `pressContinueOdds` or better, and stops at the turn's ceiling. Odds are
  // the chance of taking the territory pressing to the end (combat/combatOdds.ts).
  // Tuned in the arena (scripts/simAiArena.ts) so each level beats today's
  // and the steps between levels hold: today's levels differ mostly by their
  // exchange budget, and pressing freely would close the gaps.
  /** The capture chance an attack needs before its first exchange. */
  pressStartOdds: number;
  /** The capture chance it needs to roll again. */
  pressContinueOdds: number;
  /** Dice exchanges per turn, at most; doubled by the decided-game press. */
  pressExchangeCeiling: number;

  // ── Reinforcements and re-planning (ai_planned_reinforcements_enabled) ────
  // Read only with that flag on, which builds on the odds press. Placing the
  // draft where it adds the most (ai/aiDraftPlan.ts) is by far the bigger
  // lever: in the arena a Medium with it beat three of today's Hard bots in
  // four games of five, and even Easy with it stalled today's Medium. So only
  // Expert places by value, which makes it the clear top step; Medium and Hard
  // keep the plan's single tile and choose their attacks again once it lands.
  /**
   * Territories a draft may be spread over, more only once they are at their
   * stability caps; 0 keeps the plan's single tile, chosen before the turn's
   * setup steps as today.
   */
  draftTiles: number;
  /** Chooses its attacks again once its reinforcements have landed. */
  replansAfterDraft: boolean;
  /** Also chooses them again after every capture, from the board it made. */
  replansAfterCapture: boolean;

  // ── Playing to the ending (ai_ending_play_enabled) ────────────────────────
  // Read only with that flag on (ai/aiEnding.ts). Seat-blind: a player is
  // pressed because it is close to winning, never because it is human.
  /**
   * How hard it presses a rival close to winning, as an attack bonus on the
   * planner's 3·P − 1 scale at full urgency; 0 never presses.
   */
  leaderPressure: number;
  /** Races its own ending: near its line, or in the last rounds before the cap. */
  racesEnding: boolean;

  // ── Resigning (ai_resignation_enabled) ────────────────────────────────────
  // Read only with that flag on (ai/aiResign.ts).
  /** Resigns as its turn opens once it is beaten. */
  resignsWhenBeaten: boolean;

  // ── Intents (ai_intents_enabled) ──────────────────────────────────────────
  // Read only with that flag on (ai/aiIntent.ts): a goal that spans turns,
  // chosen again every turn.
  /**
   * What a capture that advances its goal is worth on top of the fight, on
   * the planner's 3·P − 1 scale; 0 holds no goal.
   */
  intentBonus: number;
  /** How much the goal it holds is lifted when goals are scored again: a tie-breaker. */
  intentStickiness: number;
  /**
   * Names its goal in the digest of its turn (ai/aiTurnDigest.ts). A bot
   * tells less as its level rises: Expert only reports what it did.
   */
  announcesIntent: boolean;
  /**
   * How much it wants each goal when goals are scored, as a factor on the
   * goal's score. 1 at every level; a commander's style shifts them
   * (ai/aiStyles.ts).
   */
  goalWeights: Readonly<Record<'take_region' | 'break_region' | 'hunt', number>>;
  /**
   * How hard a goal to take or hunt pulls the draft and the fortify move, as
   * a factor on the staging premium; 0 never stages. 1 at every level.
   */
  goalStaging: number;
  /**
   * What taking a tile from the weakest rival is worth on top of the fight,
   * on the planner's 3·P − 1 scale: the rival holding the fewest territories
   * (aiBot weakestRivals). 0 at every level; the Opportunist's style raises
   * it (ai/aiStyles.ts).
   */
  preysOnWeak: number;
  /**
   * Hunts the weakest rival whatever its size: as well as a rival down to its
   * last few territories, the rival holding the fewest is a goal to hunt
   * (ai/aiIntent.ts). Off at every level; the Opportunist's style turns it on.
   */
  huntsWeakest: boolean;
  /**
   * Starts an attack on its odds alone, pressing on the odds: what the
   * capture is worth (a goal, a kill shot, the ending) never lowers the odds
   * it needs (aiAttackGrind shouldStartPress). Off at every level; the
   * Defender's style turns it on.
   */
  startsOnOddsAlone: boolean;

  // ── Defence (ai_defense_enabled) ──────────────────────────────────────────
  // Read only with that flag on (ai/aiFortify.ts, ai/aiThreat.ts).
  /**
   * How it fortifies: `interior` makes today's one move from an interior tile
   * to the nearest border, planned before the draft; `threat` plans every
   * move it has at the fortify step, by what each tile risks.
   */
  fortifyPlan: 'interior' | 'threat';
  /** How it prices the chance a tile is lost before its next turn (ai/aiThreat.ts). */
  threatModel: AiThreatModel;
  /**
   * What staging next turn's attacks is worth to a fortify move, against
   * keeping its tiles: a factor on the best capture a tile could make. 0
   * moves troops by threat alone.
   */
  fortifyAttackWeight: number;
  /** The chance of losing a tile it accepts; a move sized to bring a tile under it is always priced. */
  lossTolerance: number;

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

/** Every goal wanted alike: each level's own row. */
const EVEN_GOALS = { take_region: 1, break_region: 1, hunt: 1 } as const;

export const AI_PROFILES: Readonly<Record<AiDifficulty, Readonly<AiProfile>>> = {
  tutorial: {
    difficulty: 'tutorial',
    passive: true,
    planBudgetMs: 750,
    timeoutFallback: 'tutorial',
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
    // Unread: the tutorial bot never attacks.
    pressStartOdds: 0.75,
    pressContinueOdds: 0.6,
    pressExchangeCeiling: 3,
    draftTiles: 0,
    replansAfterDraft: false,
    replansAfterCapture: false,
    leaderPressure: 0,
    racesEnding: false,
    resignsWhenBeaten: false,
    intentBonus: 0,
    intentStickiness: 0,
    announcesIntent: false,
    goalWeights: EVEN_GOALS,
    goalStaging: 1,
    preysOnWeak: 0,
    huntsWeakest: false,
    startsOnOddsAlone: false,
    fortifyPlan: 'interior',
    threatModel: 'adjacent',
    fortifyAttackWeight: 0,
    lossTolerance: 0.5,
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
    timeoutFallback: 'easy',
    noise: 0.35,
    attackCap: 2,
    exchangeBudget: 2,
    takesLongShots: true,
    finisher: false,
    decidedPress: false,
    neutralExpansionBonus: 1.5,
    vulnerabilityBonus: 1,
    influence: false,
    pressStartOdds: 0.75,
    pressContinueOdds: 0.6,
    pressExchangeCeiling: 3,
    draftTiles: 0,
    replansAfterDraft: false,
    replansAfterCapture: false,
    leaderPressure: 0,
    racesEnding: false,
    resignsWhenBeaten: true,
    intentBonus: 0,
    intentStickiness: 0,
    announcesIntent: true,
    goalWeights: EVEN_GOALS,
    goalStaging: 1,
    preysOnWeak: 0,
    huntsWeakest: false,
    startsOnOddsAlone: false,
    fortifyPlan: 'interior',
    threatModel: 'adjacent',
    fortifyAttackWeight: 0,
    lossTolerance: 0.5,
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
    timeoutFallback: 'medium',
    noise: 0.15,
    attackCap: 4,
    exchangeBudget: 4,
    takesLongShots: false,
    finisher: true,
    decidedPress: true,
    neutralExpansionBonus: 2,
    vulnerabilityBonus: 2,
    influence: true,
    pressStartOdds: 0.65,
    pressContinueOdds: 0.5,
    pressExchangeCeiling: 12,
    draftTiles: 0,
    replansAfterDraft: true,
    replansAfterCapture: false,
    leaderPressure: 1,
    racesEnding: true,
    resignsWhenBeaten: true,
    intentBonus: 1,
    intentStickiness: 0.25,
    announcesIntent: true,
    goalWeights: EVEN_GOALS,
    goalStaging: 1,
    preysOnWeak: 0,
    huntsWeakest: false,
    startsOnOddsAlone: false,
    fortifyPlan: 'threat',
    threatModel: 'adjacent',
    fortifyAttackWeight: 0,
    lossTolerance: 0.5,
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
    timeoutFallback: 'medium',
    noise: 0.05,
    attackCap: 8,
    exchangeBudget: 8,
    takesLongShots: false,
    finisher: true,
    decidedPress: true,
    neutralExpansionBonus: 2.5,
    vulnerabilityBonus: 4,
    influence: true,
    pressStartOdds: 0.4,
    pressContinueOdds: 0.35,
    pressExchangeCeiling: 40,
    draftTiles: 0,
    replansAfterDraft: true,
    replansAfterCapture: true,
    leaderPressure: 2,
    racesEnding: true,
    resignsWhenBeaten: true,
    intentBonus: 1,
    intentStickiness: 0.25,
    announcesIntent: true,
    goalWeights: EVEN_GOALS,
    goalStaging: 1,
    preysOnWeak: 0,
    huntsWeakest: false,
    startsOnOddsAlone: false,
    fortifyPlan: 'threat',
    threatModel: 'full_drafts',
    fortifyAttackWeight: 0.5,
    lossTolerance: 0.4,
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
    timeoutFallback: 'medium',
    noise: 0,
    attackCap: 8,
    exchangeBudget: 8,
    takesLongShots: false,
    finisher: true,
    decidedPress: true,
    neutralExpansionBonus: 3,
    vulnerabilityBonus: 4,
    influence: true,
    pressStartOdds: 0.35,
    pressContinueOdds: 0.35,
    pressExchangeCeiling: 40,
    // Measured in Quick Match duels against Hard, both on the newer flags:
    // three tiles won 65% of 840, four 64%, six 59%, no limit 59%.
    draftTiles: 3,
    replansAfterDraft: true,
    replansAfterCapture: true,
    // Measured: pressing the leader only stalled Expert tables (decided games
    // fell from 92% to 78%) without curbing the early leader, so it races alone.
    leaderPressure: 0,
    racesEnding: true,
    resignsWhenBeaten: true,
    intentBonus: 1,
    intentStickiness: 0.25,
    announcesIntent: false,
    goalWeights: EVEN_GOALS,
    goalStaging: 1,
    preysOnWeak: 0,
    huntsWeakest: false,
    startsOnOddsAlone: false,
    fortifyPlan: 'threat',
    threatModel: 'full_drafts',
    fortifyAttackWeight: 0,
    lossTolerance: 0.3,
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

const LEVEL_ORDER: readonly AiDifficulty[] = ['tutorial', 'easy', 'medium', 'hard', 'expert'];

type Seat = { is_ai: boolean; ai_difficulty?: AiDifficulty | null };

/**
 * The game's bot level: the highest among its bots, which is also what the
 * end-of-game summary reports. Null in a game with no bots.
 */
export function gameAiDifficulty(players: readonly Seat[]): AiDifficulty | null {
  let best: AiDifficulty | null = null;
  for (const p of players) {
    if (!p.is_ai || !p.ai_difficulty) continue;
    if (best === null || LEVEL_ORDER.indexOf(p.ai_difficulty) > LEVEL_ORDER.indexOf(best)) best = p.ai_difficulty;
  }
  return best;
}

/**
 * The level a seat plays at. A bot plays its own. A human seat the AI covers
 * while its player is away plays at the game's bot level, so leaving a game
 * against easy bots no longer hands the table a medium one; medium in a game
 * with no bots, as before.
 */
export function seatAiDifficulty(players: readonly Seat[], seat: Seat): AiDifficulty {
  return seat.ai_difficulty ?? gameAiDifficulty(players) ?? 'medium';
}

/**
 * Whether a game's bots stay today's bots whatever the newer AI flags say
 * (ai_odds_press_enabled, ai_planned_reinforcements_enabled,
 * ai_ending_play_enabled, ai_resignation_enabled, ai_intents_enabled):
 *   - a daily challenge: every player of a day meets the same opponent, so
 *     switching a flag mid-day must not change it, and its siege is tuned to
 *     today's budget;
 *   - a campaign stage: each stage is tuned against today's bots, and the
 *     newer flags made most of them far harder (scripts/simCampaignStages.ts:
 *     the stand-in's mean win rate over the 18 stages fell from 24% to 9%).
 */
export function keepsTodaysBots(settings: Pick<GameSettings, 'daily_challenge_date' | 'is_campaign'>): boolean {
  return !!settings.daily_challenge_date || !!settings.is_campaign;
}
