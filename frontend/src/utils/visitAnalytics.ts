/**
 * Fire-and-forget pre-auth analytics beacons (POST /api/analytics/visit).
 * Unauthenticated by design — logged-out landing visitors have no token — so
 * this is the ONE channel that runs before signup. The server enforces a
 * strict event allowlist + rate limit and drops everything silently when the
 * analytics_events_enabled flag is off.
 *
 * Never throws, never blocks the page: failures are swallowed like every
 * other analytics call site (see the api.post('/analytics/ui-event') pattern).
 */
import { api } from '../services/api';
import { getAnonSessionId } from './anonSession';

export type VisitEvent = 'landing_viewed' | 'hero_play_clicked';

/** Session-scoped dedupe so a re-render or route bounce doesn't double-count. */
const sentThisTab = new Set<string>();

export function trackVisitEvent(
  event: VisitEvent,
  properties?: Record<string, string>,
  opts?: { oncePerTab?: boolean },
): void {
  const anonSessionId = getAnonSessionId();
  if (!anonSessionId) return; // storage/crypto unavailable — skip silently
  if (opts?.oncePerTab) {
    if (sentThisTab.has(event)) return;
    sentThisTab.add(event);
  }
  api
    .post('/analytics/visit', { event, anon_session_id: anonSessionId, properties })
    .catch(() => {});
}
