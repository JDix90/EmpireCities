/**
 * Era-tied conquest as a client reads it: what the share asks this round and
 * next, whether the viewer may win on it yet, and who is on course to win as
 * their turn opens. Computed here from the same functions checkVictory reads
 * (victory/conquestRules.ts) and sent with the game state, so the HUD renders
 * the server's numbers instead of mirroring the rule.
 */
import type { ConquestClientStatus, GameState } from '../../types';
import { getEraIdForAdvancementIndex } from '../eraAdvancement/constants';
import { getMaxEraIndex } from '../eraAdvancement/spines';
import { getStartingPlayerIndex, handOffCrossesSeat } from '../state/gameStateManager';
import {
  conquestOpenFor,
  conquestSharePct,
  conquestTerritoriesNeeded,
  erasConquestActive,
  holdsConquestShare,
} from './conquestRules';

/**
 * The round in which seat `seatIndex`'s next turn opens: this one if the seat
 * is still to move, the next if the hand-off to it crosses the starting seat
 * (as passTurn counts rounds). For the seat now moving, its turn after this.
 */
export function roundOfNextTurn(state: GameState, seatIndex: number): number {
  const total = state.players.length;
  const start = getStartingPlayerIndex(state);
  let round = state.turn_number;
  let from = state.current_player_index;
  for (let step = 0; step < total; step++) {
    let next = (from + 1) % total;
    for (let skipped = 0; state.players[next]!.is_eliminated && skipped < total; skipped++) next = (next + 1) % total;
    if (handOffCrossesSeat(from, next, start, total)) round += 1;
    if (next === seatIndex) return round;
    from = next;
  }
  return round;
}

/** The status for `viewerId` (null for a spectator), or null in a game without era-tied conquest. */
export function buildConquestClientStatus(state: GameState, viewerId: string | null): ConquestClientStatus | null {
  if (!erasConquestActive(state)) return null;
  const sharePct = conquestSharePct(state);
  const needed = conquestTerritoriesNeeded(state);
  const basePct = conquestSharePct(state, Number.NEGATIVE_INFINITY);
  if (sharePct == null || needed == null || basePct == null) return null;

  const settings = state.settings;
  const nextPct = conquestSharePct(state, state.turn_number + 1);
  const points = settings.conquest_decay_points_per_round ?? 0;
  const fallsFrom = points > 0 && state.final_era_reached_turn != null
    ? state.final_era_reached_turn + (settings.conquest_decay_delay_rounds ?? 0) + 1
    : undefined;
  const viewer = viewerId ? state.players.find((p) => p.player_id === viewerId) : undefined;
  const claim = settings.conquest_claim_at_turn_start === true;

  // On course: holding, right now, the share that will be asked as their next
  // turn opens. Without the claim rule a holder has already won.
  const onCourse = claim && state.phase !== 'game_over'
    ? state.players
      .filter((p) => !p.is_eliminated && holdsConquestShare(state, p, roundOfNextTurn(state, p.player_index)))
      .map((p) => p.player_id)
    : [];

  return {
    share_pct: sharePct,
    needed,
    base_share_pct: basePct,
    ...(nextPct != null && nextPct < sharePct ? { next_share_pct: nextPct } : {}),
    ...(fallsFrom !== undefined && fallsFrom > state.turn_number ? { falls_from_round: fallsFrom } : {}),
    ...(settings.conquest_final_era_only === true
      ? { required_era_id: getEraIdForAdvancementIndex(state, getMaxEraIndex(state)) }
      : {}),
    open_for_viewer: viewer ? conquestOpenFor(state, viewer) : true,
    claim_at_turn_start: claim,
    on_course_ids: onCourse,
  };
}
