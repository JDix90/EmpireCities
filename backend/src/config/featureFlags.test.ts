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
});
