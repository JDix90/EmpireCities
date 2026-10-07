/**
 * The Custom Game form's round limit (custom_round_cap_enabled). A game that
 * reaches the end of its last round goes to whoever holds the most territory
 * (the server's `max_turns`). Without one, a Domination game against bots
 * seldom ends: in the arena, four Medium bots finished one game in five
 * inside 400 rounds.
 */
import { QUICK_MATCH_VICTORY_PLANS } from './quickMatchPrefs';

/** The limit the host chose: the ending's own, a number of rounds, or none. */
export type CustomRoundLimit = 'auto' | 'none' | number;

/** The limits a host can pick besides the ending's own and none. */
export const CUSTOM_ROUND_LIMIT_CHOICES = [45, 60, 90, 120, 150] as const;

/**
 * The limit Quick Match gives an ending (utils/quickMatchPrefs.ts), for the
 * conditions the host ticked: the shortest of theirs, since the first one met
 * ends the game. Half the board or less is Quick Match's 50% ending, up to
 * 65% its 65% ending, and a larger share, like Capitals or a secret mission,
 * gets 90.
 */
export function autoRoundLimit(conditions: readonly string[], thresholdPct: number): number {
  const plans = QUICK_MATCH_VICTORY_PLANS;
  const limits = conditions.map((condition) => {
    switch (condition) {
      case 'threshold':
        if (thresholdPct <= 50) return plans.blitz.max_turns;
        if (thresholdPct <= 65) return plans.majority.max_turns;
        return plans.capitals.max_turns;
      case 'capital':
      case 'secret_mission':
        return plans.capitals.max_turns;
      default:
        return plans.conquest.max_turns;
    }
  });
  return limits.length > 0 ? Math.min(...limits) : plans.conquest.max_turns;
}

/** The `max_turns` the form sends for the host's choice, or nothing for no limit. */
export function customRoundLimitTurns(
  choice: CustomRoundLimit,
  conditions: readonly string[],
  thresholdPct: number,
): number | undefined {
  if (choice === 'none') return undefined;
  if (choice === 'auto') return autoRoundLimit(conditions, thresholdPct);
  return choice;
}
