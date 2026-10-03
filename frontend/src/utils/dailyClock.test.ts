import { describe, it, expect } from 'vitest';
import { dailyClockLabel } from './dailyClock';

describe('dailyClockLabel', () => {
  it('counts the turn against the limit on a build day', () => {
    expect(dailyClockLabel({ archetype: 'economy_build', max_turns: 5 }, 4)).toBe('Turn 4 of 5');
  });

  it('says so on the last turn', () => {
    expect(dailyClockLabel({ archetype: 'economy_build', max_turns: 5 }, 5)).toBe('Turn 5 of 5 \u00b7 last turn');
  });

  it('never shows a turn past the clock', () => {
    // The server fails the day before turn 6 is played; a stale frame must
    // not read "Turn 6 of 5".
    expect(dailyClockLabel({ archetype: 'military_capture', max_turns: 5 }, 6)).toBe('Turn 5 of 5 \u00b7 last turn');
  });

  it('reads the clock as the win on a hold day', () => {
    expect(dailyClockLabel({ archetype: 'hold_territory', max_turns: 7 }, 2)).toBe('Turn 2 of 7 \u00b7 hold to the end');
  });

  it('shows nothing on a domination day, which is never timed out', () => {
    expect(dailyClockLabel({ archetype: 'domination', max_turns: 30 }, 4)).toBeNull();
  });

  it('shows nothing without a limit to count against', () => {
    expect(dailyClockLabel({ archetype: 'economy_build' }, 4)).toBeNull();
    expect(dailyClockLabel({ archetype: 'economy_build', max_turns: 0 }, 4)).toBeNull();
    expect(dailyClockLabel(undefined, 4)).toBeNull();
  });

  it('starts at turn one before the first turn number arrives', () => {
    expect(dailyClockLabel({ archetype: 'tech_research', max_turns: 6 }, undefined)).toBe('Turn 1 of 6');
  });
});
