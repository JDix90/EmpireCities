import { describe, it, expect } from 'vitest';
import { soloTurnTimerSeconds, SOLO_TIMED_TURN_SECONDS } from './soloTimer';

describe('soloTurnTimerSeconds', () => {
  it('builds a solo game untimed with the flag on', () => {
    expect(soloTurnTimerSeconds(true)).toBe(0);
  });

  it('keeps the five-minute clock with the flag off', () => {
    expect(soloTurnTimerSeconds(false)).toBe(SOLO_TIMED_TURN_SECONDS);
    expect(SOLO_TIMED_TURN_SECONDS).toBe(300);
  });
});
