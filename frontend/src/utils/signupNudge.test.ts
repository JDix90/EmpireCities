import { describe, it, expect } from 'vitest';
import {
  accountModalShownThisSession,
  bankedGoldNote,
  shouldShowSignupNudge,
  signupNudgeCopy,
  SIGNUP_NUDGE_SHOWN_KEY,
  TUTORIAL_PROMPT_SHOWN_KEY,
} from './signupNudge';
import {
  CAMPAIGN_START_GATE,
  CAMPAIGN_START_GATE_V2,
  GUEST_NO_PERSIST,
  GUEST_SAVED_HERE,
  guestLine,
  LEADERBOARD_GUEST_NOTICE,
  LEADERBOARD_GUEST_NOTICE_V2,
} from './guestGate';

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
    expect(c.title).toBe(GUEST_NO_PERSIST);
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

describe('guest prompts v2 (guest_prompt_v2_enabled)', () => {
  it('says the progress is saved in this browser, never that it does not persist', () => {
    const v2 = [
      guestLine(true).statement,
      guestLine(true).cta,
      CAMPAIGN_START_GATE_V2.body,
      LEADERBOARD_GUEST_NOTICE_V2.body,
      signupNudgeCopy(true, undefined, true).body,
      signupNudgeCopy(false, undefined, true).title,
      signupNudgeCopy(false, undefined, true).body,
    ];
    for (const text of v2) {
      expect(text).not.toContain(GUEST_NO_PERSIST);
      expect(text.toLowerCase()).not.toContain('persist');
    }
    expect(guestLine(true).statement).toBe(GUEST_SAVED_HERE);
    expect(CAMPAIGN_START_GATE_V2.body).toContain(GUEST_SAVED_HERE);
    expect(LEADERBOARD_GUEST_NOTICE_V2.body).toContain(GUEST_SAVED_HERE);
    expect(signupNudgeCopy(true, undefined, true).body).toContain(GUEST_SAVED_HERE);
  });

  it('still names the real stake: another browser or cleared site data', () => {
    for (const body of [
      CAMPAIGN_START_GATE_V2.body,
      signupNudgeCopy(true, undefined, true).body,
      signupNudgeCopy(false, undefined, true).body,
    ]) {
      expect(body.toLowerCase()).toContain('no email or password');
      expect(body.toLowerCase()).toContain('site data');
    }
  });

  it('leaves the v1 copy exactly as it was', () => {
    expect(guestLine(false).statement).toBe(GUEST_NO_PERSIST);
    expect(signupNudgeCopy(false).title).toBe(GUEST_NO_PERSIST);
    expect(signupNudgeCopy(false, 340, false)).toEqual(signupNudgeCopy(false, 340));
    expect(CAMPAIGN_START_GATE_V2.title).toBe(CAMPAIGN_START_GATE.title);
    expect(LEADERBOARD_GUEST_NOTICE_V2.title).toBe(LEADERBOARD_GUEST_NOTICE.title);
  });

  it('keeps the winner\'s headline and the banked gold', () => {
    expect(signupNudgeCopy(true, 120, true).title).toBe('Victory!');
    expect(signupNudgeCopy(false, 120, true).bankedGold).toContain('120 gold');
  });
});

describe('accountModalShownThisSession', () => {
  const store = (keys: string[]) => (key: string) => (keys.includes(key) ? '1' : null);

  it('off v2, each modal only counts itself, so a guest saw both', () => {
    const read = store([TUTORIAL_PROMPT_SHOWN_KEY]);
    expect(accountModalShownThisSession(TUTORIAL_PROMPT_SHOWN_KEY, false, read)).toBe(true);
    expect(accountModalShownThisSession(SIGNUP_NUDGE_SHOWN_KEY, false, read)).toBe(false);
  });

  it('under v2 either modal uses up the session for both', () => {
    expect(accountModalShownThisSession(SIGNUP_NUDGE_SHOWN_KEY, true, store([TUTORIAL_PROMPT_SHOWN_KEY]))).toBe(true);
    expect(accountModalShownThisSession(TUTORIAL_PROMPT_SHOWN_KEY, true, store([SIGNUP_NUDGE_SHOWN_KEY]))).toBe(true);
    expect(accountModalShownThisSession(SIGNUP_NUDGE_SHOWN_KEY, true, store([]))).toBe(false);
  });

  it('keeps the tutorial prompt key it always used', () => {
    expect(TUTORIAL_PROMPT_SHOWN_KEY).toBe('cc-tutorial-prompt-shown');
  });
});

describe('signupNudgeCopy under save_account_copy_enabled', () => {
  it('says the progress is saved here and what saving the account adds', () => {
    const win = signupNudgeCopy(true, 0, true, true);
    expect(win.title).toBe('Victory!');
    expect(win.body).toBe(
      'You won. Your progress is saved in this browser. Save your account to keep it safe, play on any device, compete in ranked and play with friends.',
    );
    const loss = signupNudgeCopy(false, 0, true, true);
    expect(loss.title).toBe('Keep your progress safe');
    expect(loss.body).not.toMatch(/no way back|do not persist/);
  });

  it('adds that it takes just an email when saving does', () => {
    expect(signupNudgeCopy(false, 0, false, true, true).body).toMatch(/All it takes is your email\.$/);
    expect(signupNudgeCopy(false, 0, false, true, false).body).not.toMatch(/your email/);
  });

  it('keeps the banked gold note', () => {
    expect(signupNudgeCopy(false, 120, false, true).bankedGold).toMatch(/120 gold/);
  });
});

describe('guestLine under save_account_copy_enabled', () => {
  it('takes precedence over v2 and v1', () => {
    expect(guestLine(true, true)).toEqual({
      statement: 'Your progress is saved in this browser',
      cta: 'save your account to keep it safe and play on any device',
      ctaSentence: 'Save your account to keep it safe and play on any device',
    });
    expect(guestLine(true).cta).toBe('an account keeps it everywhere');
  });
});
