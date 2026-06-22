import { describe, it, expect } from 'vitest';
import { shouldShowSignupNudge, signupNudgeCopy } from './signupNudge';

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
    expect(c.title).toBe('Save your progress');
    expect(c.body.toLowerCase()).toContain('permanent');
  });
});
