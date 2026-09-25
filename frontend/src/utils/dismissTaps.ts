/**
 * Dismiss-tap telemetry for the phone overlay budget (docs/MOBILE_UX_PLAN.md
 * M-12, phase 2).
 *
 * The budget's promise is that on a phone nothing outside tier 1 needs a tap
 * to go away. This is how that promise is measured: every tap that closes
 * something the game put on screen is counted against the tier of the thing
 * it closed, and the tally goes out once per round through
 * `POST /api/analytics/ui-event` as `turn_dismiss_taps`. A round runs from
 * the start of the viewer's turn to the start of their next one, so it covers
 * both what they sat through and what they did. The target is zero in tiers 2
 * and 3.
 *
 * Tiers follow R11: tier 1 must be acknowledged (game over, elimination, a
 * lost capital, the resign confirm, an era advance), tier 2 needs a decision
 * (the player's own attack result, with Attack again / Blitz), tier 3 is
 * glanceable and should not have needed a tap at all. The two summaries are
 * the one place this parts from `isCriticalModal`: that predicate shields
 * them from "Skip all" because they are the turn's only record, but to the
 * budget they are recaps, so they count as tier 3 here.
 */
import type { ModalData } from '../components/game/ActionModal';

export type DismissTier = 1 | 2 | 3;

export interface DismissTally {
  tier1: number;
  tier2: number;
  tier3: number;
}

/** The ui-event name; allowlisted in backend/src/modules/analytics/analytics.routes.ts. */
export const DISMISS_TAPS_EVENT = 'turn_dismiss_taps';

export function emptyTally(): DismissTally {
  return { tier1: 0, tier2: 0, tier3: 0 };
}

/** The tier a modal belongs to, for the tap that closes it. */
export function dismissTierOf(modal: ModalData): DismissTier {
  switch (modal.type) {
    case 'game_over':
    case 'elimination':
    case 'resign_confirm':
    case 'era_advance':
      return 1;
    case 'combat':
      return modal.result.capitalLost ? 1 : 2;
    case 'turn_summary':
    case 'draft_summary':
      return 3;
  }
}

/** Adds one tap to the tier, in place; returns the tally for chaining. */
export function countTap(tally: DismissTally, tier: DismissTier): DismissTally {
  tally[`tier${tier}`] += 1;
  return tally;
}

/** The event's properties. The endpoint takes strings only, so numbers are stringified. */
export function tallyProperties(
  tally: DismissTally,
  ctx: { turn: number; era: string | null | undefined; isTutorial: boolean },
): Record<string, string> {
  return {
    layout: 'phone',
    turn: String(ctx.turn),
    tier1: String(tally.tier1),
    tier2: String(tally.tier2),
    tier3: String(tally.tier3),
    era: String(ctx.era ?? ''),
    is_tutorial: String(ctx.isTutorial),
  };
}
