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
});
