import { describe, it, expect } from 'vitest';
import { isTapGesture, TAP_MAX_DRIFT_PX } from './tapGesture';

describe('isTapGesture', () => {
  it('accepts a still press', () => {
    expect(isTapGesture({ x: 100, y: 100 }, { x: 100, y: 100 })).toBe(true);
  });

  it('accepts a slow, deliberate press — there is no time limit', () => {
    // The regression this guards: a 300 ms cap used to drop the careful press of
    // a player deciding where to attack, and the globe never had that cap.
    expect(isTapGesture({ x: 100, y: 100 }, { x: 103, y: 101 })).toBe(true);
  });

  it('rejects a pan', () => {
    expect(isTapGesture({ x: 100, y: 100 }, { x: 160, y: 140 })).toBe(false);
  });

  it('draws the line at the drift threshold', () => {
    expect(isTapGesture({ x: 0, y: 0 }, { x: TAP_MAX_DRIFT_PX, y: 0 })).toBe(true);
    expect(isTapGesture({ x: 0, y: 0 }, { x: TAP_MAX_DRIFT_PX + 1, y: 0 })).toBe(false);
  });

  it('is false when no pointerdown was recorded', () => {
    expect(isTapGesture(null, { x: 0, y: 0 })).toBe(false);
  });
});
