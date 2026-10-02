import { describe, it, expect } from 'vitest';
import { effectiveContinentBonus, isContinentBonusScaled } from './continentBonus';

describe('effectiveContinentBonus', () => {
  it('is unscaled at the 6-player reference', () => {
    expect(effectiveContinentBonus(4, 6)).toBe(4);
    expect(effectiveContinentBonus(7, 6)).toBe(7);
  });

  it('scales down for smaller games (the Ottoman +4 → +2 at 4 players case)', () => {
    expect(effectiveContinentBonus(4, 4)).toBe(2); // floor(16/6)
    expect(effectiveContinentBonus(4, 2)).toBe(1); // floor(8/6)
    expect(effectiveContinentBonus(2, 3)).toBe(1); // floor(6/6)
  });

  it('clamps player count to [2, 12]', () => {
    expect(effectiveContinentBonus(4, 1)).toBe(effectiveContinentBonus(4, 2)); // min 2
    expect(effectiveContinentBonus(4, 99)).toBe(effectiveContinentBonus(4, 12)); // max 12
    expect(effectiveContinentBonus(4, 12)).toBe(8); // floor(48/6)
  });

  it('returns 0 for a zero bonus', () => {
    expect(effectiveContinentBonus(0, 4)).toBe(0);
  });

  it('never pays +0 for a held region (the Great Britain 925 two-player case)', () => {
    expect(effectiveContinentBonus(1, 2)).toBe(1); // floor(2/6) = 0 → floored
    expect(effectiveContinentBonus(2, 2)).toBe(1); // floor(4/6) = 0 → floored
    expect(effectiveContinentBonus(1, 5)).toBe(1); // floor(5/6) = 0 → floored
  });

  it('mirrors the backend scaleRegionBonus formula', () => {
    // backend: bonus > 0 ? max(1, floor((bonus * clamp(pc,2,12)) / 6)) : 0
    const backendScale = (bonus: number, pc: number) =>
      bonus > 0 ? Math.max(1, Math.floor((bonus * Math.max(2, Math.min(pc, 12))) / 6)) : 0;
    for (const bonus of [0, 2, 3, 4, 5, 7]) {
      for (const pc of [1, 2, 3, 4, 5, 6, 8, 12, 20]) {
        expect(effectiveContinentBonus(bonus, pc)).toBe(backendScale(bonus, pc));
      }
    }
  });

  it('flags when scaling changes the effective bonus', () => {
    expect(isContinentBonusScaled(4, 4)).toBe(true);
    expect(isContinentBonusScaled(4, 6)).toBe(false);
    expect(isContinentBonusScaled(0, 2)).toBe(false);
  });
});
