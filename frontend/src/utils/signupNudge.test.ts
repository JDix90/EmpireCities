import { describe, it, expect } from 'vitest';
import { bankedGoldNote, shouldShowSignupNudge, signupNudgeCopy } from './signupNudge';

describe('shouldShowSignupNudge', () => {
  const base = { isGuest: true, flagEnabled: true, alreadyShownThisSession: false };

  it('shows only when guest + flag on + not already shown', () => {
    expect(shouldShowSignupNudge(base)).toBe(true);
  });

  it('never shows for a registered (non-guest) user', () => {
    expect(shouldShowSignupNudge({ ...base, isGuest: false })).toBe(false);
  });

  it('never shows when the flag is off', () => {
    expect(shouldShowSignupNudge({ ...base, flagEnabled: false })).toBe(false);
  });

  it('does not show twice in a session', () => {
    expect(shouldShowSignupNudge({ ...base, alreadyShownThisSession: true })).toBe(false);
  });
});

describe('signupNudgeCopy', () => {
  it('leads with the victory when the guest won', () => {
    const c = signupNudgeCopy(true);
    expect(c.title).toBe('Victory!');
    expect(c.body.toLowerCase()).toContain('won');
  });

  it('uses neutral, non-patronizing copy on a loss/finish', () => {
    const c = signupNudgeCopy(false);
    expect(c.title).toBe('This account lives in one browser');
    expect(c.body.toLowerCase()).not.toContain('you lost');
  });

  it('names the actual stake rather than "save your progress"', () => {
    // A guest row carries a synthetic @guest.local address and no password the
    // player knows; login and password reset both exclude that domain. The
    // browser's refresh cookie is the only way back, and nothing in the product
    // used to say so — the old copy promised "permanent" progress and left the
    // reason to create an account entirely abstract.
    for (const c of [signupNudgeCopy(true), signupNudgeCopy(false)]) {
      const body = c.body.toLowerCase();
      expect(body).toContain('no email or password');
      expect(body).toContain('browser');
      expect(body).not.toContain('guest session');
    }
  });

  it('offers the banked gold only when there is some', () => {
    // Every gold surface in the app sits behind `!is_guest`, while the award
    // path at game end does not — so this number is real and a guest has never
    // been shown it.
    expect(signupNudgeCopy(false, 340).bankedGold).toContain('340 gold');
    expect(signupNudgeCopy(false, 0).bankedGold).toBeUndefined();
    expect(signupNudgeCopy(false).bankedGold).toBeUndefined();
  });
});

describe('bankedGoldNote', () => {
  it('formats a real balance and says it survives the upgrade', () => {
    const note = bankedGoldNote(1250)!;
    expect(note).toContain('1,250 gold');
    expect(note.toLowerCase()).toContain('comes with you');
  });

  it('stays silent for nothing, zero, or a negative', () => {
    expect(bankedGoldNote(undefined)).toBeUndefined();
    expect(bankedGoldNote(0)).toBeUndefined();
    expect(bankedGoldNote(-5)).toBeUndefined();
  });
});
