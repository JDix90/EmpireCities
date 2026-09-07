/**
 * Gating + copy for the one-time guest → create-account nudge shown after a
 * (non-tutorial) game finishes. Pure functions so the decision is unit-testable
 * and the GamePage wiring stays thin. See GuestSignupNudgeModal + GamePage's
 * maybePromptSignupNudge. Tutorial games run their own account prompt and must
 * be filtered out by the caller before this is consulted.
 */

/** sessionStorage key — once per tab session, mirroring the tutorial prompt. */
export const SIGNUP_NUDGE_SHOWN_KEY = 'cc-signup-nudge-shown';

export interface SignupNudgeGate {
  /** Only guests are nudged to create an account. */
  isGuest: boolean;
  /** The `signup_nudge_enabled` feature flag. */
  flagEnabled: boolean;
  /** Whether the nudge already fired this tab session. */
  alreadyShownThisSession: boolean;
}

/**
 * Whether to surface the guest signup nudge. The caller is responsible for
 * excluding tutorial and campaign games (those have their own end flows).
 */
export function shouldShowSignupNudge({
  isGuest,
  flagEnabled,
  alreadyShownThisSession,
}: SignupNudgeGate): boolean {
  return isGuest && flagEnabled && !alreadyShownThisSession;
}

export interface SignupNudgeCopy {
  title: string;
  body: string;
  /**
   * Set when the guest has banked gold. They have never seen this number:
   * every gold surface in the app (the nav pill, the profile row) is inside a
   * `!is_guest` guard, while the award path at game end has no such guard — so
   * a guest accrues a currency the UI never mentions. It carries over on
   * upgrade (same `user_id`), which makes it a concrete thing to offer rather
   * than a dead end to hide.
   */
  bankedGold?: string;
}

/** Gold a guest has quietly accumulated, phrased for the nudge. */
export function bankedGoldNote(gold: number | undefined): string | undefined {
  if (!gold || gold <= 0) return undefined;
  return `You have also banked ${gold.toLocaleString()} gold. It comes with you — an account is what lets you spend it.`;
}

/**
 * Outcome-aware headline + pitch — leads with the win when the guest just won.
 *
 * Both bodies name the actual stake. A guest row carries a synthetic
 * `<uuid>@guest.local` address and no password the player knows, and both
 * `login` and password reset exclude that domain — so the refresh cookie in
 * this browser is the ONLY way back to the account. Another device, another
 * browser, or cleared site data and it is unreachable for good (the row is not
 * even deleted; `guestCleanupService` keeps it because they played).
 *
 * The copy this replaces said "saved to this guest session … make them
 * permanent", which is true but reads as generic upsell and never told anyone
 * the thing that is actually urgent.
 */
export function signupNudgeCopy(isWinner: boolean, gold?: number): SignupNudgeCopy {
  const banked = bankedGoldNote(gold);
  return isWinner
    ? {
        bankedGold: banked,
        title: 'Victory!',
        body: 'You won — and the record of it sits on a guest account with no email or password, in this browser only. Open Borderfall anywhere else and it does not exist. A free account keeps your level, gold and streak, on every device.',
      }
    : {
        bankedGold: banked,
        // Outcome-agnostic so it doesn't read as patronizing after a loss.
        title: 'This account lives in one browser',
        body: 'Your level, gold and streak are on a guest account with no email or password to sign back in with. Switch devices, or clear your browser data, and there is no way back to it. A free account keeps everything you have earned, anywhere you play.',
      };
}
