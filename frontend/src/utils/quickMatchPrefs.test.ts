import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_QUICK_MATCH_PREFS,
  describeQuickMatchPrefs,
  loadQuickMatchPrefs,
  sanitizeQuickMatchPrefs,
  saveQuickMatchPrefs,
} from './quickMatchPrefs';

describe('quickMatchPrefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('sanitizeQuickMatchPrefs', () => {
    it('returns defaults for non-objects and garbage', () => {
      expect(sanitizeQuickMatchPrefs(null)).toEqual(DEFAULT_QUICK_MATCH_PREFS);
      expect(sanitizeQuickMatchPrefs('nope')).toEqual(DEFAULT_QUICK_MATCH_PREFS);
      expect(sanitizeQuickMatchPrefs(42)).toEqual(DEFAULT_QUICK_MATCH_PREFS);
      expect(sanitizeQuickMatchPrefs(undefined)).toEqual(DEFAULT_QUICK_MATCH_PREFS);
    });

    it('keeps valid fields and repairs invalid ones independently', () => {
      expect(sanitizeQuickMatchPrefs({ aiCount: 7, aiDifficulty: 'bogus' })).toEqual({
        aiCount: 7,
        aiDifficulty: DEFAULT_QUICK_MATCH_PREFS.aiDifficulty,
      });
      expect(sanitizeQuickMatchPrefs({ aiCount: 99, aiDifficulty: 'expert' })).toEqual({
        aiCount: DEFAULT_QUICK_MATCH_PREFS.aiCount,
        aiDifficulty: 'expert',
      });
    });

    it('rejects out-of-range and non-integer counts', () => {
      expect(sanitizeQuickMatchPrefs({ aiCount: 0 }).aiCount).toBe(DEFAULT_QUICK_MATCH_PREFS.aiCount);
      expect(sanitizeQuickMatchPrefs({ aiCount: 8 }).aiCount).toBe(DEFAULT_QUICK_MATCH_PREFS.aiCount);
      expect(sanitizeQuickMatchPrefs({ aiCount: 2.5 }).aiCount).toBe(DEFAULT_QUICK_MATCH_PREFS.aiCount);
      expect(sanitizeQuickMatchPrefs({ aiCount: '3' }).aiCount).toBe(DEFAULT_QUICK_MATCH_PREFS.aiCount);
    });
  });

  describe('load/save round-trip', () => {
    it('returns defaults when nothing is stored', () => {
      expect(loadQuickMatchPrefs()).toEqual(DEFAULT_QUICK_MATCH_PREFS);
    });

    it('round-trips saved prefs', () => {
      saveQuickMatchPrefs({ aiCount: 5, aiDifficulty: 'hard' });
      expect(loadQuickMatchPrefs()).toEqual({ aiCount: 5, aiDifficulty: 'hard' });
    });

    it('survives corrupted storage', () => {
      localStorage.setItem('cc-quick-match-prefs', '{not json');
      expect(loadQuickMatchPrefs()).toEqual(DEFAULT_QUICK_MATCH_PREFS);
    });

    it('sanitizes stale/out-of-range stored values', () => {
      localStorage.setItem('cc-quick-match-prefs', JSON.stringify({ aiCount: 42, aiDifficulty: 'nightmare' }));
      expect(loadQuickMatchPrefs()).toEqual(DEFAULT_QUICK_MATCH_PREFS);
    });
  });

  it('describes prefs for button copy', () => {
    expect(describeQuickMatchPrefs({ aiCount: 3, aiDifficulty: 'medium' })).toBe('3 Medium AI');
    expect(describeQuickMatchPrefs({ aiCount: 7, aiDifficulty: 'expert' })).toBe('7 Expert AI');
  });
});
