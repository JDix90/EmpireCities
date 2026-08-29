import { describe, it, expect } from 'vitest';
import { estimatedTime } from './dailyEstimate';

describe('daily challenge time estimate', () => {
  it('does not read the turn limit as a number of minutes', () => {
    // The regression: `max_turns: 18` used to render "~18–23 min" on a puzzle
    // that can be won on turn 1. The estimate must not move with the turn cap.
    const withCap = estimatedTime({ archetype: 'military_capture', max_turns: 18 } as { archetype?: string });
    const withoutCap = estimatedTime({ archetype: 'military_capture' });
    expect(withCap).toBe(withoutCap);
    expect(withCap).not.toMatch(/18/);
  });

  it('gives every archetype a label', () => {
    for (const archetype of ['military_capture', 'economy_build', 'tech_research', 'domination']) {
      expect(estimatedTime({ archetype })).toMatch(/^\d+–\d+ min$/);
    }
  });

  it('falls back for an unknown or missing archetype', () => {
    expect(estimatedTime({})).toMatch(/min$/);
    expect(estimatedTime({ archetype: 'something_new' })).toMatch(/min$/);
  });

  it('stays under the old estimates, which overstated by an order of magnitude', () => {
    const low = (s: string) => Number(s.split('–')[0]);
    expect(low(estimatedTime({ archetype: 'military_capture' }))).toBeLessThan(8);
    expect(low(estimatedTime({ archetype: 'domination' }))).toBeLessThan(20);
  });
});
