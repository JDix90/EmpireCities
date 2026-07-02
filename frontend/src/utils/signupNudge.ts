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
}

/** Outcome-aware headline + pitch — leads with the win when the guest just won. */
export function signupNudgeCopy(isWinner: boolean): SignupNudgeCopy {
  return isWinner
    ? {
        title: 'Victory!',
        body: 'You won — lock it in. Your XP, rank, and streak are saved to this guest session. Create a free account to keep them for good and protect your streak.',
      }
    : {
        // Outcome-agnostic so it doesn't read as patronizing after a loss.
        title: 'Save your progress',
        body: 'Your XP, level, and streak are saved to this guest session — create a free account to make them permanent and protect your streak.',
      };
}
