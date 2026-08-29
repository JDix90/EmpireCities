import { config } from './index';
import { getFeatureFlagOverrides } from '../services/adminConfig';

/** Opt-in env flag: OFF unless the variable is exactly 'true'. */
function envOptIn(name: string): boolean {
  return process.env[name] === 'true';
}

/** Opt-out env flag: ON unless the variable is exactly 'false'. */
function envOptOut(name: string): boolean {
  return process.env[name] !== 'false';
}

/**
 * Explicit env value wins ('true'/'false'); with nothing set, ON only in
 * production. For flags that should be live for players but must never fire
 * from a developer's laptop or a test run (outbound email/push).
 */
function envOrProdOnly(name: string): boolean {
  const value = process.env[name];
  if (value != null && value !== '') return value === 'true';
  return config.nodeEnv === 'production';
}

/**
 * The code default for every admin-manageable flag — the single source of truth.
 *
 * Precedence is: `admin_config.feature_flags` override (if the key is present
 * with a boolean) → this table. Nothing else may seed the override row; a key
 * pre-seeded into `DEFAULTS.feature_flags` would shadow its entry here forever
 * (see the comment on `DEFAULTS.feature_flags` in services/adminConfig.ts).
 *
 * Consumed by `overrideBool`, `getFeatureFlagStates` (admin panel three-state
 * display), and `scripts/pruneFeatureFlagOverrides.ts`.
 */
export const FLAG_CODE_DEFAULTS: Record<string, () => boolean> = {
  // Product analytics: on everywhere except tests, where the emitted JSON lines
  // and fire-and-forget inserts are pure noise.
  analytics_events_enabled: () => envOptOut('ANALYTICS_EVENTS_ENABLED') && config.nodeEnv !== 'test',
  metrics_endpoint_enabled: () => {
    const envValue = process.env.METRICS_ENDPOINT_ENABLED;
    if (envValue == null || envValue === '') return config.nodeEnv !== 'production';
    return envValue === 'true';
  },
  socket_debug: () => config.nodeEnv === 'development' && envOptIn('SOCKET_DEBUG'),

  map_editor_enabled: () => envOptIn('MAP_EDITOR_ENABLED'),
  first_turn_coach_enabled: () => envOptOut('FIRST_TURN_COACH_ENABLED'),
  turn_clarity_enabled: () => envOptOut('TURN_CLARITY_ENABLED'),
  onboarding_tutorial_first_enabled: () => envOptOut('ONBOARDING_TUTORIAL_FIRST_ENABLED'),
  hero_single_cta_enabled: () => envOptOut('HERO_SINGLE_CTA_ENABLED'),
  era_advance_payoff_enabled: () => envOptOut('ERA_ADVANCE_PAYOFF_ENABLED'),
  era_advancement_lobby_enabled: () => envOptOut('ERA_ADVANCEMENT_LOBBY_ENABLED'),
  ranked_era_advancement_enabled: () => envOptIn('RANKED_ERA_ADVANCEMENT_ENABLED'),
  signup_nudge_enabled: () => envOptOut('SIGNUP_NUDGE_ENABLED'),
  combined_tutorial_enabled: () => envOptOut('COMBINED_TUTORIAL_ENABLED'),
  // Outbound email/push — production-only unless explicitly set.
  retention_notifications_enabled: () => envOrProdOnly('RETENTION_NOTIFICATIONS_ENABLED'),
  streak_freezes_enabled: () => envOptIn('STREAK_FREEZES_ENABLED'),
  today_panel_enabled: () => envOptIn('TODAY_PANEL_ENABLED'),
  async_onboarding_enabled: () => envOptIn('ASYNC_ONBOARDING_ENABLED'),
  spectate_enabled: () => envOptIn('SPECTATE_ENABLED'),
  space_age_frontiers_enabled: () => envOptIn('SPACE_AGE_FRONTIERS_ENABLED'),
  ranked_multi_size_enabled: () => envOptIn('RANKED_MULTI_SIZE_ENABLED'),
  match_alerts_enabled: () => envOptIn('MATCH_ALERTS_ENABLED'),
};

/** The code default for one flag (no admin override consulted). */
export function getFeatureFlagCodeDefault(key: string): boolean {
  return FLAG_CODE_DEFAULTS[key]?.() ?? false;
}

function overrideBool(key: string): boolean {
  const o = getFeatureFlagOverrides();
  if (Object.prototype.hasOwnProperty.call(o, key) && typeof (o as Record<string, unknown>)[key] === 'boolean') {
    return (o as Record<string, boolean>)[key];
  }
  return getFeatureFlagCodeDefault(key);
}

export interface FeatureFlagState {
  /** What the code/env says with no admin override in play. */
  code_default: boolean;
  /** True when `admin_config.feature_flags` pins this key (a forced on/off). */
  overridden: boolean;
  /** What the app actually sees right now. */
  effective: boolean;
}

/**
 * Every admin-manageable flag with its code default, whether an override pins
 * it, and the resulting effective value. Backs the admin panel's
 * default / forced-on / forced-off display and the prune script.
 */
export function getFeatureFlagStates(): Record<string, FeatureFlagState> {
  const overrides = getFeatureFlagOverrides() as Record<string, unknown>;
  const states: Record<string, FeatureFlagState> = {};
  for (const key of Object.keys(FLAG_CODE_DEFAULTS)) {
    const codeDefault = getFeatureFlagCodeDefault(key);
    const overridden =
      Object.prototype.hasOwnProperty.call(overrides, key) && typeof overrides[key] === 'boolean';
    states[key] = {
      code_default: codeDefault,
      overridden,
      effective: overridden ? (overrides[key] as boolean) : codeDefault,
    };
  }
  return states;
}

/**
 * Feature flags. Each getter resolves an admin override first, then falls back
 * to its `FLAG_CODE_DEFAULTS` entry — so a flag's committed default lives in
 * exactly one place and the `admin_config.feature_flags` row means "explicit
 * operator override" (the kill switch), nothing more.
 */
export const featureFlags = {
  /**
   * When true, emit structured analytics events to logs and persist them to
   * `analytics_events`. Default ON (off in tests) — the funnel and retention
   * reports are only as good as the cohort history, which accrues from the
   * moment this is live.
   */
  get analyticsEventsEnabled(): boolean {
    return overrideBool('analytics_events_enabled');
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
    return overrideBool('metrics_endpoint_enabled');
  },

  /** Verbose socket debug (development only — never enable in prod). */
  get socketDebug(): boolean {
    return overrideBool('socket_debug');
  },

  /**
   * When true, registered users can access the Map Editor UI and create/publish
   * custom maps. Default OFF until the publish → moderation → community loop
   * is wired end to end.
   */
  get mapEditorEnabled(): boolean {
    return overrideBool('map_editor_enabled');
  },

  /**
   * When true, brand-new players (xp 0) get a lightly-coached first turn on the
   * globe — place/attack/fortify prompts + an owned-territory pulse. First-game
   * only, globe only, gated client-side. Default ON.
   */
  get firstTurnCoachEnabled(): boolean {
    return overrideBool('first_turn_coach_enabled');
  },

  /**
   * When true, the in-game "turn clarity" affordances are shown: the persistent
   * phase-progression bar, valid source/target highlighting, and reinforcement
   * undo. Purely presentational/quality-of-life; the server stays authoritative.
   * Default ON.
   */
  get turnClarityEnabled(): boolean {
    return overrideBool('turn_clarity_enabled');
  },

  /**
   * When true, the landing page's "Play as Guest" CTA drops a brand-new guest
   * straight into the guided tutorial match (/tutorial?start=1) instead of the
   * lobby — collapsing landing → lobby → welcome-modal → tutorial into one click.
   * Client-side routing only. Default ON.
   */
  get onboardingTutorialFirstEnabled(): boolean {
    return overrideBool('onboarding_tutorial_first_enabled');
  },

  /**
   * When true, the landing hero collapses to ONE dominant Play CTA (direct
   * guest start + "No account • No download" microcopy + a single "See
   * gameplay" secondary); the competing nav Play/Learn buttons hide and Sign
   * In demotes to a header utility. `hero_play_clicked` carries a `variant`
   * prop so the visitor funnel still reads the split. Default ON.
   */
  get heroSingleCtaEnabled(): boolean {
    return overrideBool('hero_single_cta_enabled');
  },

  /**
   * When true, advancing an era shows the advancing player a "payoff" moment —
   * a celebratory modal naming the era entered, the newly-unlocked signature
   * ability, the legacy carry, and the vulnerability window — instead of just a
   * toast. Client-side only (era advancement itself is unchanged). Default ON.
   */
  get eraAdvancePayoffEnabled(): boolean {
    return overrideBool('era_advance_payoff_enabled');
  },

  /**
   * When true, Era Advancement is surfaced in the lobby — the one-click "Full Game
   * Start" CTA and the in-form Era Advancement toggle (for Ancient). Default ON so
   * the flagship mode is highlighted; admin config can override off. (Ranked Era
   * Advancement is a separate flag, `ranked_era_advancement_enabled`, still off.)
   */
  get eraAdvancementLobbyEnabled(): boolean {
    return overrideBool('era_advancement_lobby_enabled');
  },

  /**
   * When true, ranked matchmaking creates Era Advancement games (credited to the
   * dedicated 'ranked_era_advancement' rating key). Default OFF — flipping this on
   * is a product decision pending balance review (see scripts/eraBalanceTuning.md
   * on the 1v1 snowball). Server-side only.
   */
  get rankedEraAdvancementEnabled(): boolean {
    return overrideBool('ranked_era_advancement_enabled');
  },

  /**
   * When true, guests get a one-time "save your progress — create a free
   * account" nudge after finishing a non-tutorial game (once per tab session,
   * client-side). Default ON.
   */
  get signupNudgeEnabled(): boolean {
    return overrideBool('signup_nudge_enabled');
  },

  /**
   * When true, the core tutorial is the combined first game: one continuous
   * match on Tutorial Island that teaches draft/attack/fortify AND carries the
   * player through researching a tech and advancing an era, instead of ending
   * in preview modals for features the match doesn't have. Default ON — this is
   * the first-session path, and era advancement is the thing that makes
   * Borderfall not-Risk. Switching it off returns new tutorials to the WW2
   * core lesson; games already in flight keep the shape they started with.
   */
  get combinedTutorialEnabled(): boolean {
    return overrideBool('combined_tutorial_enabled');
  },

  /**
   * When true, the retention notification worker sends scheduled re-engagement
   * push/email (streak-at-risk, daily-challenge reminder, D2/D7 win-back).
   * Default ON **in production only** — outbound mail must never fire from a
   * developer's machine or a test run. Set `RETENTION_NOTIFICATIONS_ENABLED`
   * explicitly to force either way; the `retention_notifications_enabled`
   * admin override is the live kill switch.
   * See workers/retentionNotificationWorker.ts.
   */
  get retentionNotificationsEnabled(): boolean {
    return overrideBool('retention_notifications_enabled');
  },

  /**
   * When true, users can buy streak freezes (POST /progression/streak-freeze)
   * and the Today panel / comeback panel show freeze state. Consumption of an
   * already-held freeze in updateDailyStreak is deliberately NOT gated — once
   * sold, a freeze must keep working even if sales are switched back off.
   * Default OFF — dark-launch.
   */
  get streakFreezesEnabled(): boolean {
    return overrideBool('streak_freezes_enabled');
  },

  /**
   * When true, the lobby's right column swaps the Daily Challenge card +
   * DailyLoginCalendar for the unified Today panel. Purely presentational —
   * same endpoints either way. Default OFF — dark-launch.
   */
  get todayPanelEnabled(): boolean {
    return overrideBool('today_panel_enabled');
  },

  /**
   * When true, new-user surfaces nudge toward multi-day async games vs humans:
   * the post-tutorial "challenge a friend" CTA and the Today panel's
   * "start a multi-day game" row. Default OFF — dark-launch; activation-neutral
   * because instant solo stays the primary CTA everywhere.
   */
  get asyncOnboardingEnabled(): boolean {
    return overrideBool('async_onboarding_enabled');
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
    return overrideBool('spectate_enabled');
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
    return overrideBool('space_age_frontiers_enabled');
  },

  /**
   * When true, ranked matchmaking supports variable game sizes: the lobby shows
   * an opponents-count dropdown (1–5, era-capped), the queue matches cohorts of
   * `preferred_opponents + 1` players, and joiners with a larger preference get
   * a one-time offer to complete a smaller near-full game. Default OFF —
   * dark-launch; flip via `RANKED_MULTI_SIZE_ENABLED=true` or the
   * `ranked_multi_size_enabled` admin override. Kill-switch note: when flipped
   * OFF, any queued rows with preferred_opponents > 1 are drained as plain 1v1
   * (attemptMatch ignores the preference column entirely), so nobody strands.
   */
  get rankedMultiSizeEnabled(): boolean {
    return overrideBool('ranked_multi_size_enabled');
  },

  /**
   * When true, ranked match-found alerts are live: the client mounts an
   * app-wide socket listener (toast + navigate from any page, OS notification
   * on hidden tabs, missed-match catch-up) and the server sends an FCM push
   * ("Match found!") to each matched player, gated on their existing
   * user_preferences.push_enabled. Default OFF — dark-launch; the app-wide
   * always-on websocket per authed tab is the infra change this kill switch
   * exists for. Flip via `MATCH_ALERTS_ENABLED=true` or the
   * `match_alerts_enabled` admin override.
   */
  get matchAlertsEnabled(): boolean {
    return overrideBool('match_alerts_enabled');
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
    combined_tutorial_enabled: featureFlags.combinedTutorialEnabled,
    streak_freezes_enabled: featureFlags.streakFreezesEnabled,
    today_panel_enabled: featureFlags.todayPanelEnabled,
    async_onboarding_enabled: featureFlags.asyncOnboardingEnabled,
    spectate_enabled: featureFlags.spectateEnabled,
    space_age_frontiers_enabled: featureFlags.spaceAgeFrontiersEnabled,
    ranked_multi_size_enabled: featureFlags.rankedMultiSizeEnabled,
    match_alerts_enabled: featureFlags.matchAlertsEnabled,
  };
}
