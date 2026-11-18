import { describe, expect, it } from 'vitest';
import { lobbySeatColors } from './seatColors';

const BLUE = '#3498db';
const RED = '#e74c3c';

describe('lobbySeatColors', () => {
  it('seats the host blue and the first bot red when every other seat is a bot', () => {
    expect(lobbySeatColors(1, 2).slice(0, 2)).toEqual([BLUE, RED]);
    expect(lobbySeatColors(3, 4).slice(0, 2)).toEqual([BLUE, RED]);
  });

  it('keeps the lobby order while a human seat is open', () => {
    expect(lobbySeatColors(0, 4).slice(0, 2)).toEqual([RED, BLUE]);
    expect(lobbySeatColors(2, 4).slice(0, 2)).toEqual([RED, BLUE]);
  });

  it('deals eight distinct colours either way', () => {
    for (const colors of [lobbySeatColors(1, 2), lobbySeatColors(0, 8)]) {
      expect(new Set(colors).size).toBe(8);
    }
  });
});
