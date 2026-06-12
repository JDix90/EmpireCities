import { describe, it, expect } from 'vitest';
import { pickQuickMatchEra, QUICK_MATCH_ERAS, LOBBY_ERA_MAP_IDS } from './lobbyMapOptions';

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
});
