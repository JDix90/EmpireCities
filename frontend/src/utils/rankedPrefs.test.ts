import { describe, it, expect, beforeEach } from 'vitest';
import {
  sanitizeRankedPrefs,
  getRankedOpponents,
  saveRankedOpponents,
  rankedEraSize,
  describeRankedGameSize,
} from './rankedPrefs';

describe('rankedPrefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('era defaults: 3 for world eras, 2 for ACW, 1 for Risorgimento', () => {
    expect(getRankedOpponents('ancient')).toBe(3);
    expect(getRankedOpponents('ww2')).toBe(3);
    expect(getRankedOpponents('acw')).toBe(2);
    expect(getRankedOpponents('risorgimento')).toBe(1);
  });

  it('unknown eras fall back to the world-map default and cap', () => {
    expect(getRankedOpponents('someday_era')).toBe(3);
    expect(rankedEraSize('someday_era').max).toBe(5);
  });

  it('save/load round-trips per era independently', () => {
    saveRankedOpponents('ancient', 5);
    saveRankedOpponents('acw', 3);
    expect(getRankedOpponents('ancient')).toBe(5);
    expect(getRankedOpponents('acw')).toBe(3);
    expect(getRankedOpponents('medieval')).toBe(3); // untouched era keeps default
  });

  it('saving clamps to the era cap (risorgimento max 2)', () => {
    saveRankedOpponents('risorgimento', 5);
    expect(getRankedOpponents('risorgimento')).toBe(2);
    saveRankedOpponents('ancient', 0);
    expect(getRankedOpponents('ancient')).toBe(1);
  });

  it('sanitize drops out-of-range, non-integer, and unknown-era entries', () => {
    const cleaned = sanitizeRankedPrefs({
      opponentsByEra: {
        ancient: 4,
        acw: 99,          // above acw cap → dropped
        ww2: 2.5,         // non-integer → dropped
        space_age: 3,     // not a ranked era → dropped
        modern: '3',      // wrong type → dropped
      },
    });
    expect(cleaned.opponentsByEra).toEqual({ ancient: 4 });
  });

  it('sanitize tolerates garbage shapes', () => {
    expect(sanitizeRankedPrefs(null).opponentsByEra).toEqual({});
    expect(sanitizeRankedPrefs('junk').opponentsByEra).toEqual({});
    expect(sanitizeRankedPrefs({ opponentsByEra: 7 }).opponentsByEra).toEqual({});
  });

  it('bad stored JSON falls back to defaults', () => {
    localStorage.setItem('cc-ranked-prefs', '{not json');
    expect(getRankedOpponents('ancient')).toBe(3);
  });

  it('describeRankedGameSize labels', () => {
    expect(describeRankedGameSize(1)).toBe('1v1 duel');
    expect(describeRankedGameSize(3)).toBe('4-player game');
    expect(describeRankedGameSize(5)).toBe('6-player game');
  });
});
