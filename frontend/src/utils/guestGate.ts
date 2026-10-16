/**
 * Copy for the guest → account gate shown when a guest reaches an action that
 * needs a real account. Pure so the wording is unit-testable and the page
 * wiring stays thin — same split as utils/signupNudge.ts.
 *
 * The gate exists because the alternative — hiding the feature from guests —
 * means they never learn it is there. signupNudge.ts already records that
 * lesson for banked gold: a guest accrues a currency no surface mentions,
 * which makes it "a concrete thing to offer rather than a dead end to hide".
 *
 * Every string here names the real stake rather than the gate. A guest row
 * carries a synthetic `<uuid>@guest.local` address and no password the player
 * knows, and both login and password reset exclude that domain — the refresh
 * cookie in this browser is the ONLY way back. "Upgrade to a full account to
 * see" describes a paywall; "there is no way back to this from another device"
 * describes what is actually true.
 */

/**
 * The one statement of the guest limitation, shared verbatim by every surface
 * that raises it: the lobby welcome banner, the game-over prompt, the
 * come-back-tomorrow streak note, the post-game nudge, and both gates below.
 *
 * It is a constant because those five surfaces had five different phrasings
 * ("this browser only", "lives in one browser", "a guest streak lives in this
 * browser only"), which is how the claim drifts and how one of them ends up
 * saying something the others do not.
 */
export const GUEST_NO_PERSIST = 'Guest accounts do not persist across sessions';

/** The paired call to action — lowercase, for link text and mid-sentence use. */
export const GUEST_KEEP_STATS_CTA = 'create an account to keep your stats';

/** Sentence-initial form of the same call to action. */
export const GUEST_KEEP_STATS_CTA_SENTENCE = 'Create an account to keep your stats';

/**
 * The same statement made accurately, under `guest_prompt_v2_enabled`. A guest
 * is kept by this browser's refresh cookie across reloads and return visits,
 * and the cleanup only removes guests who never played, so "do not persist
 * across sessions" overstates it. What a guest lacks is a way back from
 * anywhere else, which the paired call to action says.
 */
export const GUEST_SAVED_HERE = 'Your progress is saved in this browser';

/** The v2 call to action — lowercase, for link text and mid-sentence use. */
export const GUEST_KEEP_EVERYWHERE_CTA = 'an account keeps it everywhere';

/** Sentence-initial form of the v2 call to action. */
export const GUEST_KEEP_EVERYWHERE_CTA_SENTENCE = 'An account keeps it everywhere';

/**
 * Under `save_account_copy_enabled` every surface describes the two kinds of
 * account one way. A guest's progress is saved in this browser (GUEST_SAVED_HERE);
 * saving the account keeps it safe and opens what needs an identity: any device,
 * ranked and the leaderboards, friends. One button says so everywhere.
 */
export const SAVE_ACCOUNT_LABEL = 'Save your account';

/** The call to action, lowercase, for link text and mid-sentence use. */
export const SAVE_ACCOUNT_CTA = 'save your account to keep it safe and play on any device';

/** Sentence-initial form of the same call to action. */
export const SAVE_ACCOUNT_CTA_SENTENCE = 'Save your account to keep it safe and play on any device';

/** Everything a saved account adds, for a surface with room for the whole pitch. */
export const SAVED_ACCOUNT_PERKS = 'keep it safe, play on any device, compete in ranked and play with friends';

/** Added to the main prompts when saving takes just an email (email_account_save_enabled). */
export const JUST_AN_EMAIL = 'All it takes is your email.';

export interface GuestLineCopy {
  /** The statement of where a guest's progress lives. */
  statement: string;
  /** The paired call to action, lowercase. */
  cta: string;
  /** The paired call to action, sentence-initial. */
  ctaSentence: string;
}

/**
 * The guest line for one-line surfaces: v2 is `guest_prompt_v2_enabled`, and
 * `saveCopy` (`save_account_copy_enabled`) takes precedence over both.
 */
export function guestLine(v2: boolean, saveCopy = false): GuestLineCopy {
  if (saveCopy) {
    return { statement: GUEST_SAVED_HERE, cta: SAVE_ACCOUNT_CTA, ctaSentence: SAVE_ACCOUNT_CTA_SENTENCE };
  }
  return v2
    ? { statement: GUEST_SAVED_HERE, cta: GUEST_KEEP_EVERYWHERE_CTA, ctaSentence: GUEST_KEEP_EVERYWHERE_CTA_SENTENCE }
    : { statement: GUEST_NO_PERSIST, cta: GUEST_KEEP_STATS_CTA, ctaSentence: GUEST_KEEP_STATS_CTA_SENTENCE };
}

export interface GuestGateCopy {
  title: string;
  body: string;
  bullets: string[];
}

/**
 * Shown when a guest presses Start on a campaign. The server says the same
 * thing with a 403 (`rejectGuest` on POST /campaign/start) — this turns that
 * dead end into the offer, at the moment they have picked a specific campaign.
 */
export const CAMPAIGN_START_GATE: GuestGateCopy = {
  title: 'Campaigns need an account',
  body:
    `A campaign runs across many games, so it needs somewhere to live. ${GUEST_NO_PERSIST}: `
    + 'yours has no email or password to sign back in with, so another browser or '
    + `cleared site data loses it. ${GUEST_KEEP_STATS_CTA_SENTENCE} — the campaign, and everything `
    + 'you have already earned, come with you.',
  bullets: [
    'Your level, gold and unlocks carry over — the same account, upgraded in place.',
    'Pick a campaign back up on any device.',
    'Take your place on the leaderboards, where guests do not appear.',
  ],
};

/** CAMPAIGN_START_GATE under `guest_prompt_v2_enabled`: the same stake, stated accurately. */
export const CAMPAIGN_START_GATE_V2: GuestGateCopy = {
  title: CAMPAIGN_START_GATE.title,
  body:
    `A campaign runs across many games, so it needs an account. ${GUEST_SAVED_HERE}, `
    + 'on a guest account with no email or password to sign back in with, so another browser or '
    + `cleared site data cannot reach it. ${GUEST_KEEP_EVERYWHERE_CTA_SENTENCE}: the campaign, and everything `
    + 'you have already earned, come with you.',
  bullets: CAMPAIGN_START_GATE.bullets,
};

/**
 * Shown inline on /leaderboards to a guest, where their rank card would be.
 * Every leaderboard query filters `u.is_guest = false`, so a guest browsing the
 * board is structurally invisible on it and nothing else says so.
 */
export const LEADERBOARD_GUEST_NOTICE: GuestGateCopy = {
  title: 'Guests do not appear on the leaderboards',
  body:
    `You can play everything here, but a guest account is never ranked. ${GUEST_NO_PERSIST}, so `
    + `${GUEST_KEEP_STATS_CTA} and claim your place.`,
  bullets: [],
};

/** LEADERBOARD_GUEST_NOTICE under `guest_prompt_v2_enabled`. */
export const LEADERBOARD_GUEST_NOTICE_V2: GuestGateCopy = {
  title: LEADERBOARD_GUEST_NOTICE.title,
  body:
    `You can play everything here, but a guest account is never ranked. ${GUEST_SAVED_HERE}; `
    + `${GUEST_KEEP_EVERYWHERE_CTA} and puts you on the board.`,
  bullets: [],
};

/** CAMPAIGN_START_GATE under `save_account_copy_enabled`. */
export const CAMPAIGN_START_GATE_SAVE: GuestGateCopy = {
  title: 'Campaigns need a saved account',
  body:
    `A campaign runs across many games, so it needs an account that cannot be lost. ${GUEST_SAVED_HERE}; `
    + 'save your account to keep it safe and pick the campaign up on any device.',
  bullets: [
    'Everything you have earned stays yours: it is the same account, saved.',
    'Play on any device and carry on where you left off.',
    'Compete in ranked and on the leaderboards, and play with friends.',
  ],
};

/** LEADERBOARD_GUEST_NOTICE under `save_account_copy_enabled`. */
export const LEADERBOARD_GUEST_NOTICE_SAVE: GuestGateCopy = {
  title: 'Guests do not appear on the leaderboards',
  body:
    `${GUEST_SAVED_HERE}. Save your account to compete in ranked and take your place on the boards; `
    + 'everything you have earned comes with you.',
  bullets: [],
};
