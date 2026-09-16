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
