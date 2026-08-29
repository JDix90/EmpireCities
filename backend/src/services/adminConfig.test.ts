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
  getXpConfig,
  resetAdminConfigCacheForTests,
  setAdminConfigCacheForTests,
  upsertAdminConfig,
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
