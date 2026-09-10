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
  map_editor_enabled: () => envOptOut('MAP_EDITOR_ENABLED'),
  first_turn_coach_enabled: () => envOptOut('FIRST_TURN_COACH_ENABLED'),
  turn_clarity_enabled: () => envOptOut('TURN_CLARITY_ENABLED'),
  onboarding_tutorial_first_enabled: () => envOptOut('ONBOARDING_TUTORIAL_FIRST_ENABLED'),
  hero_single_cta_enabled: () => envOptOut('HERO_SINGLE_CTA_ENABLED'),
  era_advance_payoff_enabled: () => envOptOut('ERA_ADVANCE_PAYOFF_ENABLED'),
  era_advancement_lobby_enabled: () => envOptOut('ERA_ADVANCEMENT_LOBBY_ENABLED'),
  ranked_era_advancement_enabled: () => envOptIn('RANKED_ERA_ADVANCEMENT_ENABLED'),
  signup_nudge_enabled: () => envOptOut('SIGNUP_NUDGE_ENABLED'),
  daily_guest_play_enabled: () => envOptOut('DAILY_GUEST_PLAY_ENABLED'),
  ai_attack_grind_enabled: () => envOptOut('AI_ATTACK_GRIND_ENABLED'),
  ai_capture_odds_enabled: () => envOptOut('AI_CAPTURE_ODDS_ENABLED'),
  ai_decided_game_press_enabled: () => envOptOut('AI_DECIDED_GAME_PRESS_ENABLED'),
  attack_blitz_enabled: () => envOptOut('ATTACK_BLITZ_ENABLED'),
  // Outbound email/push — production-only unless explicitly set.
  retention_notifications_enabled: () => envOrProdOnly('RETENTION_NOTIFICATIONS_ENABLED'),
  streak_freezes_enabled: () => envOptIn('STREAK_FREEZES_ENABLED'),
  today_panel_enabled: () => envOptIn('TODAY_PANEL_ENABLED'),
  async_onboarding_enabled: () => envOptIn('ASYNC_ONBOARDING_ENABLED'),
  spectate_enabled: () => envOptIn('SPECTATE_ENABLED'),
  space_age_frontiers_enabled: () => envOptOut('SPACE_AGE_FRONTIERS_ENABLED'),
  space_age_moon_helium3_enabled: () => envOptIn('SPACE_AGE_MOON_HELIUM3_ENABLED'),
  space_age_moon_gated_tier_enabled: () => envOptIn('SPACE_AGE_MOON_GATED_TIER_ENABLED'),
  space_age_moon_hegemony_enabled: () => envOptIn('SPACE_AGE_MOON_HEGEMONY_ENABLED'),
  space_age_moon_missions_enabled: () => envOptIn('SPACE_AGE_MOON_MISSIONS_ENABLED'),
  space_age_moon_blockade_enabled: () => envOptIn('SPACE_AGE_MOON_BLOCKADE_ENABLED'),
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
/**
 * The game-settings keys the Moon Race package owns, one per shipped phase.
 * Named by their SETTINGS key rather than their flag name so the create bake can
 * spread the resolved record straight into a game's settings.
 */
export type MoonRacePhaseKey =
  | 'space_age_moon_helium3_enabled'
  | 'space_age_moon_gated_tier_enabled'
  | 'space_age_moon_hegemony_enabled'
  | 'space_age_moon_missions_enabled'
  | 'space_age_moon_blockade_enabled';

export type MoonRacePhaseFlags = Record<MoonRacePhaseKey, boolean>;

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

  /**
   * When true, registered users can access the Map Editor UI and create/publish
   * custom maps. Default ON since the publish → moderation → community loop
   * closed (migration 039 + the admin review queue) and passed the full
   * two-account lifecycle live. MAP_EDITOR_ENABLED=false or the Admin → Config
   * override is the kill switch.
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
   * When true, guest accounts may start the Daily Challenge. They play the same
   * puzzle and get the same score, but only registered players are ranked on
   * the board (`GET /daily/today` filters `is_guest`). The switch exists because
   * a guest identity is one unauthenticated POST away: if guest game creation
   * ever becomes a load or abuse problem, close the door without a deploy.
   * Default ON.
   */
  get dailyGuestPlayEnabled(): boolean {
    return overrideBool('daily_guest_play_enabled');
  },


  /**
   * When true, the AI's per-turn attack budget counts dice exchanges instead of
   * distinct edges, letting it grind one target until the target falls. Off, the
   * AI attacks each planned edge exactly once — which makes any territory
   * holding three or more units mathematically uncapturable by it. Default ON;
   * this is the kill switch if the new pressure plays badly.
   */
  get aiAttackGrindEnabled(): boolean {
    return overrideBool('ai_attack_grind_enabled');
  },

  /**
   * When true, the AI ranks attack candidates by an exact capture probability
   * (combat/combatOdds.ts) fed with the same dice modifiers the resolver will
   * apply, instead of the legacy saturating dice differential that ignored
   * garrison size and every combat bonus. Default ON; this is the kill switch
   * if the odds-aware target choice plays badly.
   */
  get aiCaptureOddsEnabled(): boolean {
    return overrideBool('ai_capture_odds_enabled');
  },

  /**
   * When true, an AI whose heuristic win probability clears the decided-game
   * threshold doubles its per-turn exchange budget and lifts its attack cap,
   * so games everyone can already call actually end. Default ON; this is the
   * kill switch if the endgame press plays badly.
   */
  get aiDecidedGamePressEnabled(): boolean {
    return overrideBool('ai_decided_game_press_enabled');
  },

  /**
   * When true, players get the "Attack until captured" button: one
   * game:attack_blitz event resolves repeated exchanges server-side (land
   * only, never breaks a truce, never in daily puzzles). Default ON; the kill
   * switch restores click-per-exchange combat.
   */
  get attackBlitzEnabled(): boolean {
    return overrideBool('attack_blitz_enabled');
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
   * only runs under era advancement). Default ON — promoted after the balance
   * harness (`scripts/simSpaceAgeBalance.ts`) showed the enlarged board plays out
   * rather than sitting decorative (avg 0.1 of the 8 frontiers still neutral at
   * end). Kill switch: `SPACE_AGE_FRONTIERS_ENABLED=false` or the
   * `space_age_frontiers_enabled` admin override. Baked into game settings
   * at create; the engine reads the setting (stays pure), so a flip never
   * re-rules a match already in progress.
   */
  get spaceAgeFrontiersEnabled(): boolean {
    return overrideBool('space_age_frontiers_enabled');
  },

  /**
   * Space Age Moon Race, Phase 1 — the lunar economy. Owned Moon tiles pay
   * Helium-3 each turn (polar basins double), and Lunar Export converts it to
   * tech points, so three Moon tiles is a real position rather than a down
   * payment on nine.
   *
   * DARK by default while the phase gate is unmeasured: promote to `envOptOut`
   * only once a `SIM_MOON_HELIUM3=1` run clears §3.8 (median first-landing turn
   * down, >=40% of games with two players on the Moon, Lunar Pioneers within
   * +/-8 of the faction mean, decisive rate not worse). Baked into game settings
   * at create; the engine reads the setting, so a flip never re-rules a match
   * already in progress. See docs/space-age-moon/README.md.
   */
  get spaceAgeMoonHelium3Enabled(): boolean {
    return overrideBool('space_age_moon_helium3_enabled');
  },

  /**
   * Space Age Moon Race, Phase 2 — the gated tier. `dyson_beam` moves behind a
   * lunar foothold plus 6 He-3, and Orbital Drop (3 units on any territory you
   * own, anywhere) becomes available to a player holding three Moon tiles.
   *
   * DARK by default. It has no effect at all unless Phase 1 is also on: the
   * powers are priced in He-3, so enabling this alone would take `dyson_beam`
   * out of the game rather than move it to the Moon (see moonPowers.ts
   * areMoonPowersEnabled). Promote to `envOptOut` only once a
   * `SIM_MOON_TIER=1` run clears §4.5 — beam and drop both used in >=60% of
   * games where someone holds three Moon tiles, the Moon holder's win share up
   * on Phase 1 but under 60% in 4-player games, and shared-Moon games not down.
   */
  get spaceAgeMoonGatedTierEnabled(): boolean {
    return overrideBool('space_age_moon_gated_tier_enabled');
  },

  /**
   * Space Age Moon Race, Phase 3 — the Lunar Hegemony. Holding all nine lunar
   * tiles at the end of your turn for seven consecutive own-turns wins the game,
   * and the clock RESETS the moment one tile leaves you. Comes with the contest
   * rule: once anybody holds lunar ground, everyone else's Moon access drops to
   * Launch Pad tech plus a Launch Pad, so contesting an occupied Moon costs far
   * less than discovering it did.
   *
   * DARK by default. Promote only once a `SIM_MOON_HEGEMONY=1` run clears §5.6
   * — hegemony fires in 10–35% of games, at least half of started clocks are
   * reset at least once, and the decisive rate does not fall.
   */
  get spaceAgeMoonHegemonyEnabled(): boolean {
    return overrideBool('space_age_moon_hegemony_enabled');
  },

  /**
   * Space Age Moon Race, Phase 5 — the lunar branch of the secret-mission deck.
   * Roughly 30% of Space Age secret missions become lunar: hold both polar
   * basins, control the whole Moon, hold three or five lunar tiles, or keep a
   * named rival off the Moon entirely while standing on it yourself.
   *
   * Independent of every other phase — it needs no Helium-3 and no victory
   * clock — but it is a no-op unless the game also allows `secret_mission`
   * victory. DARK by default; §7.4 asks only that lunar missions complete
   * within ±10 points of the existing mission mean.
   */
  get spaceAgeMoonMissionsEnabled(): boolean {
    return overrideBool('space_age_moon_missions_enabled');
  },

  /**
   * Space Age Moon Race, Phase 4 — the Orbital Blockade. Reuses the Galactic
   * lane-seal mechanic: hold either end of one of the three AUTHORED orbit
   * lanes, pay 3 He-3, and it is shut to everyone else for two rounds.
   *
   * Launch Pad lanes are deliberately unsealable (canSealLane), which is what
   * keeps the blockade from undoing Phase 3's contest rule: the anchors are the
   * convenient route and may be denied, the pad is the contest route and stays
   * open. DARK by default; §6.5 asks that seals are used in >=40% of games with
   * a running Hegemony clock AND that Hegemony completion does not rise by more
   * than 5 points — if it does, the exclusion is not doing its job.
   */
  get spaceAgeMoonBlockadeEnabled(): boolean {
    return overrideBool('space_age_moon_blockade_enabled');
  },

  /**
   * Which Moon Race phases the operator currently ships, as one record.
   *
   * The single definition of what "the Moon Race" contains: the lobby toggle
   * asks for the package, the create bake reads this to decide which parts of
   * it that turns on, and the client flag below is derived from the same record.
   * Shipping a sixth phase means adding one line here and nowhere else — three
   * hand-maintained lists is how a toggle ends up offering a phase it cannot
   * enable, or enabling one it never offered.
   */
  get moonRacePhases(): MoonRacePhaseFlags {
    return {
      space_age_moon_helium3_enabled: this.spaceAgeMoonHelium3Enabled,
      space_age_moon_gated_tier_enabled: this.spaceAgeMoonGatedTierEnabled,
      space_age_moon_hegemony_enabled: this.spaceAgeMoonHegemonyEnabled,
      space_age_moon_missions_enabled: this.spaceAgeMoonMissionsEnabled,
      space_age_moon_blockade_enabled: this.spaceAgeMoonBlockadeEnabled,
    };
  },

  /**
   * Whether the lobby has a Moon Race to offer at all — true when ANY phase is
   * enabled. Not a phase itself and deliberately not overridable: it is derived,
   * so an operator can never end up with a lobby toggle that turns nothing on,
   * or with phases live and no way for a player to decline them.
   */
  get moonRaceAvailable(): boolean {
    return Object.values(this.moonRacePhases).some(Boolean);
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
/**
 * Flags shipped to the browser. Backend-only flags stay OUT of this payload —
 * `space_age_frontiers_enabled` is baked into each game's settings at creation,
 * so the client never reads it; it was sent here and silently dropped by the
 * ClientFeatureFlags type. The Admin panel resolves flags from
 * `feature_flag_states` on GET /admin/config, not from this payload, so a flag
 * can be operator-togglable without being public.
 */
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
    daily_guest_play_enabled: featureFlags.dailyGuestPlayEnabled,
    streak_freezes_enabled: featureFlags.streakFreezesEnabled,
    today_panel_enabled: featureFlags.todayPanelEnabled,
    async_onboarding_enabled: featureFlags.asyncOnboardingEnabled,
    spectate_enabled: featureFlags.spectateEnabled,
    ranked_multi_size_enabled: featureFlags.rankedMultiSizeEnabled,
    match_alerts_enabled: featureFlags.matchAlertsEnabled,
    attack_blitz_enabled: featureFlags.attackBlitzEnabled,
    // ONE client flag for the whole Moon Race, not six. The lobby offers a
    // single toggle (§10.2) and only needs to know whether there is anything
    // behind it; which phases that toggle actually turns on is decided
    // server-side at create, where the per-phase flags live.
    space_age_moon_race_enabled: featureFlags.moonRaceAvailable,
  };
}
