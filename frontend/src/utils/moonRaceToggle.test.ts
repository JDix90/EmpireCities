import { describe, it, expect } from 'vitest';
import { moonRaceApplicable, moonRaceCreateValue } from './moonRaceToggle';

describe('when the lobby offers a Moon Race', () => {
  it('offers it on a Space Age create once the operator ships a phase', () => {
    expect(moonRaceApplicable('space_age', true)).toBe(true);
  });

  it('hides it while every phase is dark — a toggle that turns nothing on', () => {
    expect(moonRaceApplicable('space_age', false)).toBe(false);
  });

  it('hides it in eras with no Moon to race for', () => {
    for (const era of ['ancient', 'ww2', 'modern', 'galaxy_age']) {
      expect(moonRaceApplicable(era, true)).toBe(false);
    }
  });
});

describe('what the create request carries', () => {
  it('sends an explicit false when the player declines', () => {
    // NOT undefined: the server reads absent as "whatever the operator ships",
    // so an omitted untick would silently run the package they just declined.
    expect(moonRaceCreateValue(true, false)).toBe(false);
  });

  it('sends an explicit true when they accept', () => {
    expect(moonRaceCreateValue(true, true)).toBe(true);
  });

  it('says nothing when the toggle was never on screen', () => {
    // Leaving the field off is what lets the server apply its own default for
    // callers that predate the toggle.
    expect(moonRaceCreateValue(false, true)).toBeUndefined();
    expect(moonRaceCreateValue(false, false)).toBeUndefined();
  });
});
