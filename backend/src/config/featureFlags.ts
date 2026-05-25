import { config } from './index';
import { getFeatureFlagOverrides } from '../services/adminConfig';

function overrideBool(key: string, envDefault: boolean): boolean {
  const o = getFeatureFlagOverrides();
  if (Object.prototype.hasOwnProperty.call(o, key) && typeof (o as Record<string, unknown>)[key] === 'boolean') {
    return (o as Record<string, boolean>)[key];
  }
  return envDefault;
}

/**
 * Feature flags from environment (Phase C rollout). Defaults favor safe/off in production.
 * Admin may override via `admin_config.feature_flags` (see `getFeatureFlagOverrides`).
 */
export const featureFlags = {
  /** When true, emit structured analytics events to logs (see analyticsEvents). */
  get analyticsEventsEnabled(): boolean {
    return overrideBool('analytics_events_enabled', process.env.ANALYTICS_EVENTS_ENABLED === 'true');
  },

  /**
   * When true, expose basic process metrics on GET /metrics/json (no secrets).
   *
   * Default: **on in development**, **off in production**. The endpoint reveals
   * `active_game_rooms` and process memory which are useful internally but make
   * a public deploy easier to fingerprint / size-attack. Set
   * `METRICS_ENDPOINT_ENABLED=true` in prod (paired with reverse-proxy auth or
   * an internal-only listener) when you want to scrape it.
   */
  get metricsEndpointEnabled(): boolean {
    const envValue = process.env.METRICS_ENDPOINT_ENABLED;
    let envDefault: boolean;
    if (envValue == null || envValue === '') {
      envDefault = config.nodeEnv !== 'production';
    } else {
      envDefault = envValue === 'true';
    }
    return overrideBool('metrics_endpoint_enabled', envDefault);
  },

  /** Verbose socket debug (development only — never enable in prod). */
  get socketDebug(): boolean {
    return overrideBool(
      'socket_debug',
      config.nodeEnv === 'development' && process.env.SOCKET_DEBUG === 'true',
    );
  },
};
