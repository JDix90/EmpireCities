import { describe, it, expect } from 'vitest';
import { friendStreakPercent } from './friendStreakBonus';

describe('friendStreakPercent', () => {
  it('reads the server\'s bonus object as a percentage', () => {
    expect(friendStreakPercent({ multiplier: 1.1, streak: 5, friends: ['Ada'] })).toBe(10);
    expect(friendStreakPercent({ multiplier: 1.05, streak: 2, friends: ['Ada'] })).toBe(5);
    expect(friendStreakPercent({ multiplier: 1.3, streak: 20, friends: ['Ada', 'Bo'] })).toBe(30);
  });

  it('is nothing without a bonus', () => {
    expect(friendStreakPercent(undefined)).toBe(0);
    expect(friendStreakPercent(null)).toBe(0);
    expect(friendStreakPercent({ multiplier: 1, streak: 1, friends: [] })).toBe(0);
    expect(friendStreakPercent(0)).toBe(0);
  });

  it('takes a bare number as a percentage already', () => {
    expect(friendStreakPercent(15)).toBe(15);
  });
});
