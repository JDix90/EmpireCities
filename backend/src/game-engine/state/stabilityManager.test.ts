import { describe, expect, it } from 'vitest';
import { getDeployCap } from './stabilityManager';

describe('getDeployCap', () => {
  it('returns Infinity when stability is undefined', () => {
    expect(getDeployCap(undefined)).toBe(Infinity);
  });

  it('returns Infinity when stability is healthy (>= 50)', () => {
    expect(getDeployCap(50)).toBe(Infinity);
    expect(getDeployCap(85)).toBe(Infinity);
  });

  it('keeps strict early-game cap for critical stability without progression bonuses', () => {
    const cap = getDeployCap(20, {
      era: 'ancient',
      turnNumber: 1,
      economyEnabled: false,
      playerSpecialResource: 99,
    });
    expect(cap).toBe(1);
  });

  it('scales cap upward in late game using era + turn + economy bonuses', () => {
    const cap = getDeployCap(20, {
      era: 'space_age',
      turnNumber: 25,
      economyEnabled: true,
      playerSpecialResource: 30,
    });
    expect(cap).toBe(12);
  });

  it('applies moderate scaling for low stability in mid game', () => {
    const cap = getDeployCap(40, {
      era: 'coldwar',
      turnNumber: 9,
      economyEnabled: true,
      playerSpecialResource: 10,
    });
    expect(cap).toBe(8);
  });

  it('does not apply economy bonus when economy is disabled', () => {
    const cap = getDeployCap(40, {
      era: 'modern',
      turnNumber: 17,
      economyEnabled: false,
      playerSpecialResource: 100,
    });
    // base 3 + era 2 + turn 4 + econ 0
    expect(cap).toBe(9);
  });
});
