import { describe, it, expect } from 'vitest';
import {
  ORBIT_GATED_QUICK_MATCH_ERAS,
  pickQuickMatchEra,
  quickMatchEraPool,
  QUICK_MATCH_ERAS,
  LOBBY_ERA_MAP_IDS,
} from './lobbyMapOptions';

describe('pickQuickMatchEra', () => {
  it('covers every pool era across the random range', () => {
    const seen = new Set<string>();
    for (let i = 0; i < QUICK_MATCH_ERAS.length; i++) {
      seen.add(pickQuickMatchEra(() => i / QUICK_MATCH_ERAS.length));
    }
    expect([...seen].sort()).toEqual([...QUICK_MATCH_ERAS].sort());
  });

  it('stays in bounds at the random edges', () => {
    expect(QUICK_MATCH_ERAS).toContain(pickQuickMatchEra(() => 0));
    expect(QUICK_MATCH_ERAS).toContain(pickQuickMatchEra(() => 0.999999));
  });

  it('every pool era has a bundled map id (the payload pairs era_id with its map)', () => {
    for (const era of QUICK_MATCH_ERAS) {
      expect(LOBBY_ERA_MAP_IDS[era]).toMatch(/^era_/);
    }
  });

  it('excludes regional theaters and the admin-gated galaxy', () => {
    expect(QUICK_MATCH_ERAS).not.toContain('acw');
    expect(QUICK_MATCH_ERAS).not.toContain('risorgimento');
    expect(QUICK_MATCH_ERAS).not.toContain('galaxy_age');
  });

  it('rolls only from the pool it is given', () => {
    const pool = ['medieval', 'modern'] as const;
    expect(pickQuickMatchEra(() => 0, pool)).toBe('medieval');
    expect(pickQuickMatchEra(() => 0.999999, pool)).toBe('modern');
  });

  it('falls back to the full rotation rather than crashing on an empty pool', () => {
    expect(QUICK_MATCH_ERAS).toContain(pickQuickMatchEra(() => 0.5, []));
  });
});

describe('quickMatchEraPool', () => {
  it('is the whole rotation for endings that only need a share of the board', () => {
    expect(quickMatchEraPool({ requiresFullBoard: false })).toEqual(QUICK_MATCH_ERAS);
    expect(quickMatchEraPool()).toEqual(QUICK_MATCH_ERAS);
  });

  it('drops orbit-gated eras when the ending needs the whole board', () => {
    // Space Age keeps nine tiles behind the orbit gate: a Conquest match there
    // could only ever end on the turn cap, which is the confusion the win
    // condition picker exists to remove.
    const pool = quickMatchEraPool({ requiresFullBoard: true });
    for (const era of ORBIT_GATED_QUICK_MATCH_ERAS) {
      expect(pool).not.toContain(era);
    }
    expect(pool.length).toBe(QUICK_MATCH_ERAS.length - ORBIT_GATED_QUICK_MATCH_ERAS.length);
    expect(pool.length).toBeGreaterThan(0);
  });

  it('every orbit-gated entry is actually in the rotation (no dead names)', () => {
    for (const era of ORBIT_GATED_QUICK_MATCH_ERAS) {
      expect(QUICK_MATCH_ERAS).toContain(era);
    }
  });
});
