/**
 * Ranked matchmaking preferences — preferred opponent count, per era.
 *
 * A preference of P opponents means queueing for a (P+1)-player ranked game.
 * Defaults and caps are era-aware because the regional maps are much smaller
 * than the world maps (ACW has 18 territories, Risorgimento 14 vs 42–57):
 * mirrors RANKED_SIZE_BY_ERA in backend/src/modules/matchmaking/
 * matchmaking.routes.ts — keep the two tables in sync (the server clamps
 * authoritatively regardless).
 */

export const RANKED_MIN_OPPONENTS = 1;
export const RANKED_MAX_OPPONENTS = 5;

export interface RankedEraSize {
  default: number;
  max: number;
}

export const RANKED_SIZE_BY_ERA: Record<string, RankedEraSize> = {
  ancient: { default: 3, max: 5 },
  medieval: { default: 3, max: 5 },
  discovery: { default: 3, max: 5 },
  ww2: { default: 3, max: 5 },
  coldwar: { default: 3, max: 5 },
  modern: { default: 3, max: 5 },
  acw: { default: 2, max: 3 },
  risorgimento: { default: 1, max: 2 },
};

const FALLBACK_SIZE: RankedEraSize = { default: 3, max: 5 };

export function rankedEraSize(eraId: string): RankedEraSize {
  return RANKED_SIZE_BY_ERA[eraId] ?? FALLBACK_SIZE;
}

export interface RankedPrefs {
  /** Last-chosen opponent count per era id; missing eras use the era default. */
  opponentsByEra: Record<string, number>;
}

const STORAGE_KEY = 'cc-ranked-prefs';

/** Coerce anything (bad JSON shapes, stale values) into valid prefs. */
export function sanitizeRankedPrefs(raw: unknown): RankedPrefs {
  const prefs: RankedPrefs = { opponentsByEra: {} };
  if (typeof raw !== 'object' || raw === null) return prefs;
  const byEra = (raw as Record<string, unknown>).opponentsByEra;
  if (typeof byEra !== 'object' || byEra === null) return prefs;
  for (const [eraId, value] of Object.entries(byEra as Record<string, unknown>)) {
    if (!(eraId in RANKED_SIZE_BY_ERA)) continue;
    if (typeof value !== 'number' || !Number.isInteger(value)) continue;
    const { max } = rankedEraSize(eraId);
    if (value >= RANKED_MIN_OPPONENTS && value <= max) {
      prefs.opponentsByEra[eraId] = value;
    }
  }
  return prefs;
}

export function loadRankedPrefs(): RankedPrefs {
  if (typeof window === 'undefined') return { opponentsByEra: {} };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { opponentsByEra: {} };
    return sanitizeRankedPrefs(JSON.parse(stored));
  } catch {
    return { opponentsByEra: {} };
  }
}

/** The opponent count to use for an era: last saved choice, else the era default. */
export function getRankedOpponents(eraId: string): number {
  const saved = loadRankedPrefs().opponentsByEra[eraId];
  return saved ?? rankedEraSize(eraId).default;
}

export function saveRankedOpponents(eraId: string, opponents: number): void {
  const size = rankedEraSize(eraId);
  const clamped = Math.min(Math.max(Math.round(opponents), RANKED_MIN_OPPONENTS), size.max);
  try {
    const prefs = loadRankedPrefs();
    prefs.opponentsByEra[eraId] = clamped;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeRankedPrefs(prefs)));
  } catch {
    // Storage unavailable (private mode etc.) — prefs just won't persist.
  }
}

/** Short human description for an opponent count, e.g. "1v1 duel", "4-player game". */
export function describeRankedGameSize(opponents: number): string {
  return opponents === 1 ? '1v1 duel' : `${opponents + 1}-player game`;
}
