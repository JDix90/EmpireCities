/**
 * Ranked search marker — records that this browser started a ranked search,
 * so the app-wide match notifier can detect a match that formed while the
 * client wasn't listening (tab closed, socket down) and surface it on return.
 *
 * Lifecycle: set on successful /matchmaking/join; cleared on /matchmaking/leave,
 * on a delivered matchmaking:found, and when the catch-up check resolves
 * (match surfaced OR queue found empty). The timestamp is client-clock epoch
 * ms — catch-up compares it against server game timestamps with a generous
 * skew allowance, so mild clock drift only risks a missed toast, never a loop.
 */

export interface RankedSearchMarker {
  /** Client-clock epoch ms when the search began. */
  queued_at: number;
  era_id: string;
  bucket: string;
}

const STORAGE_KEY = 'cc-ranked-search';

/** Ten hours — a marker older than this is stale noise, not a live search. */
const MAX_MARKER_AGE_MS = 10 * 60 * 60 * 1000;

export function sanitizeRankedSearchMarker(raw: unknown): RankedSearchMarker | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  const queuedAt = candidate.queued_at;
  if (typeof queuedAt !== 'number' || !Number.isFinite(queuedAt) || queuedAt <= 0) return null;
  if (Date.now() - queuedAt > MAX_MARKER_AGE_MS) return null;
  return {
    queued_at: queuedAt,
    era_id: typeof candidate.era_id === 'string' ? candidate.era_id : '',
    bucket: typeof candidate.bucket === 'string' ? candidate.bucket : '',
  };
}

export function getRankedSearchMarker(): RankedSearchMarker | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    return sanitizeRankedSearchMarker(JSON.parse(stored));
  } catch {
    return null;
  }
}

export function setRankedSearchMarker(eraId: string, bucket: string): void {
  try {
    const marker: RankedSearchMarker = { queued_at: Date.now(), era_id: eraId, bucket };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(marker));
  } catch {
    // Storage unavailable — catch-up just won't fire; live socket alerts still do.
  }
}

export function clearRankedSearchMarker(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
