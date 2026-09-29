/**
 * Client-side gating for the "Blitz until captured" affordance
 * (game:attack_blitz). The server enforces every one of these; this exists so
 * the UI never offers a button whose only outcome is an error toast.
 *
 * Deliberately narrower than a single attack:
 * - never across a sea lane (the crossing pays fleets/bombardment per attack);
 * - never in a daily challenge (each attack is graded as its own move).
 *
 * A truce is no bar: a blitz on a truce partner breaks the truce, confirmed
 * first exactly as a single attack is.
 */
export function canOfferBlitz(opts: {
  flagEnabled: boolean;
  connectionType?: string;
  isDailyChallenge: boolean;
}): boolean {
  if (!opts.flagEnabled) return false;
  if (opts.connectionType === 'sea') return false;
  if (opts.isDailyChallenge) return false;
  return true;
}
