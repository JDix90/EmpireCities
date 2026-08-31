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
});
