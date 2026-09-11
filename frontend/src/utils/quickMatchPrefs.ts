/**
 * Quick Match preferences — opponent count, AI difficulty, and win criteria.
 *
 * Quick Match stays one-click: the button starts immediately with whatever was
 * used last (default 3 medium AI, Majority). The options popover writes here so
 * an experienced player can play Hard/Expert, a different table size, or a
 * different ending without building a Custom Game every time.
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
  /**
   * Whether winning requires holding the ENTIRE board. Quick Match rolls a
   * random era and Space Age keeps a third of its tiles behind an orbit gate,
   * so a full-board ending has to steer the roll away from it.
   */
  requiresFullBoard: boolean;
}

export const QUICK_MATCH_VICTORY_PLANS: Record<QuickMatchVictoryMode, QuickMatchVictoryPlan> = {
  blitz: {
    allowed_victory_conditions: ['domination', 'threshold'],
    victory_threshold: 50,
    max_turns: 45,
    requiresFullBoard: false,
  },
  majority: {
    allowed_victory_conditions: ['domination', 'threshold'],
    victory_threshold: 65,
    max_turns: 60,
    requiresFullBoard: false,
  },
  capitals: {
    // Domination rides along as the decisive fallback: capitals move when a
    // rival is eliminated, and a player who has taken the whole board has
    // plainly won either way.
    allowed_victory_conditions: ['capital', 'domination'],
    max_turns: 90,
    requiresFullBoard: false,
  },
  conquest: {
    allowed_victory_conditions: ['domination'],
    max_turns: 120,
    requiresFullBoard: true,
  },
};

export const QUICK_MATCH_VICTORY_LABELS: Record<QuickMatchVictoryMode, string> = {
  blitz: 'Blitz',
  majority: 'Majority',
  capitals: 'Capitals',
  conquest: 'Conquest',
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
 * Full Game has always been domination-only, so its default ending is
 * Conquest. Sharing Quick Match's Majority default would have silently turned
 * every Full Game that never touched the picker — including every player whose
 * saved prefs predate it — into a 65% match: the same silent change of match
 * length Quick Match's own default was chosen to avoid.
 */
export const DEFAULT_FULL_GAME_PREFS: QuickMatchPrefs = {
  ...DEFAULT_QUICK_MATCH_PREFS,
  victory: 'conquest',
};

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
  expert: 'Ruthless — deepest planning, no slack.',
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

export function loadFullGamePrefs(): QuickMatchPrefs {
  return loadPrefs(FULL_GAME_STORAGE_KEY, DEFAULT_FULL_GAME_PREFS);
}

export function saveFullGamePrefs(prefs: QuickMatchPrefs): void {
  savePrefs(FULL_GAME_STORAGE_KEY, prefs, DEFAULT_FULL_GAME_PREFS);
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

/** Whether the chosen ending needs the whole board (i.e. no orbit-gated era). */
export function quickMatchRequiresFullBoard(prefs: QuickMatchPrefs): boolean {
  return (QUICK_MATCH_VICTORY_PLANS[prefs.victory] ?? QUICK_MATCH_VICTORY_PLANS.majority).requiresFullBoard;
}
