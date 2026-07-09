/**
 * Quick Match preferences — opponent count + AI difficulty.
 *
 * Quick Match stays one-click: the button starts immediately with whatever was
 * used last (default 3 medium AI). The options popover writes here so an
 * experienced player can play Hard/Expert or a different table size without
 * building a Custom Game every time.
 */

export const QUICK_MATCH_AI_DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'] as const;
export type QuickMatchAiDifficulty = (typeof QUICK_MATCH_AI_DIFFICULTIES)[number];

export const QUICK_MATCH_MIN_AI = 1;
export const QUICK_MATCH_MAX_AI = 7;

export interface QuickMatchPrefs {
  /** Number of AI opponents (max_players is aiCount + 1 — auto-start requires a full table). */
  aiCount: number;
  aiDifficulty: QuickMatchAiDifficulty;
}

export const DEFAULT_QUICK_MATCH_PREFS: QuickMatchPrefs = {
  aiCount: 3,
  aiDifficulty: 'medium',
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

const STORAGE_KEY = 'cc-quick-match-prefs';

/** Coerce anything (bad JSON shapes, stale values) into valid prefs, field by field. */
export function sanitizeQuickMatchPrefs(raw: unknown): QuickMatchPrefs {
  const prefs = { ...DEFAULT_QUICK_MATCH_PREFS };
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
  return prefs;
}

export function loadQuickMatchPrefs(): QuickMatchPrefs {
  if (typeof window === 'undefined') return { ...DEFAULT_QUICK_MATCH_PREFS };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { ...DEFAULT_QUICK_MATCH_PREFS };
    return sanitizeQuickMatchPrefs(JSON.parse(stored));
  } catch {
    return { ...DEFAULT_QUICK_MATCH_PREFS };
  }
}

export function saveQuickMatchPrefs(prefs: QuickMatchPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeQuickMatchPrefs(prefs)));
  } catch {
    // Storage unavailable (private mode etc.) — prefs just won't persist.
  }
}

/** Short human description, e.g. "3 Medium AI" — used on the lobby buttons. */
export function describeQuickMatchPrefs(prefs: QuickMatchPrefs): string {
  return `${prefs.aiCount} ${QUICK_MATCH_DIFFICULTY_LABELS[prefs.aiDifficulty]} AI`;
}
