import { describe, it, expect, afterEach } from 'vitest';
import {
  applyAdminSnapshotsToSettings,
  getEconomyConfig,
  getXpConfig,
  resetAdminConfigCacheForTests,
  setAdminConfigCacheForTests,
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
