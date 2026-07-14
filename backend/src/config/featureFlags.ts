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
   * When true, the in-game "turn clarity" affordances are shown: the persistent
   * phase-progression bar, valid source/target highlighting, and reinforcement
   * undo. Purely presentational/quality-of-life; the server stays authoritative.
   * Default OFF — dark-launch; flip on via `TURN_CLARITY_ENABLED=true` or the
   * `turn_clarity_enabled` admin override after a staging check.
   */
  get turnClarityEnabled(): boolean {
    return overrideBool('turn_clarity_enabled', process.env.TURN_CLARITY_ENABLED === 'true');
  },

  /**
   * When true, the landing page's "Play as Guest" CTA drops a brand-new guest
   * straight into the guided tutorial match (/tutorial?start=1) instead of the
   * lobby — collapsing landing → lobby → welcome-modal → tutorial into one click.
   * Client-side routing only. Default OFF — dark-launch so it can be A/B'd
   * (guest → tutorial vs guest → lobby) against the first-session funnel.
   */
  get onboardingTutorialFirstEnabled(): boolean {
    return overrideBool('onboarding_tutorial_first_enabled', process.env.ONBOARDING_TUTORIAL_FIRST_ENABLED === 'true');
  },

  /**
   * When true, the landing hero collapses to ONE dominant Play CTA (direct
   * guest start + "No account • No download" microcopy + a single "See
   * gameplay" secondary); the competing nav Play/Learn buttons hide and Sign
   * In demotes to a header utility. Presentational A/B — hero_play_clicked
   * carries a `variant` prop so the visitor funnel reads the test directly.
   * Default OFF — dark-launch.
   */
  get heroSingleCtaEnabled(): boolean {
    return overrideBool('hero_single_cta_enabled', process.env.HERO_SINGLE_CTA_ENABLED === 'true');
  },

  /**
   * When true, advancing an era shows the advancing player a "payoff" moment —
   * a celebratory modal naming the era entered, the newly-unlocked signature
   * ability, the legacy carry, and the vulnerability window — instead of just a
   * toast. Client-side only (era advancement itself is unchanged). Default OFF —
   * dark-launch; flip via `ERA_ADVANCE_PAYOFF_ENABLED=true` or the admin override.
   */
  get eraAdvancePayoffEnabled(): boolean {
    return overrideBool('era_advance_payoff_enabled', process.env.ERA_ADVANCE_PAYOFF_ENABLED === 'true');
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

  /**
   * When true, guests get a one-time "save your progress — create a free
   * account" nudge after finishing a non-tutorial game (once per tab session,
   * client-side). Default OFF (dark-launch, matching first_turn_coach) — flip on
   * via `SIGNUP_NUDGE_ENABLED=true` or the `signup_nudge_enabled` admin override
   * after a staging eyeball.
   */
  get signupNudgeEnabled(): boolean {
    return overrideBool('signup_nudge_enabled', process.env.SIGNUP_NUDGE_ENABLED === 'true');
  },

  /**
   * When true, the retention notification worker sends scheduled re-engagement
   * push/email (streak-at-risk, daily-challenge reminder, D2/D7 win-back).
   * Default OFF — dark-launch so the sweep can be enabled (and killed) from
   * the admin panel via the `retention_notifications_enabled` override without
   * a redeploy. See workers/retentionNotificationWorker.ts.
   */
  get retentionNotificationsEnabled(): boolean {
    return overrideBool('retention_notifications_enabled', process.env.RETENTION_NOTIFICATIONS_ENABLED === 'true');
  },

  /**
   * When true, users can buy streak freezes (POST /progression/streak-freeze)
   * and the Today panel / comeback panel show freeze state. Consumption of an
   * already-held freeze in updateDailyStreak is deliberately NOT gated — once
   * sold, a freeze must keep working even if sales are switched back off.
   * Default OFF — dark-launch.
   */
  get streakFreezesEnabled(): boolean {
    return overrideBool('streak_freezes_enabled', process.env.STREAK_FREEZES_ENABLED === 'true');
  },

  /**
   * When true, the lobby's right column swaps the Daily Challenge card +
   * DailyLoginCalendar for the unified Today panel. Purely presentational —
   * same endpoints either way. Default OFF — dark-launch.
   */
  get todayPanelEnabled(): boolean {
    return overrideBool('today_panel_enabled', process.env.TODAY_PANEL_ENABLED === 'true');
  },

  /**
   * When true, new-user surfaces nudge toward multi-day async games vs humans:
   * the post-tutorial "challenge a friend" CTA and the Today panel's
   * "start a multi-day game" row. Default OFF — dark-launch; activation-neutral
   * because instant solo stays the primary CTA everywhere.
   */
  get asyncOnboardingEnabled(): boolean {
    return overrideBool('async_onboarding_enabled', process.env.ASYNC_ONBOARDING_ENABLED === 'true');
  },

  /**
   * When true, the Watch/Spectate surface is live: the "Live" nav + lobby
   * entries, GET /api/games/live, and `game:spectate_join`. Default OFF — at a
   * small player count the live list is mostly empty or stale, which reads
   * worse than no list at all. Flip on via `SPECTATE_ENABLED=true` or the
   * `spectate_enabled` admin override once there's enough concurrent traffic.
   * Enforced server-side (list + socket join), not just hidden in the client.
   */
  get spectateEnabled(): boolean {
    return overrideBool('spectate_enabled', process.env.SPECTATE_ENABLED === 'true');
  },

  /**
   * When true, a standalone (non-era-advancement) Space Age game seeds the 8
   * authored `unlock_era_index` frontier tiles (the 2100 expansion) as neutral
   * garrisons at start — the full authored 63-tile board instead of the 55-tile
   * base. Without it those tiles are dead content standalone (the growth machinery
   * only runs under era advancement). Default OFF — dark-launch so the enlarged
   * board can be balance-checked before flipping on via `SPACE_AGE_FRONTIERS_ENABLED=true`
   * or the `space_age_frontiers_enabled` admin override. Baked into game settings
   * at create; the engine reads the setting (stays pure).
   */
  get spaceAgeFrontiersEnabled(): boolean {
    return overrideBool('space_age_frontiers_enabled', process.env.SPACE_AGE_FRONTIERS_ENABLED === 'true');
  },
};

/** Client-safe flags exposed on GET /api/feature-flags (no secrets). */
export function getClientFeatureFlags(): Record<string, boolean> {
  return {
    map_editor_enabled: featureFlags.mapEditorEnabled,
    era_advancement_lobby_enabled: featureFlags.eraAdvancementLobbyEnabled,
    first_turn_coach_enabled: featureFlags.firstTurnCoachEnabled,
    turn_clarity_enabled: featureFlags.turnClarityEnabled,
    onboarding_tutorial_first_enabled: featureFlags.onboardingTutorialFirstEnabled,
    hero_single_cta_enabled: featureFlags.heroSingleCtaEnabled,
    era_advance_payoff_enabled: featureFlags.eraAdvancePayoffEnabled,
    signup_nudge_enabled: featureFlags.signupNudgeEnabled,
    streak_freezes_enabled: featureFlags.streakFreezesEnabled,
    today_panel_enabled: featureFlags.todayPanelEnabled,
    async_onboarding_enabled: featureFlags.asyncOnboardingEnabled,
    spectate_enabled: featureFlags.spectateEnabled,
    space_age_frontiers_enabled: featureFlags.spaceAgeFrontiersEnabled,
  };
}
