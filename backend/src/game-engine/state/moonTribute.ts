/**
 * Tribute — the Space Age Moon Race's knob (§8), NOT one of its phases.
 *
 * A player holding six or more of the nine lunar tiles levies one tech point
 * per turn from every player holding none, transferred at the payer's own
 * income tick.
 *
 * This is the package's principle 3 — *cost the abstainers* — in its most
 * direct form, and it is deliberately a knob rather than a default because it
 * is also the most resented mechanic in the design: a player who chose an Earth
 * strategy is being taxed for a choice the rules allowed them to make. §8 makes
 * shipping it conditional on evidence that the table has learned to LET one
 * player have the Moon (games with two or more players on the Moon falling
 * below the Phase 1 number). If that never happens, this never ships, and the
 * code sits here dark and measurable rather than being argued about.
 *
 * It stays a separate flag from `space_age_moon_race_enabled` for that reason.
 * The five phases collapsed into one switch because they are one feature and a
 * subset is a broken game; Tribute is the opposite — an optional extra whose
 * own gate may never open.
 */

import type { GameState } from '../../types';
import { isLunarTerritory, lunarTerritoriesOwnedBy } from './helium3';

/**
 * Lunar tiles that make a player the tithe-holder. SIX of nine: enough that it
 * means near-total control and cannot be reached by two players at once (so
 * there is always at most one levier), but short of the nine the Hegemony
 * needs, so Tribute bites before the clock does rather than being a second
 * reward for the same board state.
 */
export const TRIBUTE_MIN_MOON_TILES = 6;

/** Tech points moved per payer per turn. */
export const TRIBUTE_TECH_POINTS = 1;

/**
 * Whether Tribute is live. Requires tech trees: the levy is denominated in tech
 * points, so with the tree off it would move a resource neither side can spend
 * — noise dressed up as a mechanic.
 */
export function isMoonTributeEnabled(state: GameState): boolean {
  return state?.settings?.space_age_moon_tribute_enabled === true
    && state?.settings?.tech_trees_enabled === true;
}

/**
 * The player entitled to levy, or null. At most one can ever qualify: six of
 * nine tiles leaves three, and `TRIBUTE_MIN_MOON_TILES` is deliberately over
 * half for exactly that reason.
 */
export function moonTributeLevier(state: GameState): string | null {
  if (!isMoonTributeEnabled(state)) return null;
  const counts = new Map<string, number>();
  for (const t of Object.values(state.territories ?? {})) {
    if (!isLunarTerritory(t) || !t.owner_id) continue;
    counts.set(t.owner_id, (counts.get(t.owner_id) ?? 0) + 1);
  }
  for (const [ownerId, n] of counts) {
    if (n >= TRIBUTE_MIN_MOON_TILES) return ownerId;
  }
  return null;
}

/**
 * Levy the tithe from one player at their income tick. Returns what actually
 * moved, which is what the caller reports — a payer with no tech points banked
 * pays what they have and no more, because a levy that can push a player
 * negative is a debt mechanic and this is not one.
 *
 * Only a player holding NO lunar ground pays: one tile is enough to opt out,
 * which is the point. The levy is meant to price abstention, not to punish a
 * player who tried and was pushed off.
 */
export function applyMoonTribute(state: GameState, payerId: string): number {
  const levierId = moonTributeLevier(state);
  if (!levierId || levierId === payerId) return 0;
  if (lunarTerritoriesOwnedBy(state, payerId).length > 0) return 0;

  const payer = state.players.find((p) => p.player_id === payerId);
  const levier = state.players.find((p) => p.player_id === levierId);
  if (!payer || !levier || payer.is_eliminated || levier.is_eliminated) return 0;

  const moved = Math.min(TRIBUTE_TECH_POINTS, payer.tech_points ?? 0);
  if (moved <= 0) {
    // Still clear last turn's figure, or the HUD keeps showing a levy that is
    // no longer being paid.
    payer.tribute_paid_this_turn = 0;
    return 0;
  }

  payer.tech_points = (payer.tech_points ?? 0) - moved;
  levier.tech_points = (levier.tech_points ?? 0) + moved;
  payer.tribute_paid_this_turn = moved;
  levier.tribute_received_this_turn = (levier.tribute_received_this_turn ?? 0) + moved;
  return moved;
}

/**
 * Reset the levier's running total at the top of their own turn, so the figure
 * the HUD shows is "collected since my last turn" rather than a number that
 * only ever grows. Paid-side figures are per-tick and set in place above.
 */
export function clearTributeReceived(state: GameState, playerId: string): void {
  const player = state.players.find((p) => p.player_id === playerId);
  if (player) player.tribute_received_this_turn = 0;
}
