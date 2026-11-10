import { describe, it, expect } from 'vitest';
import { campaignClockSettings } from './campaignClock';
import { normalizeGameSettings } from '../../game-engine/state/gameSettings';

describe('campaignClockSettings (solo_untimed_enabled)', () => {
  it('creates a stage untimed with the flag on', () => {
    expect(campaignClockSettings(true)).toEqual({ turn_timer_seconds: 0 });
    // 0 survives normalisation: it is "no timer", not "missing".
    expect(normalizeGameSettings({ ...campaignClockSettings(true) }).turn_timer_seconds).toBe(0);
  });

  it('leaves the clock to the defaults with the flag off', () => {
    expect(campaignClockSettings(false)).toEqual({});
  });
});
