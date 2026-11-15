import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

const queryMock = vi.fn();
const publishMock = vi.fn();
vi.mock('../db/postgres', () => ({
  query: (...a: unknown[]) => queryMock(...a),
  queryOne: (...a: unknown[]) => queryMock(...a),
}));
vi.mock('../db/redis', () => ({
  redis: { publish: (...a: unknown[]) => publishMock(...a), duplicate: vi.fn() },
}));

import {
  applyAdminSnapshotsToSettings,
  applyFeatureFlagPatch,
  getEconomyConfig,
  getNativeAppConfig,
  getXpConfig,
  refreshAdminConfigCache,
  resetAdminConfigCacheForTests,
  setAdminConfigCacheForTests,
  upsertAdminConfig,
  validateNativeAppConfig,
  type NativeAppConfig,
} from './adminConfig';

describe('adminConfig cache helpers', () => {
  afterEach(() => {
    resetAdminConfigCacheForTests();
  });

  it('returns default-ish values when cache has not been patched', () => {
    const xp = getXpConfig();
    expect(xp.base).toBe(50);
    expect(getEconomyConfig().building_costs.production_1).toBe(3);
  });

  it('reflects test cache patches in getters', () => {
    setAdminConfigCacheForTests({
      xp: { base: 77 } as any,
    });
    expect(getXpConfig().base).toBe(77);
  });

  it('injects economy/xp snapshots into game settings', () => {
    const settings = applyAdminSnapshotsToSettings({ turn_timer_seconds: 300 });
    expect(settings.economy_snapshot).toBeTruthy();
    expect(settings.xp_snapshot).toBeTruthy();
  });
});

describe('applyFeatureFlagPatch', () => {
  it('changes only the keys in the patch', () => {
    const result = applyFeatureFlagPatch({ spectate_enabled: true, today_panel_enabled: false }, {
      today_panel_enabled: true,
    });
    expect(result).toEqual({ next: { spectate_enabled: true, today_panel_enabled: true } });
  });

  it('clears an override with null so the flag falls back to its code default', () => {
    const result = applyFeatureFlagPatch({ spectate_enabled: true, map_editor_enabled: true }, {
      spectate_enabled: null,
    });
    expect(result).toEqual({ next: { map_editor_enabled: true } });
  });

  it('adds a new override without disturbing existing ones', () => {
    const result = applyFeatureFlagPatch({ spectate_enabled: true }, { map_editor_enabled: false });
    expect(result).toEqual({ next: { spectate_enabled: true, map_editor_enabled: false } });
  });

  it('clearing a key that was never overridden is a no-op', () => {
    expect(applyFeatureFlagPatch({ spectate_enabled: true }, { today_panel_enabled: null })).toEqual({
      next: { spectate_enabled: true },
    });
  });

  it('rejects non-boolean values and non-object patches', () => {
    expect(applyFeatureFlagPatch({}, { spectate_enabled: 'yes' })).toEqual({
      error: 'feature_flags.spectate_enabled must be a boolean, or null to clear the override',
    });
    expect(applyFeatureFlagPatch({}, [])).toEqual({ error: 'feature_flags patch must be an object' });
    expect(applyFeatureFlagPatch({}, null)).toEqual({ error: 'feature_flags patch must be an object' });
  });

  it('does not mutate the current overrides', () => {
    const current = { spectate_enabled: true };
    applyFeatureFlagPatch(current, { spectate_enabled: null, map_editor_enabled: true });
    expect(current).toEqual({ spectate_enabled: true });
  });
});

describe('upsertAdminConfig cross-instance invalidation', () => {
  beforeEach(() => {
    queryMock.mockReset().mockResolvedValue([]);
    publishMock.mockReset().mockResolvedValue(1);
  });
  afterEach(() => resetAdminConfigCacheForTests());

  it('publishes a cache invalidation after writing the config', async () => {
    await upsertAdminConfig('economy', { building_costs: {} }, 'admin-1');
    expect(publishMock).toHaveBeenCalledWith('admin-config:invalidate', 'economy');
  });
});

// The minimum app version. A typo in it locks every app player out, so unlike
// the other blocks this one is checked before it is stored.
describe('native_app config', () => {
  const none: NativeAppConfig = { ios_min_version: '', ios_store_url: '', android_min_version: '', android_store_url: '' };

  beforeEach(() => {
    queryMock.mockReset().mockResolvedValue([]);
  });
  afterEach(() => resetAdminConfigCacheForTests());

  it('defaults to no minimum and no store link', () => {
    expect(getNativeAppConfig()).toEqual(none);
  });

  it('accepts a version and an https store link, and keeps what the patch leaves out', () => {
    const current: NativeAppConfig = { ...none, android_min_version: '1.1.0' };
    expect(validateNativeAppConfig(current, {
      ios_min_version: ' 1.4.0 ',
      ios_store_url: 'https://apps.apple.com/app/id0000000000',
    })).toEqual({
      next: {
        ios_min_version: '1.4.0',
        ios_store_url: 'https://apps.apple.com/app/id0000000000',
        android_min_version: '1.1.0',
        android_store_url: '',
      },
    });
    expect(current.ios_min_version).toBe('');
  });

  it('clears a minimum with an empty string', () => {
    expect(validateNativeAppConfig({ ...none, ios_min_version: '1.4.0' }, { ios_min_version: '' })).toEqual({ next: none });
  });

  it('refuses a minimum that is not a plain version', () => {
    for (const bad of ['v1.4.0', '1.4.0-beta', '1.4.0.1', 'latest', '1,4']) {
      const result = validateNativeAppConfig(none, { ios_min_version: bad });
      expect(result, bad).toEqual({
        error: 'native_app.ios_min_version must look like 1.4.0 (one to three numbers), or "" for no minimum',
      });
    }
  });

  it('refuses a store link that is not https, a value that is not a string, and an unknown setting', () => {
    expect(validateNativeAppConfig(none, { ios_store_url: 'http://apps.apple.com/app/id1' })).toHaveProperty('error');
    expect(validateNativeAppConfig(none, { ios_store_url: 'javascript:alert(1)' })).toHaveProperty('error');
    expect(validateNativeAppConfig(none, { ios_store_url: 'not a link' })).toHaveProperty('error');
    expect(validateNativeAppConfig(none, { ios_min_version: 1.4 })).toEqual({
      error: 'native_app.ios_min_version must be a string ("" for none)',
    });
    expect(validateNativeAppConfig(none, { ios_minimum: '1.4.0' })).toHaveProperty('error');
    expect(validateNativeAppConfig(none, ['1.4.0'])).toEqual({ error: 'native_app must be an object' });
    expect(validateNativeAppConfig(none, null)).toEqual({ error: 'native_app must be an object' });
  });

  it('merges a stored row over the defaults, so a row with one field keeps the rest', async () => {
    queryMock.mockResolvedValueOnce([{ config_key: 'native_app', value: { ios_min_version: '1.4.0' } }]);
    await refreshAdminConfigCache();
    expect(getNativeAppConfig()).toEqual({ ...none, ios_min_version: '1.4.0' });
  });
});
