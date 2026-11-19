/**
 * What a campaign's carried stats are worth in a stage: the one place the
 * numbers a campaign banks become dice, rounds and reinforcements.
 *
 * Each carry was a flat cap, reached after the first win (the Survivor Bonus
 * and Revolutionary Spirit opened at theirs), so five of a path's six stages
 * were played with the same bonus and winning an era changed nothing a player
 * could feel. Each is now a ladder with a rung every era or two. The tops are
 * still small: a defender rolls two dice, and a carry is an edge, not the game.
 *
 * Inputs are the stored numbers: `user_campaigns.prestige_points` for Prestige
 * and `path_carry` for the other two. Combat, reinforcement and the screens
 * (modules/campaign/campaignCarryEffects.ts) all read these functions.
 */

/** A stored carry as a count: nothing for a value that is missing, negative or not a number. */
const whole = (n: number | null | undefined): number =>
  (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);

/** The most attack dice Prestige ever adds. */
export const CAMPAIGN_PRESTIGE_DICE_MAX = 2;
/** The fewest and the most opening rounds Prestige lasts. */
export const CAMPAIGN_PRESTIGE_ROUNDS_MIN = 3;
export const CAMPAIGN_PRESTIGE_ROUNDS_MAX = 5;
/** The most defence dice the Survivor Bonus ever adds on home ground. */
export const CAMPAIGN_SURVIVOR_DICE_MAX = 3;
/** The most reinforcements a turn Revolutionary Spirit ever adds. */
export const CAMPAIGN_SPIRIT_REINFORCE_MAX = 3;

/** Attack dice from Prestige: one from the first point, two from the fifth. */
export function campaignPrestigeDice(points: number | null | undefined): number {
  const p = whole(points);
  return p === 0 ? 0 : Math.min(CAMPAIGN_PRESTIGE_DICE_MAX, Math.ceil(p / 4));
}

/** The opening rounds Prestige lasts: three, four from the fourth point, five from the eighth. */
export function campaignPrestigeRounds(points: number | null | undefined): number {
  const p = whole(points);
  if (p === 0) return 0;
  return Math.min(CAMPAIGN_PRESTIGE_ROUNDS_MAX, CAMPAIGN_PRESTIGE_ROUNDS_MIN + Math.floor(p / 4));
}

/** Defence dice on home ground from the Survivor Bonus: one, two from the fourth point, three from the eighth. */
export function campaignSurvivorDice(bonus: number | null | undefined): number {
  const s = whole(bonus);
  return s === 0 ? 0 : Math.min(CAMPAIGN_SURVIVOR_DICE_MAX, 1 + Math.floor(s / 4));
}

/** Reinforcements a turn from Revolutionary Spirit: one from the second point, two from the sixth, three from the tenth. */
export function campaignSpiritReinforcements(spirit: number | null | undefined): number {
  return Math.min(CAMPAIGN_SPIRIT_REINFORCE_MAX, Math.floor((whole(spirit) + 2) / 4));
}

/**
 * Trying again. A stage lost is played again from the same board with the
 * same carry, and a carry is never paid for losing (the paths' own rule), so a
 * player stuck on a stage had nothing to try but the same thing. Each loss of
 * a stage adds starting units to the next attempt at it, up to a ceiling; a
 * win moves on to a stage with no losses of its own.
 */
export const CAMPAIGN_RETRY_UNITS_PER_LOSS = 2;
export const CAMPAIGN_RETRY_UNITS_MAX = 6;

/** Extra starting units for an attempt at a stage already lost this many times. */
export function campaignRetryUnits(losses: number | null | undefined): number {
  return Math.min(CAMPAIGN_RETRY_UNITS_MAX, whole(losses) * CAMPAIGN_RETRY_UNITS_PER_LOSS);
}

/** How many times a campaign has lost the stage at this index, from its stored narrative. */
export function campaignStageLosses(narrative: Record<string, unknown> | null | undefined, eraIndex: number): number {
  const stored = Number(narrative?.[`era_${eraIndex}_losses`]);
  return whole(stored);
}
