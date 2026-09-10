/**
 * The Moon Race lobby toggle (docs/space-age-moon/README.md §10.2) — the two
 * decisions the create form has to get right, kept out of the page so they can
 * be asserted directly.
 *
 * The toggle stands for a whole five-phase package. Which phases it turns on is
 * the server's call; the lobby only decides whether to OFFER it and what to
 * send.
 */

/** The Space Age era id — the only era with a Moon to race for. */
const SPACE_AGE_ERA_ID = 'space_age';

/**
 * Whether to show the toggle at all: a Space Age create, and an operator who
 * ships at least one phase. `moonRaceFlagEnabled` is one derived client flag
 * standing for all five, so the lobby never has to know which are live.
 */
export function moonRaceApplicable(era: string, moonRaceFlagEnabled: boolean): boolean {
  return era === SPACE_AGE_ERA_ID && moonRaceFlagEnabled;
}

/**
 * What the create request carries.
 *
 * An EXPLICIT boolean while the toggle is on screen. The server reads an absent
 * value as "whatever the operator ships" — which is what keeps Quick Match and
 * older clients working, and is exactly why an untick must not be sent as
 * `undefined`: it would be read as consent and the game would run the package
 * the player just declined. (The same trap `combat_dice_cap_enabled` carries a
 * warning about in LobbyPage.) Off the Space Age, or with every phase dark,
 * there is nothing to say and the field is omitted.
 */
export function moonRaceCreateValue(
  applicable: boolean,
  checked: boolean,
): boolean | undefined {
  return applicable ? checked : undefined;
}
