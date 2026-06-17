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
