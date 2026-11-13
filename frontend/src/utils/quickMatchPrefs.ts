/**
 * Quick Match preferences — opponent count, AI difficulty, and win criteria.
 *
 * Quick Match stays one-click: the button starts immediately with whatever was
 * used last (default 3 medium AI, the 65% ending). The options popover writes
 * here so an experienced player can play Hard/Expert, a different table size,
 * or a different ending without building a Custom Game every time.
 */

export const QUICK_MATCH_AI_DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'] as const;
export type QuickMatchAiDifficulty = (typeof QUICK_MATCH_AI_DIFFICULTIES)[number];

export const QUICK_MATCH_MIN_AI = 1;
export const QUICK_MATCH_MAX_AI = 7;

/**
 * How a Quick Match is won.
 *
 * Quick Match has always ended at 65% of the board, but nothing said so, and a
 * match stopping while a third of the map was still contested read as a bug
 * rather than a rule. These are the endings offered, cheapest to longest;
 * `majority` is the historical behavior and stays the default so an existing
 * player's games do not silently change length — it is just visible now.
 */
export const QUICK_MATCH_VICTORY_MODES = ['blitz', 'majority', 'capitals', 'conquest'] as const;
export type QuickMatchVictoryMode = (typeof QUICK_MATCH_VICTORY_MODES)[number];

/** The subset of the create-API victory conditions Quick Match ever sends. */
export type QuickMatchVictoryCondition = 'domination' | 'threshold' | 'capital';

export interface QuickMatchVictoryPlan {
  /** OR semantics server-side; `last_standing` always wins regardless. */
  allowed_victory_conditions: QuickMatchVictoryCondition[];
  /** Percent of the board; only sent when `threshold` is in the list. */
  victory_threshold?: number;
  /**
   * Leader-wins backstop, scaled to the ending. A 60-turn cap under Conquest
   * would mean every Conquest match ended on the cap instead of the criterion
   * the player picked — which is the confusion this whole picker exists to fix.
   */
  max_turns: number;
}

export const QUICK_MATCH_VICTORY_PLANS: Record<QuickMatchVictoryMode, QuickMatchVictoryPlan> = {
  blitz: {
    allowed_victory_conditions: ['domination', 'threshold'],
    victory_threshold: 50,
    max_turns: 45,
  },
  majority: {
    allowed_victory_conditions: ['domination', 'threshold'],
    victory_threshold: 65,
    max_turns: 60,
  },
  capitals: {
    // Domination rides along as the decisive fallback: capitals move when a
    // rival is eliminated, and a player who has taken the whole board has
    // plainly won either way.
    allowed_victory_conditions: ['capital', 'domination'],
    max_turns: 90,
  },
  conquest: {
    allowed_victory_conditions: ['domination'],
    max_turns: 120,
  },
};

/**
 * What the picker calls each ending. The keys are what saved prefs and
 * analytics store, so they keep their original names while the labels moved.
 * The 65% ending (`majority`) used to be labelled "Majority", a word that
 * means "more than half" to everyone else, and Blitz is the ending that stops
 * at 50%. It is now "Conquest". The full-board ending (`conquest`) is
 * "Domination", the name the lobby, How to Play and share cards already give
 * that rule.
 */
export const QUICK_MATCH_VICTORY_LABELS: Record<QuickMatchVictoryMode, string> = {
  blitz: 'Blitz',
  majority: 'Conquest',
  capitals: 'Capitals',
  conquest: 'Domination',
};

/** One-line "what ends this match", shown under the picker and on the start button. */
export const QUICK_MATCH_VICTORY_HINTS: Record<QuickMatchVictoryMode, string> = {
  blitz: 'Hold 50% of the map — the shortest match.',
  majority: 'Hold 65% of the map. The Quick Match classic.',
  capitals: 'Capture every rival capital — your own must still be yours.',
  conquest: 'Hold every territory on the map. Expect a long match.',
};

export interface QuickMatchPrefs {
  /** Number of AI opponents (max_players is aiCount + 1 — auto-start requires a full table). */
  aiCount: number;
  aiDifficulty: QuickMatchAiDifficulty;
  victory: QuickMatchVictoryMode;
}

export const DEFAULT_QUICK_MATCH_PREFS: QuickMatchPrefs = {
  aiCount: 3,
  aiDifficulty: 'medium',
  victory: 'majority',
};

/**
 * Full Game has always been domination-only, so its default ending is the
 * full-board one (`conquest`, labelled Domination). Sharing Quick Match's 65%
 * default would have silently turned
 * every Full Game that never touched the picker — including every player whose
 * saved prefs predate it — into a 65% match: the same silent change of match
 * length Quick Match's own default was chosen to avoid.
 */
export const DEFAULT_FULL_GAME_PREFS: QuickMatchPrefs = {
  ...DEFAULT_QUICK_MATCH_PREFS,
  victory: 'conquest',
};

/**
 * With `full_game_evening_enabled`, a Full Game fits an evening: the 65%
 * ending by default, and every ending capped at FULL_GAME_EVENING_MAX_TURNS.
 * Against three Medium bots, the full-board ending ran to the 150-round cap in
 * 99% of arena games (scripts/simAiArena.ts, ARENA_RULES=full-default), about
 * 2 h 40 at a minute a turn; the 65% ending with an 80-round cap ends by
 * conquest in 63% of them, and one in five runs past 87 minutes at a minute a
 * turn (ARENA_RULES=full-evening). A player who has saved a setup of their own
 * keeps their ending; only the default moves.
 */
export const EVENING_FULL_GAME_PREFS: QuickMatchPrefs = {
  ...DEFAULT_QUICK_MATCH_PREFS,
  victory: 'majority',
};

/** Full Game's own round cap, whatever the ending: an era-advancement game is longer than any Quick Match. */
export const FULL_GAME_MAX_TURNS = 150;
/** The cap with `full_game_evening_enabled`. */
export const FULL_GAME_EVENING_MAX_TURNS = 80;

export function fullGameMaxTurns(evening: boolean): number {
  return evening ? FULL_GAME_EVENING_MAX_TURNS : FULL_GAME_MAX_TURNS;
}

/**
 * With `full_game_ages_ending_enabled`, a Full Game ends by the eras. Over
 * 52,340 simulated games (docs/full-game-pacing/REPORT.md) the 65% ending on
 * its own ended one even game in five by round 20 with the winner still in the
 * Ancient era, and a strong player's in 11 rounds, because 65% of the starting
 * board is 22 territories and of the board the eras open, 38. These settings
 * tie conquest to the eras instead (backend victory/conquestRules.ts):
 *
 *   - conquest counts only for a player in the last era;
 *   - once anyone is there, the share needed holds for five rounds and then
 *     falls 3 points a round until somebody holds it;
 *   - a win is claimed as the holder's own turn opens, so every rival has one
 *     turn to take it back.
 *
 * A median 51 rounds whoever is at the table, with no round cap and no era
 * lead cap. The server keeps the settings only while its own flag is on.
 */
export const FULL_GAME_AGES_CONQUEST = {
  conquest_final_era_only: true,
  conquest_decay_points_per_round: 3,
  conquest_decay_delay_rounds: 5,
  conquest_claim_at_turn_start: true,
} as const;

/** The era lead cap Full Game sends without `full_game_ages_ending_enabled` (see startFullGame). */
export const FULL_GAME_ERA_MAX_LEAD = 2;

export interface FullGameFlags {
  /** `full_game_evening_enabled`. */
  evening: boolean;
  /** `full_game_ages_ending_enabled`. */
  ages: boolean;
}

/** Whether this Full Game is won by era-tied conquest: the flag is on and its ending holds a share of the map. */
export function fullGameUsesAgesConquest(prefs: QuickMatchPrefs, flags: FullGameFlags): boolean {
  const plan = QUICK_MATCH_VICTORY_PLANS[prefs.victory] ?? QUICK_MATCH_VICTORY_PLANS.majority;
  return flags.ages && plan.allowed_victory_conditions.includes('threshold');
}

/**
 * How a Full Game ends and what bounds it, as create settings: the chosen
 * ending, then Full Game's own cap in place of the ending's (Blitz's 45 rounds
 * would end most Full Games on the cap instead of on the criterion).
 *
 * With `full_game_ages_ending_enabled` an ending that holds a share of the map
 * (the default, and Blitz) is era-tied conquest with no cap, and no Full Game
 * sends the era lead cap: one seat that never advances held every other seat
 * out of the last three eras under it. An ending the player chose that holds
 * no share (the whole board, capitals) keeps today's cap, since nothing else
 * would end it against bots.
 */
export function fullGameEndingSettings(prefs: QuickMatchPrefs, flags: FullGameFlags): {
  allowed_victory_conditions: QuickMatchVictoryCondition[];
  victory_threshold?: number;
  max_turns?: number;
  era_advancement_max_lead?: number;
  conquest_final_era_only?: boolean;
  conquest_decay_points_per_round?: number;
  conquest_decay_delay_rounds?: number;
  conquest_claim_at_turn_start?: boolean;
} {
  const { max_turns: _endingCap, ...ending } = quickMatchVictorySettings(prefs);
  return {
    ...ending,
    ...(fullGameUsesAgesConquest(prefs, flags) ? FULL_GAME_AGES_CONQUEST : { max_turns: fullGameMaxTurns(flags.evening) }),
    ...(flags.ages ? {} : { era_advancement_max_lead: FULL_GAME_ERA_MAX_LEAD }),
  };
}

function fullGameDefaults(evening: boolean): QuickMatchPrefs {
  return evening ? EVENING_FULL_GAME_PREFS : DEFAULT_FULL_GAME_PREFS;
}

export const QUICK_MATCH_DIFFICULTY_LABELS: Record<QuickMatchAiDifficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  expert: 'Expert',
};

export const QUICK_MATCH_DIFFICULTY_HINTS: Record<QuickMatchAiDifficulty, string> = {
  easy: 'Forgiving pace — good while learning.',
  medium: 'The balanced default.',
  hard: 'Sharper expansion and defense.',
  // Expert plays Hard's turn without its scoring jitter; measured, it wins about
  // as often as Hard, so the hint promises no more than that.
  expert: 'Plays like Hard, with no random slips.',
};

// Quick Match and Full Game Start remember their setups independently — a
// player's "quick stomp" table and their "long campaign" table usually differ.
const QUICK_MATCH_STORAGE_KEY = 'cc-quick-match-prefs';
const FULL_GAME_STORAGE_KEY = 'cc-full-game-prefs';

/**
 * Coerce anything (bad JSON shapes, stale values) into valid prefs, field by
 * field. `defaults` fills what is missing or invalid — each surface passes its
 * own, so a pre-picker saved shape lands on that surface's historical ending.
 */
export function sanitizeQuickMatchPrefs(
  raw: unknown,
  defaults: QuickMatchPrefs = DEFAULT_QUICK_MATCH_PREFS,
): QuickMatchPrefs {
  const prefs = { ...defaults };
  if (typeof raw !== 'object' || raw === null) return prefs;

  const candidate = raw as Record<string, unknown>;
  const count = candidate.aiCount;
  if (typeof count === 'number' && Number.isInteger(count) && count >= QUICK_MATCH_MIN_AI && count <= QUICK_MATCH_MAX_AI) {
    prefs.aiCount = count;
  }
  const difficulty = candidate.aiDifficulty;
  if (typeof difficulty === 'string' && (QUICK_MATCH_AI_DIFFICULTIES as readonly string[]).includes(difficulty)) {
    prefs.aiDifficulty = difficulty as QuickMatchAiDifficulty;
  }
  const victory = candidate.victory;
  if (typeof victory === 'string' && (QUICK_MATCH_VICTORY_MODES as readonly string[]).includes(victory)) {
    prefs.victory = victory as QuickMatchVictoryMode;
  }
  return prefs;
}

function hasSaved(storageKey: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(storageKey) !== null;
  } catch {
    return false;
  }
}

/** Whether the player has saved a Quick Match setup of their own (the picker saves on every change). */
export function hasSavedQuickMatchPrefs(): boolean {
  return hasSaved(QUICK_MATCH_STORAGE_KEY);
}

/** Whether the player has saved a Full Game setup of their own (the pickers save on every change). */
export function hasSavedFullGamePrefs(): boolean {
  return hasSaved(FULL_GAME_STORAGE_KEY);
}

function loadPrefs(storageKey: string, defaults: QuickMatchPrefs): QuickMatchPrefs {
  if (typeof window === 'undefined') return { ...defaults };
  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return { ...defaults };
    return sanitizeQuickMatchPrefs(JSON.parse(stored), defaults);
  } catch {
    return { ...defaults };
  }
}

function savePrefs(storageKey: string, prefs: QuickMatchPrefs, defaults: QuickMatchPrefs): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(sanitizeQuickMatchPrefs(prefs, defaults)));
  } catch {
    // Storage unavailable (private mode etc.) — prefs just won't persist.
  }
}

export function loadQuickMatchPrefs(): QuickMatchPrefs {
  return loadPrefs(QUICK_MATCH_STORAGE_KEY, DEFAULT_QUICK_MATCH_PREFS);
}

export function saveQuickMatchPrefs(prefs: QuickMatchPrefs): void {
  savePrefs(QUICK_MATCH_STORAGE_KEY, prefs, DEFAULT_QUICK_MATCH_PREFS);
}

/** A player's Full Game setup; `evening` picks the default for one who has not saved their own. */
export function loadFullGamePrefs(evening = false): QuickMatchPrefs {
  return loadPrefs(FULL_GAME_STORAGE_KEY, fullGameDefaults(evening));
}

export function saveFullGamePrefs(prefs: QuickMatchPrefs, evening = false): void {
  savePrefs(FULL_GAME_STORAGE_KEY, prefs, fullGameDefaults(evening));
}

/** Short human description, e.g. "3 Medium AI" — used on the lobby buttons. */
export function describeQuickMatchPrefs(prefs: QuickMatchPrefs): string {
  return `${prefs.aiCount} ${QUICK_MATCH_DIFFICULTY_LABELS[prefs.aiDifficulty]} AI`;
}

/**
 * The create-game settings fragment for the chosen ending. Kept beside the
 * prefs (rather than inline in the lobby) so the payload and the copy the
 * player read in the picker can never drift apart.
 */
export function quickMatchVictorySettings(prefs: QuickMatchPrefs): {
  allowed_victory_conditions: QuickMatchVictoryCondition[];
  victory_threshold?: number;
  max_turns: number;
} {
  const plan = QUICK_MATCH_VICTORY_PLANS[prefs.victory] ?? QUICK_MATCH_VICTORY_PLANS.majority;
  const settings: {
    allowed_victory_conditions: QuickMatchVictoryCondition[];
    victory_threshold?: number;
    max_turns: number;
  } = {
    allowed_victory_conditions: [...plan.allowed_victory_conditions],
    max_turns: plan.max_turns,
  };
  // The create schema REJECTS a threshold list without a percentage, and
  // silently ignores a percentage without the list — send it only in step.
  if (plan.allowed_victory_conditions.includes('threshold') && plan.victory_threshold != null) {
    settings.victory_threshold = plan.victory_threshold;
  }
  return settings;
}
