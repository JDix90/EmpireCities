/**
 * Anonymous visitor session id for pre-auth analytics (landing_viewed,
 * hero_play_clicked). First-party only: a random UUID in localStorage — no
 * cookies, no fingerprinting, no PII — consistent with the server-side-only
 * analytics stance (see services/analyticsEvents.ts on the backend).
 *
 * The id exists so the visitor→signup funnel can stitch a landing view to a
 * later guest/account signup: it rides along on the auth attribution payload
 * and lands in the guest_created / user_registered event properties. It is
 * NEVER used for authentication or personalization.
 */
import { generateActionId } from './actionId';

const ANON_SESSION_KEY = 'cc-anon-session';

/** UUID-shaped (the strict server schema rejects anything else). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns the stable anonymous session id, minting one on first call.
 * Returns null when storage is unavailable (privacy mode) or crypto.randomUUID
 * is missing (the non-UUID fallback would fail server validation) — callers
 * simply skip emitting in that case; analytics must never break the page.
 */
export function getAnonSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const existing = localStorage.getItem(ANON_SESSION_KEY);
    if (existing && UUID_RE.test(existing)) return existing;
    const minted = generateActionId();
    if (!UUID_RE.test(minted)) return null;
    localStorage.setItem(ANON_SESSION_KEY, minted);
    return minted;
  } catch {
    return null;
  }
}
