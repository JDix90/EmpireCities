import { describe, it, expect, afterEach } from 'vitest';
import type { GameState } from '../../types';
import { resolveXpConfig } from './statsManager';
import { resetAdminConfigCacheForTests, setAdminConfigCacheForTests } from '../../services/adminConfig';

describe('resolveXpConfig', () => {
  afterEach(() => {
    resetAdminConfigCacheForTests();
  });

  it('uses cached config when no snapshot exists', () => {
    setAdminConfigCacheForTests({ xp: { base: 81 } as any });
    const state = { settings: {} } as GameState;
    expect(resolveXpConfig(state).base).toBe(81);
  });

  it('uses game snapshot over live cache values', () => {
    setAdminConfigCacheForTests({ xp: { base: 81 } as any });
    const state = {
      settings: {
        xp_snapshot: {
          base: 52,
        },
      },
    } as GameState;
    expect(resolveXpConfig(state).base).toBe(52);
  });
});
