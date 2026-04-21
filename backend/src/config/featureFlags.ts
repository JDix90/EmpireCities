import { config } from './index';

/**
 * Feature flags from environment (Phase C rollout). Defaults favor safe/off in production.
 */
export const featureFlags = {
  /** When true, emit structured analytics events to logs (see analyticsEvents). */
  analyticsEventsEnabled: process.env.ANALYTICS_EVENTS_ENABLED === 'true',

  /** When true, expose basic process metrics on GET /metrics/json (no secrets). */
  metricsEndpointEnabled: process.env.METRICS_ENDPOINT_ENABLED !== 'false',

  /** Verbose socket debug (development only — never enable in prod). */
  socketDebug: config.nodeEnv === 'development' && process.env.SOCKET_DEBUG === 'true',
} as const;
