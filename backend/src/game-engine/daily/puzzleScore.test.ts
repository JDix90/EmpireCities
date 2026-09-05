import { describe, it, expect } from 'vitest';
import { computeDailyPuzzleScore, PAR_BASE, PAR_CEILING } from './puzzleScore';

describe('computeDailyPuzzleScore', () => {
  it('is 1000 at par, more under it, less over it', () => {
    expect(computeDailyPuzzleScore({ won: true, turns: 3, par: 3, mistakes: 0 })).toBe(PAR_BASE);
    expect(computeDailyPuzzleScore({ won: true, turns: 2, par: 3, mistakes: 0 })).toBe(1050);
    expect(computeDailyPuzzleScore({ won: true, turns: 5, par: 3, mistakes: 0 })).toBe(900);
  });

  it('still charges for risky moves', () => {
    expect(computeDailyPuzzleScore({ won: true, turns: 3, par: 3, mistakes: 2 })).toBe(976);
  });

  it('is capped above and floored at zero', () => {
    expect(computeDailyPuzzleScore({ won: true, turns: 1, par: 40, mistakes: 0 })).toBe(PAR_CEILING);
    expect(computeDailyPuzzleScore({ won: true, turns: 40, par: 1, mistakes: 0 })).toBe(0);
  });

  it('without par, or on a loss, it is the pre-par score', () => {
    expect(computeDailyPuzzleScore({ won: true, turns: 9, mistakes: 1 })).toBe(988);
    expect(computeDailyPuzzleScore({ won: false, turns: 2, par: 5, mistakes: 0 })).toBe(PAR_BASE);
  });
});
