/**
 * Gating and options for the one-question "how did you hear about us?" prompt.
 *
 * Why it exists: referrer-based attribution has a hole it cannot close.
 * ChatGPT stamps `utm_source=chatgpt.com` on the links it serves, so it shows
 * up in the funnel — but assistant desktop and mobile apps, and several web
 * assistants, send no referrer at all, and those visits are indistinguishable
 * from someone typing the URL. They land in `direct`. One self-reported answer
 * is the only signal that sees into that bucket.
 *
 * Pure functions so the decision is unit-testable and the ActionModal wiring
 * stays thin — same shape as utils/signupNudge.ts.
 */

/** localStorage key. `cc-` prefix per the repo's client-preference convention. */
export const REFERRAL_SURVEY_KEY = 'cc-referral-survey';

/**
 * Fixed options. No free-text field, deliberately: a free-text answer is an
 * unmoderated PII channel for a question whose whole value is a clean, small
 * dimension. `id` is what ships to analytics; `label` never leaves the client.
 */
export const REFERRAL_SURVEY_OPTIONS = [
  { id: 'ai_assistant', label: 'An AI assistant (ChatGPT, Claude, Gemini…)' },
  { id: 'search', label: 'A search engine' },
  { id: 'social', label: 'Reddit or social media' },
  { id: 'friend', label: 'A friend, streamer or video' },
  { id: 'other', label: 'Somewhere else' },
] as const;

export type ReferralSurveyAnswer = (typeof REFERRAL_SURVEY_OPTIONS)[number]['id'];

const VALID_ANSWERS = new Set<string>(REFERRAL_SURVEY_OPTIONS.map((o) => o.id));

/** True only for an id the current build actually offers. */
export function isValidReferralAnswer(value: unknown): value is ReferralSurveyAnswer {
  return typeof value === 'string' && VALID_ANSWERS.has(value);
}

/**
 * Has this browser already been asked? Anything unparseable counts as "asked"
 * — a corrupt value must not turn into a prompt on every game-over screen.
 */
export function hasAnsweredReferralSurvey(storage: Pick<Storage, 'getItem'>): boolean {
  try {
    return storage.getItem(REFERRAL_SURVEY_KEY) !== null;
  } catch {
    // Private mode / storage disabled: we cannot remember, so do not ask.
    return true;
  }
}

export interface ReferralSurveyGate {
  /** The `referral_survey_enabled` feature flag. */
  flagEnabled: boolean;
  /** Tutorial and daily-challenge games run their own end flows. */
  isTutorial: boolean;
  isDailyChallenge: boolean;
  /** Whether this browser has already answered (or cannot be remembered). */
  alreadyAnswered: boolean;
}

/**
 * Ask at most once per browser, and never during a flow that already owns the
 * end-of-game moment. The caller decides where to render; this decides whether.
 */
export function shouldShowReferralSurvey({
  flagEnabled,
  isTutorial,
  isDailyChallenge,
  alreadyAnswered,
}: ReferralSurveyGate): boolean {
  return flagEnabled && !isTutorial && !isDailyChallenge && !alreadyAnswered;
}

/** Record the answer so the prompt never returns. Never throws. */
export function markReferralSurveyAnswered(
  storage: Pick<Storage, 'setItem'>,
  answer: ReferralSurveyAnswer | 'dismissed',
): void {
  try {
    storage.setItem(REFERRAL_SURVEY_KEY, answer);
  } catch {
    /* storage unavailable — the prompt simply may reappear next session */
  }
}
