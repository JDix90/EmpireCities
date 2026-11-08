import { api } from '../services/api';

/**
 * Fire-and-forget product analytics (POST /api/analytics/ui-event). The
 * server keeps a strict allowlist of event names and drops everything when
 * analytics_events_enabled is off; failures never surface to the player.
 */
export function trackUiEvent(event: string, properties?: Record<string, string | number | boolean>): void {
  // Through a resolved promise so neither a thrown error nor a rejected one
  // ever reaches the caller.
  Promise.resolve()
    .then(() => api.post('/analytics/ui-event', properties ? { event, properties } : { event }))
    .catch(() => {});
}
