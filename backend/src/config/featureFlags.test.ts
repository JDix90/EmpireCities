import { describe, it, expect, afterEach, vi } from 'vitest';
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

  it('turn_recap_panel_enabled defaults to on and the admin override is its kill switch', () => {
    expect(featureFlags.turnRecapPanelEnabled).toBe(true);
    expect(getClientFeatureFlags().turn_recap_panel_enabled).toBe(true);
    expect(getFeatureFlagStates().turn_recap_panel_enabled).toEqual({ code_default: true, overridden: false, effective: true });
    setAdminConfigCacheForTests({ feature_flags: { turn_recap_panel_enabled: false } });
    expect(featureFlags.turnRecapPanelEnabled).toBe(false);
    expect(getClientFeatureFlags().turn_recap_panel_enabled).toBe(false);
  });

  it('first_turn_coach_enabled defaults to on and is admin-overridable', () => {
    expect(featureFlags.firstTurnCoachEnabled).toBe(true);
    expect(getClientFeatureFlags().first_turn_coach_enabled).toBe(true);
    setAdminConfigCacheForTests({ feature_flags: { first_turn_coach_enabled: false } });
    expect(featureFlags.firstTurnCoachEnabled).toBe(false);
    expect(getClientFeatureFlags().first_turn_coach_enabled).toBe(false);
  });

  it('guest_personal_features_enabled defaults to off (dark-launch) and is admin-overridable', () => {
    expect(featureFlags.guestPersonalFeaturesEnabled).toBe(false);
    expect(getClientFeatureFlags().guest_personal_features_enabled).toBe(false);
    expect(getFeatureFlagStates().guest_personal_features_enabled).toEqual({ code_default: false, overridden: false, effective: false });
    setAdminConfigCacheForTests({ feature_flags: { guest_personal_features_enabled: true } });
    expect(featureFlags.guestPersonalFeaturesEnabled).toBe(true);
    expect(getClientFeatureFlags().guest_personal_features_enabled).toBe(true);
  });

  it('daily_guest_play_enabled defaults to on and is the kill switch for guest dailies', () => {
    expect(featureFlags.dailyGuestPlayEnabled).toBe(true);
    expect(getClientFeatureFlags().daily_guest_play_enabled).toBe(true);
    setAdminConfigCacheForTests({ feature_flags: { daily_guest_play_enabled: false } });
    expect(featureFlags.dailyGuestPlayEnabled).toBe(false);
    expect(getClientFeatureFlags().daily_guest_play_enabled).toBe(false);
  });

  it('map_gestures_v2_enabled defaults to on and the admin override is its kill switch', () => {
    expect(featureFlags.mapGesturesV2Enabled).toBe(true);
    expect(getClientFeatureFlags().map_gestures_v2_enabled).toBe(true);
    expect(getFeatureFlagStates().map_gestures_v2_enabled).toEqual({ code_default: true, overridden: false, effective: true });
    setAdminConfigCacheForTests({ feature_flags: { map_gestures_v2_enabled: false } });
    expect(featureFlags.mapGesturesV2Enabled).toBe(false);
    expect(getClientFeatureFlags().map_gestures_v2_enabled).toBe(false);
  });

  it('turn_clarity_enabled defaults to on and is admin-overridable', () => {
    expect(featureFlags.turnClarityEnabled).toBe(true);
    setAdminConfigCacheForTests({ feature_flags: { turn_clarity_enabled: false } });
    expect(featureFlags.turnClarityEnabled).toBe(false);
  });

  it('tutorial_card_fade_enabled defaults to on and the admin override is its kill switch', () => {
    expect(featureFlags.tutorialCardFadeEnabled).toBe(true);
    expect(getClientFeatureFlags().tutorial_card_fade_enabled).toBe(true);
    expect(getFeatureFlagStates().tutorial_card_fade_enabled).toEqual({ code_default: true, overridden: false, effective: true });
    setAdminConfigCacheForTests({ feature_flags: { tutorial_card_fade_enabled: false } });
    expect(featureFlags.tutorialCardFadeEnabled).toBe(false);
    expect(getClientFeatureFlags().tutorial_card_fade_enabled).toBe(false);
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

  it('results_footer_enabled defaults to on and the admin override is its kill switch', () => {
    expect(featureFlags.resultsFooterEnabled).toBe(true);
    expect(getClientFeatureFlags().results_footer_enabled).toBe(true);
    expect(getFeatureFlagStates().results_footer_enabled).toEqual({ code_default: true, overridden: false, effective: true });
    setAdminConfigCacheForTests({ feature_flags: { results_footer_enabled: false } });
    expect(featureFlags.resultsFooterEnabled).toBe(false);
    expect(getClientFeatureFlags().results_footer_enabled).toBe(false);
  });

  it('save_account_copy_enabled defaults to off (dark-launch) and is admin-overridable', () => {
    expect(featureFlags.saveAccountCopyEnabled).toBe(false);
    expect(getClientFeatureFlags().save_account_copy_enabled).toBe(false);
    expect(getFeatureFlagStates().save_account_copy_enabled).toEqual({ code_default: false, overridden: false, effective: false });
    setAdminConfigCacheForTests({ feature_flags: { save_account_copy_enabled: true } });
    expect(featureFlags.saveAccountCopyEnabled).toBe(true);
    expect(getClientFeatureFlags().save_account_copy_enabled).toBe(true);
  });

  it('guest_prompt_v2_enabled defaults to on and the admin override is its kill switch', () => {
    expect(featureFlags.guestPromptV2Enabled).toBe(true);
    expect(getClientFeatureFlags().guest_prompt_v2_enabled).toBe(true);
    expect(getFeatureFlagStates().guest_prompt_v2_enabled).toEqual({ code_default: true, overridden: false, effective: true });
    setAdminConfigCacheForTests({ feature_flags: { guest_prompt_v2_enabled: false } });
    expect(featureFlags.guestPromptV2Enabled).toBe(false);
    expect(getClientFeatureFlags().guest_prompt_v2_enabled).toBe(false);
  });

  it('email_account_save_enabled defaults to off (dark-launch) and is admin-overridable', () => {
    expect(featureFlags.emailAccountSaveEnabled).toBe(false);
    expect(getClientFeatureFlags().email_account_save_enabled).toBe(false);
    expect(getFeatureFlagStates().email_account_save_enabled).toEqual({ code_default: false, overridden: false, effective: false });
    setAdminConfigCacheForTests({ feature_flags: { email_account_save_enabled: true } });
    expect(featureFlags.emailAccountSaveEnabled).toBe(true);
    expect(getClientFeatureFlags().email_account_save_enabled).toBe(true);
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

  it('the bot flags default on, and each is switched off by its env value or an admin override', () => {
    const botFlags = [
      ['ai_odds_press_enabled', 'AI_ODDS_PRESS_ENABLED'],
      ['ai_planned_reinforcements_enabled', 'AI_PLANNED_REINFORCEMENTS_ENABLED'],
      ['ai_ending_play_enabled', 'AI_ENDING_PLAY_ENABLED'],
      ['ai_resignation_enabled', 'AI_RESIGNATION_ENABLED'],
      ['ai_intents_enabled', 'AI_INTENTS_ENABLED'],
      ['ai_personalities_enabled', 'AI_PERSONALITIES_ENABLED'],
      ['surrender_offers_enabled', 'SURRENDER_OFFERS_ENABLED'],
    ] as const;
    try {
      for (const [key, env] of botFlags) {
        expect({ key, state: getFeatureFlagStates()[key] })
          .toEqual({ key, state: { code_default: true, overridden: false, effective: true } });
        vi.stubEnv(env, 'false');
        expect({ key, codeDefault: getFeatureFlagCodeDefault(key) }).toEqual({ key, codeDefault: false });
        vi.unstubAllEnvs();
        setAdminConfigCacheForTests({ feature_flags: { [key]: false } });
        expect({ key, effective: getFeatureFlagStates()[key]!.effective }).toEqual({ key, effective: false });
        resetAdminConfigCacheForTests();
      }
    } finally {
      vi.unstubAllEnvs();
    }
    expect(featureFlags.aiOddsPressEnabled && featureFlags.aiPlannedReinforcementsEnabled
      && featureFlags.aiEndingPlayEnabled && featureFlags.aiResignationEnabled && featureFlags.aiIntentsEnabled
      && featureFlags.aiPersonalitiesEnabled && featureFlags.surrenderOffersEnabled).toBe(true);
  });

  it('ai_defense_enabled defaults to off (dark launch) and is admin-overridable', () => {
    expect(featureFlags.aiDefenseEnabled).toBe(false);
    expect(getFeatureFlagStates().ai_defense_enabled).toEqual({ code_default: false, overridden: false, effective: false });
    setAdminConfigCacheForTests({ feature_flags: { ai_defense_enabled: true } });
    expect(featureFlags.aiDefenseEnabled).toBe(true);
  });

  it('galaxy_world_buildings_enabled defaults to off (dark launch) and is admin-overridable', () => {
    expect(featureFlags.galaxyWorldBuildingsEnabled).toBe(false);
    expect(getFeatureFlagStates().galaxy_world_buildings_enabled).toEqual({ code_default: false, overridden: false, effective: false });
    setAdminConfigCacheForTests({ feature_flags: { galaxy_world_buildings_enabled: true } });
    expect(featureFlags.galaxyWorldBuildingsEnabled).toBe(true);
  });

  it('session_30d_enabled defaults to off (dark launch) and is admin-overridable', () => {
    expect(featureFlags.session30dEnabled).toBe(false);
    expect(getFeatureFlagStates().session_30d_enabled).toEqual({ code_default: false, overridden: false, effective: false });
    setAdminConfigCacheForTests({ feature_flags: { session_30d_enabled: true } });
    expect(featureFlags.session30dEnabled).toBe(true);
  });

  it('friendly_guest_names_enabled defaults to on and the admin override is its kill switch', () => {
    expect(featureFlags.friendlyGuestNamesEnabled).toBe(true);
    expect(getFeatureFlagStates().friendly_guest_names_enabled).toEqual({ code_default: true, overridden: false, effective: true });
    setAdminConfigCacheForTests({ feature_flags: { friendly_guest_names_enabled: false } });
    expect(featureFlags.friendlyGuestNamesEnabled).toBe(false);
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

  it('touch_targets_enabled defaults to on and the admin override is its kill switch', () => {
    expect(featureFlags.touchTargetsEnabled).toBe(true);
    expect(getClientFeatureFlags().touch_targets_enabled).toBe(true);
    expect(getFeatureFlagStates().touch_targets_enabled).toEqual({ code_default: true, overridden: false, effective: true });
    setAdminConfigCacheForTests({ feature_flags: { touch_targets_enabled: false } });
    expect(featureFlags.touchTargetsEnabled).toBe(false);
    expect(getClientFeatureFlags().touch_targets_enabled).toBe(false);
  });

  it('localization_enabled defaults to off (dark-launch) and is admin-overridable', () => {
    expect(featureFlags.localizationEnabled).toBe(false);
    expect(getClientFeatureFlags().localization_enabled).toBe(false);
    expect(getFeatureFlagStates().localization_enabled).toEqual({ code_default: false, overridden: false, effective: false });
    setAdminConfigCacheForTests({ feature_flags: { localization_enabled: true } });
    expect(featureFlags.localizationEnabled).toBe(true);
    expect(getClientFeatureFlags().localization_enabled).toBe(true);
  });

  it('first_turn_clock_wait_enabled defaults to on and the admin override is its kill switch', () => {
    expect(featureFlags.firstTurnClockWaitEnabled).toBe(true);
    expect(getClientFeatureFlags().first_turn_clock_wait_enabled).toBe(true);
    expect(getFeatureFlagStates().first_turn_clock_wait_enabled).toEqual({ code_default: true, overridden: false, effective: true });
    setAdminConfigCacheForTests({ feature_flags: { first_turn_clock_wait_enabled: false } });
    expect(featureFlags.firstTurnClockWaitEnabled).toBe(false);
    expect(getClientFeatureFlags().first_turn_clock_wait_enabled).toBe(false);
  });

  it('daily_puzzle_v2_enabled defaults to off (dark-launch) and is admin-overridable', () => {
    expect(featureFlags.dailyPuzzleV2Enabled).toBe(false);
    expect(getClientFeatureFlags().daily_puzzle_v2_enabled).toBe(false);
    expect(getFeatureFlagStates().daily_puzzle_v2_enabled).toEqual({ code_default: false, overridden: false, effective: false });
    setAdminConfigCacheForTests({ feature_flags: { daily_puzzle_v2_enabled: true } });
    expect(featureFlags.dailyPuzzleV2Enabled).toBe(true);
    expect(getClientFeatureFlags().daily_puzzle_v2_enabled).toBe(true);
  });

  it('in_game_mute_enabled defaults to on and the admin override is its kill switch', () => {
    expect(featureFlags.inGameMuteEnabled).toBe(true);
    expect(getClientFeatureFlags().in_game_mute_enabled).toBe(true);
    expect(getFeatureFlagStates().in_game_mute_enabled).toEqual({ code_default: true, overridden: false, effective: true });
    setAdminConfigCacheForTests({ feature_flags: { in_game_mute_enabled: false } });
    expect(featureFlags.inGameMuteEnabled).toBe(false);
    expect(getClientFeatureFlags().in_game_mute_enabled).toBe(false);
  });

  it('phone_fortify_fit_enabled defaults to on and the admin override is its kill switch', () => {
    expect(featureFlags.phoneFortifyFitEnabled).toBe(true);
    expect(getClientFeatureFlags().phone_fortify_fit_enabled).toBe(true);
    expect(getFeatureFlagStates().phone_fortify_fit_enabled).toEqual({ code_default: true, overridden: false, effective: true });
    setAdminConfigCacheForTests({ feature_flags: { phone_fortify_fit_enabled: false } });
    expect(featureFlags.phoneFortifyFitEnabled).toBe(false);
    expect(getClientFeatureFlags().phone_fortify_fit_enabled).toBe(false);
  });

  it('first_match_primary_cta_enabled defaults to on and the admin override is its kill switch', () => {
    expect(featureFlags.firstMatchPrimaryCtaEnabled).toBe(true);
    expect(getClientFeatureFlags().first_match_primary_cta_enabled).toBe(true);
    expect(getFeatureFlagStates().first_match_primary_cta_enabled).toEqual({ code_default: true, overridden: false, effective: true });
    setAdminConfigCacheForTests({ feature_flags: { first_match_primary_cta_enabled: false } });
    expect(featureFlags.firstMatchPrimaryCtaEnabled).toBe(false);
    expect(getClientFeatureFlags().first_match_primary_cta_enabled).toBe(false);
  });

  it('tutorial_wrapup_to_match_enabled defaults to on and the admin override is its kill switch', () => {
    expect(featureFlags.tutorialWrapupToMatchEnabled).toBe(true);
    expect(getClientFeatureFlags().tutorial_wrapup_to_match_enabled).toBe(true);
    expect(getFeatureFlagStates().tutorial_wrapup_to_match_enabled).toEqual({ code_default: true, overridden: false, effective: true });
    setAdminConfigCacheForTests({ feature_flags: { tutorial_wrapup_to_match_enabled: false } });
    expect(featureFlags.tutorialWrapupToMatchEnabled).toBe(false);
    expect(getClientFeatureFlags().tutorial_wrapup_to_match_enabled).toBe(false);
  });

  it('battle_player_colors_enabled defaults to on and the admin override is its kill switch', () => {
    expect(featureFlags.battlePlayerColorsEnabled).toBe(true);
    expect(getClientFeatureFlags().battle_player_colors_enabled).toBe(true);
    expect(getFeatureFlagStates().battle_player_colors_enabled).toEqual({ code_default: true, overridden: false, effective: true });
    setAdminConfigCacheForTests({ feature_flags: { battle_player_colors_enabled: false } });
    expect(featureFlags.battlePlayerColorsEnabled).toBe(false);
    expect(getClientFeatureFlags().battle_player_colors_enabled).toBe(false);
  });

  it('battle_armies_enabled defaults to on and the admin override is its kill switch', () => {
    expect(featureFlags.battleArmiesEnabled).toBe(true);
    expect(getClientFeatureFlags().battle_armies_enabled).toBe(true);
    expect(getFeatureFlagStates().battle_armies_enabled).toEqual({ code_default: true, overridden: false, effective: true });
    setAdminConfigCacheForTests({ feature_flags: { battle_armies_enabled: false } });
    expect(featureFlags.battleArmiesEnabled).toBe(false);
    expect(getClientFeatureFlags().battle_armies_enabled).toBe(false);
  });

  it('desktop_card_cue_enabled defaults to on and the admin override is its kill switch', () => {
    expect(featureFlags.desktopCardCueEnabled).toBe(true);
    expect(getClientFeatureFlags().desktop_card_cue_enabled).toBe(true);
    expect(getFeatureFlagStates().desktop_card_cue_enabled).toEqual({ code_default: true, overridden: false, effective: true });
    setAdminConfigCacheForTests({ feature_flags: { desktop_card_cue_enabled: false } });
    expect(featureFlags.desktopCardCueEnabled).toBe(false);
    expect(getClientFeatureFlags().desktop_card_cue_enabled).toBe(false);
  });

  it('tutorial_phone_gate_visible_enabled defaults to on and the admin override is its kill switch', () => {
    expect(featureFlags.tutorialPhoneGateVisibleEnabled).toBe(true);
    expect(getClientFeatureFlags().tutorial_phone_gate_visible_enabled).toBe(true);
    expect(getFeatureFlagStates().tutorial_phone_gate_visible_enabled).toEqual({ code_default: true, overridden: false, effective: true });
    setAdminConfigCacheForTests({ feature_flags: { tutorial_phone_gate_visible_enabled: false } });
    expect(featureFlags.tutorialPhoneGateVisibleEnabled).toBe(false);
    expect(getClientFeatureFlags().tutorial_phone_gate_visible_enabled).toBe(false);
  });

  it('game_loading_label_enabled defaults to on and the admin override is its kill switch', () => {
    expect(featureFlags.gameLoadingLabelEnabled).toBe(true);
    expect(getClientFeatureFlags().game_loading_label_enabled).toBe(true);
    expect(getFeatureFlagStates().game_loading_label_enabled).toEqual({ code_default: true, overridden: false, effective: true });
    setAdminConfigCacheForTests({ feature_flags: { game_loading_label_enabled: false } });
    expect(featureFlags.gameLoadingLabelEnabled).toBe(false);
    expect(getClientFeatureFlags().game_loading_label_enabled).toBe(false);
  });

  it('first_match_easy_enabled defaults to on and the admin override is its kill switch', () => {
    expect(featureFlags.firstMatchEasyEnabled).toBe(true);
    expect(getClientFeatureFlags().first_match_easy_enabled).toBe(true);
    expect(getFeatureFlagStates().first_match_easy_enabled).toEqual({ code_default: true, overridden: false, effective: true });
    setAdminConfigCacheForTests({ feature_flags: { first_match_easy_enabled: false } });
    expect(featureFlags.firstMatchEasyEnabled).toBe(false);
    expect(getClientFeatureFlags().first_match_easy_enabled).toBe(false);
  });

  it('loss_reason_enabled defaults to on and the admin override is its kill switch', () => {
    expect(featureFlags.lossReasonEnabled).toBe(true);
    expect(getClientFeatureFlags().loss_reason_enabled).toBe(true);
    expect(getFeatureFlagStates().loss_reason_enabled).toEqual({ code_default: true, overridden: false, effective: true });
    setAdminConfigCacheForTests({ feature_flags: { loss_reason_enabled: false } });
    expect(featureFlags.lossReasonEnabled).toBe(false);
    expect(getClientFeatureFlags().loss_reason_enabled).toBe(false);
  });

  it('custom_round_cap_enabled defaults to off (dark-launch) and is admin-overridable', () => {
    expect(featureFlags.customRoundCapEnabled).toBe(false);
    expect(getClientFeatureFlags().custom_round_cap_enabled).toBe(false);
    expect(getFeatureFlagStates().custom_round_cap_enabled).toEqual({ code_default: false, overridden: false, effective: false });
    setAdminConfigCacheForTests({ feature_flags: { custom_round_cap_enabled: true } });
    expect(featureFlags.customRoundCapEnabled).toBe(true);
    expect(getClientFeatureFlags().custom_round_cap_enabled).toBe(true);
  });

  it('custom_lobby_fold_enabled defaults to off (dark-launch) and is admin-overridable', () => {
    expect(featureFlags.customLobbyFoldEnabled).toBe(false);
    expect(getClientFeatureFlags().custom_lobby_fold_enabled).toBe(false);
    expect(getFeatureFlagStates().custom_lobby_fold_enabled).toEqual({ code_default: false, overridden: false, effective: false });
    setAdminConfigCacheForTests({ feature_flags: { custom_lobby_fold_enabled: true } });
    expect(featureFlags.customLobbyFoldEnabled).toBe(true);
    expect(getClientFeatureFlags().custom_lobby_fold_enabled).toBe(true);
  });

  it('placement_cap_note_enabled defaults to on and the admin override is its kill switch', () => {
    expect(featureFlags.placementCapNoteEnabled).toBe(true);
    expect(getClientFeatureFlags().placement_cap_note_enabled).toBe(true);
    expect(getFeatureFlagStates().placement_cap_note_enabled).toEqual({ code_default: true, overridden: false, effective: true });
    setAdminConfigCacheForTests({ feature_flags: { placement_cap_note_enabled: false } });
    expect(featureFlags.placementCapNoteEnabled).toBe(false);
    expect(getClientFeatureFlags().placement_cap_note_enabled).toBe(false);
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
