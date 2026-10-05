import { describe, it, expect, afterEach } from 'vitest';
import {
  featureFlags,
  getClientFeatureFlags,
  getFeatureFlagCodeDefault,
  getFeatureFlagStates,
  FLAG_CODE_DEFAULTS,
} from './featureFlags';
import {
  DEFAULTS,
  resetAdminConfigCacheForTests,
  setAdminConfigCacheForTests,
} from '../services/adminConfig';

describe('featureFlags', () => {
  afterEach(() => {
    resetAdminConfigCacheForTests();
  });

  // The precedence contract: admin_config.feature_flags is an explicit operator
  // override; with no override present a flag runs on FLAG_CODE_DEFAULTS. A key
  // seeded into DEFAULTS.feature_flags would sit in the merged cache forever and
  // silently shadow the code default, which is why that block must stay empty.
  it('seeds no flag defaults into admin config (they would shadow code defaults)', () => {
    expect(DEFAULTS.feature_flags).toEqual({});
  });

  it('every flag getter resolves through the FLAG_CODE_DEFAULTS registry', () => {
    const states = getFeatureFlagStates();
    for (const key of Object.keys(FLAG_CODE_DEFAULTS)) {
      expect(states[key].overridden).toBe(false);
      expect(states[key].effective).toBe(getFeatureFlagCodeDefault(key));
    }
  });

  it('every Galactic Age world rule is on by default and can be switched off on its own', () => {
    expect(featureFlags.galaxyDisabledWorldRules).toEqual([]);
    setAdminConfigCacheForTests({ feature_flags: { galaxy_rule_storms_enabled: false, galaxy_rule_vault_enabled: false } });
    expect(featureFlags.galaxyDisabledWorldRules).toEqual(['storms', 'vault']);
    // The master switch is separate and untouched.
    expect(featureFlags.galaxyWorldRulesEnabled).toBe(true);
  });

  it('map_editor_enabled defaults to on', () => {
    expect(featureFlags.mapEditorEnabled).toBe(true);
    expect(getClientFeatureFlags().map_editor_enabled).toBe(true);
  });

  it('admin override can force the map editor off (the kill switch)', () => {
    setAdminConfigCacheForTests({ feature_flags: { map_editor_enabled: false } });
    expect(featureFlags.mapEditorEnabled).toBe(false);
    expect(getClientFeatureFlags().map_editor_enabled).toBe(false);
    expect(getFeatureFlagStates().map_editor_enabled).toEqual({
      code_default: true,
      overridden: true,
      effective: false,
    });
  });

  it('era_advancement_lobby_enabled defaults to on (the flagship mode is surfaced)', () => {
    expect(featureFlags.eraAdvancementLobbyEnabled).toBe(true);
    expect(getClientFeatureFlags().era_advancement_lobby_enabled).toBe(true);
  });

  it('admin override can disable the era advancement lobby toggle', () => {
    setAdminConfigCacheForTests({ feature_flags: { era_advancement_lobby_enabled: false } });
    expect(featureFlags.eraAdvancementLobbyEnabled).toBe(false);
    expect(getClientFeatureFlags().era_advancement_lobby_enabled).toBe(false);
  });

  it('ranked_era_advancement_enabled defaults to off and is admin-overridable', () => {
    expect(featureFlags.rankedEraAdvancementEnabled).toBe(false);
    setAdminConfigCacheForTests({ feature_flags: { ranked_era_advancement_enabled: true } });
    expect(featureFlags.rankedEraAdvancementEnabled).toBe(true);
  });

  it('first_turn_coach_enabled defaults to on and is admin-overridable', () => {
    expect(featureFlags.firstTurnCoachEnabled).toBe(true);
    expect(getClientFeatureFlags().first_turn_coach_enabled).toBe(true);
    setAdminConfigCacheForTests({ feature_flags: { first_turn_coach_enabled: false } });
    expect(featureFlags.firstTurnCoachEnabled).toBe(false);
    expect(getClientFeatureFlags().first_turn_coach_enabled).toBe(false);
  });

  it('daily_guest_play_enabled defaults to on and is the kill switch for guest dailies', () => {
    expect(featureFlags.dailyGuestPlayEnabled).toBe(true);
    expect(getClientFeatureFlags().daily_guest_play_enabled).toBe(true);
    setAdminConfigCacheForTests({ feature_flags: { daily_guest_play_enabled: false } });
    expect(featureFlags.dailyGuestPlayEnabled).toBe(false);
    expect(getClientFeatureFlags().daily_guest_play_enabled).toBe(false);
  });

  it('turn_clarity_enabled defaults to on and is admin-overridable', () => {
    expect(featureFlags.turnClarityEnabled).toBe(true);
    setAdminConfigCacheForTests({ feature_flags: { turn_clarity_enabled: false } });
    expect(featureFlags.turnClarityEnabled).toBe(false);
  });

  it('onboarding_tutorial_first_enabled and hero_single_cta_enabled default to on', () => {
    expect(featureFlags.onboardingTutorialFirstEnabled).toBe(true);
    expect(featureFlags.heroSingleCtaEnabled).toBe(true);
    expect(featureFlags.eraAdvancePayoffEnabled).toBe(true);
  });

  it('analytics_events_enabled is off under test so runs stay quiet, on by default elsewhere', () => {
    // config.nodeEnv is 'test' here; the ANALYTICS_EVENTS_ENABLED env default is on.
    expect(featureFlags.analyticsEventsEnabled).toBe(false);
    setAdminConfigCacheForTests({ feature_flags: { analytics_events_enabled: true } });
    expect(featureFlags.analyticsEventsEnabled).toBe(true);
  });

  it('retention_notifications_enabled stays off outside production (no mail from dev/test)', () => {
    expect(featureFlags.retentionNotificationsEnabled).toBe(false);
    setAdminConfigCacheForTests({ feature_flags: { retention_notifications_enabled: true } });
    expect(featureFlags.retentionNotificationsEnabled).toBe(true);
  });

  it('signup_nudge_enabled defaults to on and is admin-overridable', () => {
    expect(featureFlags.signupNudgeEnabled).toBe(true);
    expect(getClientFeatureFlags().signup_nudge_enabled).toBe(true);
    setAdminConfigCacheForTests({ feature_flags: { signup_nudge_enabled: false } });
    expect(featureFlags.signupNudgeEnabled).toBe(false);
    expect(getClientFeatureFlags().signup_nudge_enabled).toBe(false);
  });

  it('streak_freezes_enabled defaults to off (dark-launch) and is admin-overridable', () => {
    expect(featureFlags.streakFreezesEnabled).toBe(false);
    expect(getClientFeatureFlags().streak_freezes_enabled).toBe(false);
    setAdminConfigCacheForTests({ feature_flags: { streak_freezes_enabled: true } });
    expect(featureFlags.streakFreezesEnabled).toBe(true);
    expect(getClientFeatureFlags().streak_freezes_enabled).toBe(true);
  });

  it('today_panel_enabled defaults to off (dark-launch) and is admin-overridable', () => {
    expect(featureFlags.todayPanelEnabled).toBe(false);
    expect(getClientFeatureFlags().today_panel_enabled).toBe(false);
    setAdminConfigCacheForTests({ feature_flags: { today_panel_enabled: true } });
    expect(featureFlags.todayPanelEnabled).toBe(true);
    expect(getClientFeatureFlags().today_panel_enabled).toBe(true);
  });

  it('async_onboarding_enabled defaults to off (dark-launch) and is admin-overridable', () => {
    expect(featureFlags.asyncOnboardingEnabled).toBe(false);
    expect(getClientFeatureFlags().async_onboarding_enabled).toBe(false);
    setAdminConfigCacheForTests({ feature_flags: { async_onboarding_enabled: true } });
    expect(featureFlags.asyncOnboardingEnabled).toBe(true);
    expect(getClientFeatureFlags().async_onboarding_enabled).toBe(true);
  });

  it('spectate_enabled defaults to off and is admin-overridable', () => {
    expect(featureFlags.spectateEnabled).toBe(false);
    expect(getClientFeatureFlags().spectate_enabled).toBe(false);
    setAdminConfigCacheForTests({ feature_flags: { spectate_enabled: true } });
    expect(featureFlags.spectateEnabled).toBe(true);
    expect(getClientFeatureFlags().spectate_enabled).toBe(true);
  });

  it('space_age_frontiers_enabled defaults to on (the 8 authored frontiers are seeded)', () => {
    expect(featureFlags.spaceAgeFrontiersEnabled).toBe(true);
    expect(getFeatureFlagStates().space_age_frontiers_enabled.code_default).toBe(true);
  });

  it('admin override can force the Space Age frontiers off (the kill switch)', () => {
    setAdminConfigCacheForTests({ feature_flags: { space_age_frontiers_enabled: false } });
    expect(featureFlags.spaceAgeFrontiersEnabled).toBe(false);
    expect(getFeatureFlagStates().space_age_frontiers_enabled).toEqual({
      code_default: true,
      overridden: true,
      effective: false,
    });
  });

  // Backend-only: baked into each game's settings at create, never shipped to
  // the browser, so promoting it to ON must not leak it into the public payload.
  it('space_age_frontiers_enabled stays out of the client payload', () => {
    expect('space_age_frontiers_enabled' in getClientFeatureFlags()).toBe(false);
  });

  it('ranked_multi_size_enabled defaults to off (dark-launch) and is admin-overridable', () => {
    expect(featureFlags.rankedMultiSizeEnabled).toBe(false);
    expect(getClientFeatureFlags().ranked_multi_size_enabled).toBe(false);
    setAdminConfigCacheForTests({ feature_flags: { ranked_multi_size_enabled: true } });
    expect(featureFlags.rankedMultiSizeEnabled).toBe(true);
    expect(getClientFeatureFlags().ranked_multi_size_enabled).toBe(true);
  });

  it('match_alerts_enabled defaults to off (dark-launch) and is admin-overridable', () => {
    expect(featureFlags.matchAlertsEnabled).toBe(false);
    expect(getClientFeatureFlags().match_alerts_enabled).toBe(false);
    setAdminConfigCacheForTests({ feature_flags: { match_alerts_enabled: true } });
    expect(featureFlags.matchAlertsEnabled).toBe(true);
    expect(getClientFeatureFlags().match_alerts_enabled).toBe(true);
  });

  it('galaxy_tutorial_enabled defaults to on (the track has shipped) with an admin kill switch', () => {
    expect(featureFlags.galaxyTutorialEnabled).toBe(true);
    expect(getClientFeatureFlags().galaxy_tutorial_enabled).toBe(true);
    expect(getFeatureFlagStates().galaxy_tutorial_enabled).toEqual({ code_default: true, overridden: false, effective: true });
    setAdminConfigCacheForTests({ feature_flags: { galaxy_tutorial_enabled: false } });
    expect(featureFlags.galaxyTutorialEnabled).toBe(false);
    expect(getClientFeatureFlags().galaxy_tutorial_enabled).toBe(false);
  });

  it('galaxy_buildings_v2_enabled defaults to off (dark launch) and is admin-overridable', () => {
    expect(featureFlags.galaxyBuildingsV2Enabled).toBe(false);
    expect(getFeatureFlagStates().galaxy_buildings_v2_enabled).toEqual({ code_default: false, overridden: false, effective: false });
    setAdminConfigCacheForTests({ feature_flags: { galaxy_buildings_v2_enabled: true } });
    expect(featureFlags.galaxyBuildingsV2Enabled).toBe(true);
  });

  it('galaxy_orbital_buildings_enabled defaults to off (dark launch) and is admin-overridable', () => {
    expect(featureFlags.galaxyOrbitalBuildingsEnabled).toBe(false);
    expect(getFeatureFlagStates().galaxy_orbital_buildings_enabled).toEqual({ code_default: false, overridden: false, effective: false });
    setAdminConfigCacheForTests({ feature_flags: { galaxy_orbital_buildings_enabled: true } });
    expect(featureFlags.galaxyOrbitalBuildingsEnabled).toBe(true);
  });

  it('galaxy_garrisons_enabled defaults to off (dark launch) and is admin-overridable', () => {
    expect(featureFlags.galaxyGarrisonsEnabled).toBe(false);
    expect(getFeatureFlagStates().galaxy_garrisons_enabled).toEqual({ code_default: false, overridden: false, effective: false });
    setAdminConfigCacheForTests({ feature_flags: { galaxy_garrisons_enabled: true } });
    expect(featureFlags.galaxyGarrisonsEnabled).toBe(true);
  });

  it('galaxy_powers_enabled defaults to off (dark launch) and is admin-overridable', () => {
    expect(featureFlags.galaxyPowersEnabled).toBe(false);
    expect(getFeatureFlagStates().galaxy_powers_enabled).toEqual({ code_default: false, overridden: false, effective: false });
    setAdminConfigCacheForTests({ feature_flags: { galaxy_powers_enabled: true } });
    expect(featureFlags.galaxyPowersEnabled).toBe(true);
  });

  it('galaxy_world_buildings_enabled defaults to off (dark launch) and is admin-overridable', () => {
    expect(featureFlags.galaxyWorldBuildingsEnabled).toBe(false);
    expect(getFeatureFlagStates().galaxy_world_buildings_enabled).toEqual({ code_default: false, overridden: false, effective: false });
    setAdminConfigCacheForTests({ feature_flags: { galaxy_world_buildings_enabled: true } });
    expect(featureFlags.galaxyWorldBuildingsEnabled).toBe(true);
  });

  it('ww2_bomb_ai_enabled defaults to off (dark launch) and is admin-overridable', () => {
    expect(featureFlags.ww2BombAiEnabled).toBe(false);
    expect(getFeatureFlagStates().ww2_bomb_ai_enabled).toEqual({ code_default: false, overridden: false, effective: false });
    setAdminConfigCacheForTests({ feature_flags: { ww2_bomb_ai_enabled: true } });
    expect(featureFlags.ww2BombAiEnabled).toBe(true);
  });

  it('ww2_manhattan_science_enabled defaults to off (dark launch) and is admin-overridable', () => {
    expect(featureFlags.ww2ManhattanScienceEnabled).toBe(false);
    expect(getFeatureFlagStates().ww2_manhattan_science_enabled).toEqual({ code_default: false, overridden: false, effective: false });
    setAdminConfigCacheForTests({ feature_flags: { ww2_manhattan_science_enabled: true } });
    expect(featureFlags.ww2ManhattanScienceEnabled).toBe(true);
  });

  it('ww2_atomic_arsenal_enabled defaults to off (dark launch) and is admin-overridable', () => {
    expect(featureFlags.ww2AtomicArsenalEnabled).toBe(false);
    expect(getFeatureFlagStates().ww2_atomic_arsenal_enabled).toEqual({ code_default: false, overridden: false, effective: false });
    setAdminConfigCacheForTests({ feature_flags: { ww2_atomic_arsenal_enabled: true } });
    expect(featureFlags.ww2AtomicArsenalEnabled).toBe(true);
  });

  it('warfront_enabled defaults to off (experimental, admin-only) and is admin-overridable', () => {
    expect(featureFlags.warfrontEnabled).toBe(false);
    expect(getClientFeatureFlags().warfront_enabled).toBe(false);
    expect(getFeatureFlagStates().warfront_enabled).toEqual({ code_default: false, overridden: false, effective: false });
    setAdminConfigCacheForTests({ feature_flags: { warfront_enabled: true } });
    expect(featureFlags.warfrontEnabled).toBe(true);
    expect(getClientFeatureFlags().warfront_enabled).toBe(true);
  });

  it('localization_enabled defaults to off (dark-launch) and is admin-overridable', () => {
    expect(featureFlags.localizationEnabled).toBe(false);
    expect(getClientFeatureFlags().localization_enabled).toBe(false);
    expect(getFeatureFlagStates().localization_enabled).toEqual({ code_default: false, overridden: false, effective: false });
    setAdminConfigCacheForTests({ feature_flags: { localization_enabled: true } });
    expect(featureFlags.localizationEnabled).toBe(true);
    expect(getClientFeatureFlags().localization_enabled).toBe(true);
  });

  it('daily_puzzle_v2_enabled defaults to off (dark-launch) and is admin-overridable', () => {
    expect(featureFlags.dailyPuzzleV2Enabled).toBe(false);
    expect(getClientFeatureFlags().daily_puzzle_v2_enabled).toBe(false);
    expect(getFeatureFlagStates().daily_puzzle_v2_enabled).toEqual({ code_default: false, overridden: false, effective: false });
    setAdminConfigCacheForTests({ feature_flags: { daily_puzzle_v2_enabled: true } });
    expect(featureFlags.dailyPuzzleV2Enabled).toBe(true);
    expect(getClientFeatureFlags().daily_puzzle_v2_enabled).toBe(true);
  });

  it('first_match_easy_enabled defaults to off (dark-launch) and is admin-overridable', () => {
    expect(featureFlags.firstMatchEasyEnabled).toBe(false);
    expect(getClientFeatureFlags().first_match_easy_enabled).toBe(false);
    expect(getFeatureFlagStates().first_match_easy_enabled).toEqual({ code_default: false, overridden: false, effective: false });
    setAdminConfigCacheForTests({ feature_flags: { first_match_easy_enabled: true } });
    expect(featureFlags.firstMatchEasyEnabled).toBe(true);
    expect(getClientFeatureFlags().first_match_easy_enabled).toBe(true);
  });

  it('full_game_evening_enabled defaults to off (dark-launch) and is admin-overridable', () => {
    expect(featureFlags.fullGameEveningEnabled).toBe(false);
    expect(getClientFeatureFlags().full_game_evening_enabled).toBe(false);
    expect(getFeatureFlagStates().full_game_evening_enabled).toEqual({ code_default: false, overridden: false, effective: false });
    setAdminConfigCacheForTests({ feature_flags: { full_game_evening_enabled: true } });
    expect(featureFlags.fullGameEveningEnabled).toBe(true);
    expect(getClientFeatureFlags().full_game_evening_enabled).toBe(true);
  });

  it('store_v2_enabled defaults to on, and the admin override is its kill switch', () => {
    expect(featureFlags.storeV2Enabled).toBe(true);
    expect(getClientFeatureFlags().store_v2_enabled).toBe(true);
    expect(getFeatureFlagStates().store_v2_enabled).toEqual({ code_default: true, overridden: false, effective: true });
    setAdminConfigCacheForTests({ feature_flags: { store_v2_enabled: false } });
    expect(featureFlags.storeV2Enabled).toBe(false);
    expect(getClientFeatureFlags().store_v2_enabled).toBe(false);
  });
});
