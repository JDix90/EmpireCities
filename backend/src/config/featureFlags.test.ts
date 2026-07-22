import { describe, it, expect, afterEach } from 'vitest';
import { featureFlags, getClientFeatureFlags } from './featureFlags';
import { resetAdminConfigCacheForTests, setAdminConfigCacheForTests } from '../services/adminConfig';

describe('featureFlags', () => {
  afterEach(() => {
    resetAdminConfigCacheForTests();
  });

  it('map_editor_enabled defaults to off', () => {
    expect(featureFlags.mapEditorEnabled).toBe(false);
    expect(getClientFeatureFlags().map_editor_enabled).toBe(false);
  });

  it('admin override can enable map editor', () => {
    setAdminConfigCacheForTests({ feature_flags: { map_editor_enabled: true } });
    expect(featureFlags.mapEditorEnabled).toBe(true);
    expect(getClientFeatureFlags().map_editor_enabled).toBe(true);
  });

  it('era_advancement_lobby_enabled defaults to off', () => {
    expect(featureFlags.eraAdvancementLobbyEnabled).toBe(false);
    expect(getClientFeatureFlags().era_advancement_lobby_enabled).toBe(false);
  });

  it('admin override can enable era advancement lobby toggle', () => {
    setAdminConfigCacheForTests({ feature_flags: { era_advancement_lobby_enabled: true } });
    expect(featureFlags.eraAdvancementLobbyEnabled).toBe(true);
    expect(getClientFeatureFlags().era_advancement_lobby_enabled).toBe(true);
  });

  it('ranked_era_advancement_enabled defaults to off and is admin-overridable', () => {
    expect(featureFlags.rankedEraAdvancementEnabled).toBe(false);
    setAdminConfigCacheForTests({ feature_flags: { ranked_era_advancement_enabled: true } });
    expect(featureFlags.rankedEraAdvancementEnabled).toBe(true);
  });

  it('first_turn_coach_enabled defaults to off and is admin-overridable', () => {
    expect(featureFlags.firstTurnCoachEnabled).toBe(false);
    expect(getClientFeatureFlags().first_turn_coach_enabled).toBe(false);
    setAdminConfigCacheForTests({ feature_flags: { first_turn_coach_enabled: true } });
    expect(featureFlags.firstTurnCoachEnabled).toBe(true);
    expect(getClientFeatureFlags().first_turn_coach_enabled).toBe(true);
  });

  it('signup_nudge_enabled defaults to off (dark-launch) and is admin-overridable', () => {
    expect(featureFlags.signupNudgeEnabled).toBe(false);
    expect(getClientFeatureFlags().signup_nudge_enabled).toBe(false);
    setAdminConfigCacheForTests({ feature_flags: { signup_nudge_enabled: true } });
    expect(featureFlags.signupNudgeEnabled).toBe(true);
    expect(getClientFeatureFlags().signup_nudge_enabled).toBe(true);
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
});
