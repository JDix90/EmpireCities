import { featureFlags } from '../config/featureFlags';

export type AnalyticsPayload = Record<string, string | number | boolean | null | undefined>;

/**
 * Server-side product analytics hook. Emits one JSON line per event for log aggregation
 * (Datadog, CloudWatch, etc.). Wire transports here without coupling game logic to vendors.
 */
export function recordServerEvent(event: string, payload: AnalyticsPayload = {}): void {
  if (!featureFlags.analyticsEventsEnabled) return;

  const line = JSON.stringify({
    type: 'analytics',
    event,
    ts: new Date().toISOString(),
    ...payload,
  });
  console.log(line);
}
