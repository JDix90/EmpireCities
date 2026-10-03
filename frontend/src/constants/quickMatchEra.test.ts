import { describe, it, expect } from 'vitest';
import {
  pickQuickMatchEra,
  QUICK_MATCH_ERAS,
  LOBBY_ERA_MAP_IDS,
} from './lobbyMapOptions';
import { withRequiredEraSystems } from '../utils/eraSystemDefaults';

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

describe('the Quick Match rotation', () => {
  it('leaves out Space Age, so every Quick Match is the classic game the button offers', () => {
    // Space Age forces the economy and tech trees on and keeps nine lunar tiles
    // behind an orbit gate, where a Domination ending can only end on the cap.
    expect(QUICK_MATCH_ERAS).not.toContain('space_age');
  });

  it('needs no extra systems for any era it can roll', () => {
    for (const era of QUICK_MATCH_ERAS) {
      expect(withRequiredEraSystems(era, {})).toEqual({});
    }
  });
});
