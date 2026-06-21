import { featureFlags } from '../config/featureFlags';
import { query } from '../db/postgres';

export type AnalyticsPayload = Record<string, string | number | boolean | null | undefined>;

/**
 * Server-side product analytics hook (first-party only — no vendor SDKs, no
 * client cookies). Each call:
 *   1. emits one JSON line for log tailing/aggregation, and
 *   2. persists a durable, queryable row to `analytics_events` so funnels and
 *      retention can be computed later (see backend/scripts/funnelReport.ts).
 *
 * Gated by `analyticsEventsEnabled` (env `ANALYTICS_EVENTS_ENABLED=true` or the
 * admin `analytics_events_enabled` override). Fire-and-forget: the DB write is
 * never awaited and never throws into the caller, so instrumenting a request
 * path can't slow it down or break it.
 *
 * @param event   short event name (e.g. 'guest_created', 'game_finished')
 * @param payload flat JSON properties (stored in `properties`)
 * @param userId  the acting user's UUID, if any (stored first-class for cohorts)
 */
export function recordServerEvent(
  event: string,
  payload: AnalyticsPayload = {},
  userId?: string | null,
): void {
  if (!featureFlags.analyticsEventsEnabled) return;

  const line = JSON.stringify({
    type: 'analytics',
    event,
    ts: new Date().toISOString(),
    user_id: userId ?? null,
    ...payload,
  });
  console.log(line);

  void persistEvent(event, payload, userId ?? null);
}

async function persistEvent(
  event: string,
  payload: AnalyticsPayload,
  userId: string | null,
): Promise<void> {
  try {
    await query(
      `INSERT INTO analytics_events (event, user_id, properties)
       VALUES ($1, $2, $3)`,
      [event, userId, JSON.stringify(payload)],
    );
  } catch (err) {
    // Analytics must never break the request path — log and move on.
    console.warn(`[analytics] failed to persist event "${event}":`, err);
  }
}
