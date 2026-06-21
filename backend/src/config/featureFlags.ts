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

  /** When true, registered users can access the Map Editor UI and create/publish custom maps. */
  get mapEditorEnabled(): boolean {
    return overrideBool('map_editor_enabled', false);
  },

  /**
   * When true, brand-new players (xp 0) get a lightly-coached first turn on the
   * globe — place/attack/fortify prompts + an owned-territory pulse. First-game
   * only, globe only, gated client-side. Default OFF — dark-launch; flip on
   * after a staging check.
   */
  get firstTurnCoachEnabled(): boolean {
    return overrideBool('first_turn_coach_enabled', process.env.FIRST_TURN_COACH_ENABLED === 'true');
  },

  /**
   * When true, Era Advancement is surfaced in the lobby — the one-click "Full Game
   * Start" CTA and the in-form Era Advancement toggle (for Ancient). Default ON so
   * the flagship mode is highlighted; admin config can override off. (Ranked Era
   * Advancement is a separate flag, `ranked_era_advancement_enabled`, still off.)
   */
  get eraAdvancementLobbyEnabled(): boolean {
    return overrideBool('era_advancement_lobby_enabled', true);
  },

  /**
   * When true, ranked matchmaking creates Era Advancement games (credited to the
   * dedicated 'ranked_era_advancement' rating key). Default OFF — flipping this on
   * is a product decision pending balance review (see scripts/eraBalanceTuning.md
   * on the 1v1 snowball). Server-side only.
   */
  get rankedEraAdvancementEnabled(): boolean {
    return overrideBool('ranked_era_advancement_enabled', false);
  },
};

/** Client-safe flags exposed on GET /api/feature-flags (no secrets). */
export function getClientFeatureFlags(): Record<string, boolean> {
  return {
    map_editor_enabled: featureFlags.mapEditorEnabled,
    era_advancement_lobby_enabled: featureFlags.eraAdvancementLobbyEnabled,
    first_turn_coach_enabled: featureFlags.firstTurnCoachEnabled,
  };
}
