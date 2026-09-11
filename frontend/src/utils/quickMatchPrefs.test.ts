import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_QUICK_MATCH_PREFS,
  describeQuickMatchPrefs,
  loadFullGamePrefs,
  loadQuickMatchPrefs,
  quickMatchRequiresFullBoard,
  quickMatchVictorySettings,
  sanitizeQuickMatchPrefs,
  saveFullGamePrefs,
  saveQuickMatchPrefs,
  QUICK_MATCH_VICTORY_MODES,
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
        ...DEFAULT_QUICK_MATCH_PREFS,
        aiCount: 7,
      });
      expect(sanitizeQuickMatchPrefs({ aiCount: 99, aiDifficulty: 'expert', victory: 'conquest' })).toEqual({
        ...DEFAULT_QUICK_MATCH_PREFS,
        aiDifficulty: 'expert',
        victory: 'conquest',
      });
    });

    it('falls back to the historical ending for an unknown victory value', () => {
      // A pref saved before the picker existed, or a hand-edited key.
      expect(sanitizeQuickMatchPrefs({ aiCount: 3, victory: 'annihilation' }).victory).toBe('majority');
      expect(sanitizeQuickMatchPrefs({ aiCount: 3 }).victory).toBe('majority');
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
      saveQuickMatchPrefs({ aiCount: 5, aiDifficulty: 'hard', victory: 'conquest' });
      expect(loadQuickMatchPrefs()).toEqual({ aiCount: 5, aiDifficulty: 'hard', victory: 'conquest' });
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

  describe('full game prefs', () => {
    it('round-trips independently of quick match prefs', () => {
      saveQuickMatchPrefs({ aiCount: 7, aiDifficulty: 'easy', victory: 'blitz' });
      saveFullGamePrefs({ aiCount: 2, aiDifficulty: 'hard', victory: 'majority' });

      expect(loadQuickMatchPrefs()).toEqual({ aiCount: 7, aiDifficulty: 'easy', victory: 'blitz' });
      expect(loadFullGamePrefs()).toEqual({ aiCount: 2, aiDifficulty: 'hard', victory: 'majority' });
    });

    it('defaults when only quick match prefs exist', () => {
      saveQuickMatchPrefs({ aiCount: 7, aiDifficulty: 'easy', victory: 'blitz' });
      expect(loadFullGamePrefs()).toEqual(DEFAULT_QUICK_MATCH_PREFS);
    });
  });

  it('describes prefs for button copy', () => {
    expect(describeQuickMatchPrefs({ aiCount: 3, aiDifficulty: 'medium', victory: 'majority' })).toBe('3 Medium AI');
    expect(describeQuickMatchPrefs({ aiCount: 7, aiDifficulty: 'expert', victory: 'conquest' })).toBe('7 Expert AI');
  });

  describe('quickMatchVictorySettings', () => {
    const prefsFor = (victory: (typeof QUICK_MATCH_VICTORY_MODES)[number]) =>
      ({ ...DEFAULT_QUICK_MATCH_PREFS, victory });

    it('keeps the historical Quick Match payload as the default', () => {
      expect(quickMatchVictorySettings(DEFAULT_QUICK_MATCH_PREFS)).toEqual({
        allowed_victory_conditions: ['domination', 'threshold'],
        victory_threshold: 65,
        max_turns: 60,
      });
    });

    it('sends a threshold percentage exactly when threshold is allowed', () => {
      // The create schema rejects one without the other (superRefine), and a
      // stray percentage on a non-threshold game would be silently misleading.
      for (const mode of QUICK_MATCH_VICTORY_MODES) {
        const out = quickMatchVictorySettings(prefsFor(mode));
        expect('victory_threshold' in out).toBe(out.allowed_victory_conditions.includes('threshold'));
      }
    });

    it('gives every ending a turn cap inside the create schema bounds', () => {
      for (const mode of QUICK_MATCH_VICTORY_MODES) {
        const { max_turns: cap } = quickMatchVictorySettings(prefsFor(mode));
        expect(cap).toBeGreaterThanOrEqual(10);
        expect(cap).toBeLessThanOrEqual(1000);
      }
    });

    it('scales the turn cap with how much board the ending asks for', () => {
      const cap = (mode: (typeof QUICK_MATCH_VICTORY_MODES)[number]) =>
        quickMatchVictorySettings(prefsFor(mode)).max_turns;
      // A Conquest match capped at Blitz's 45 turns would always end on the cap
      // rather than on the condition the player picked.
      expect(cap('blitz')).toBeLessThan(cap('majority'));
      expect(cap('majority')).toBeLessThan(cap('capitals'));
      expect(cap('capitals')).toBeLessThan(cap('conquest'));
    });

    it('asks for a shorter match the less board the ending needs', () => {
      expect(quickMatchVictorySettings(prefsFor('blitz')).victory_threshold).toBe(50);
      expect(quickMatchVictorySettings(prefsFor('majority')).victory_threshold).toBe(65);
    });

    it('wins Capitals by capitals, with domination as the decisive fallback', () => {
      expect(quickMatchVictorySettings(prefsFor('capitals')).allowed_victory_conditions).toEqual([
        'capital',
        'domination',
      ]);
    });

    it('makes Conquest mean the whole board, and nothing else', () => {
      expect(quickMatchVictorySettings(prefsFor('conquest')).allowed_victory_conditions).toEqual(['domination']);
    });

    it('returns a fresh condition list per call (callers spread it into a payload)', () => {
      const a = quickMatchVictorySettings(DEFAULT_QUICK_MATCH_PREFS);
      a.allowed_victory_conditions.push('capital');
      expect(quickMatchVictorySettings(DEFAULT_QUICK_MATCH_PREFS).allowed_victory_conditions).toEqual([
        'domination',
        'threshold',
      ]);
    });
  });

  describe('quickMatchRequiresFullBoard', () => {
    it('is true only for Conquest', () => {
      for (const mode of QUICK_MATCH_VICTORY_MODES) {
        expect(quickMatchRequiresFullBoard({ ...DEFAULT_QUICK_MATCH_PREFS, victory: mode })).toBe(
          mode === 'conquest',
        );
      }
    });
  });
});
