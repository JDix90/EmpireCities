import type { EventEffectResult, GameState, PlayerState, RoundLoss } from '../../types';
import { findRedeemableCardIds } from './gameStateManager';

/**
 * Running tallies the defeat screen reads to say why a player lost
 * (`loss_reason_enabled`, frontend utils/lossReason.ts): units lost to event
 * cards, turns that began with a tradeable card set and ended without trading
 * it, and the round the player's territory count fell furthest in. They are
 * counters only, kept on every game; nothing in play reads them.
 */

/** Credit each unit an event card removed to the territory's owner (events never change owners). */
export function noteEventLosses(state: GameState, result: EventEffectResult): void {
  for (const { territory_id, delta } of result.affected_territories ?? []) {
    if (delta >= 0) continue;
    const ownerId = state.territories[territory_id]?.owner_id;
    const owner = ownerId ? state.players.find((p) => p.player_id === ownerId) : undefined;
    if (owner) owner.units_lost_to_events = (owner.units_lost_to_events ?? 0) + -delta;
  }
}

/** As a player's turn begins: remember whether they hold a set they could trade. */
export function noteTurnStart(player: PlayerState): void {
  player.set_in_hand_at_turn_start = findRedeemableCardIds(player.cards ?? [])
    ? (player.cards_redeemed_count ?? 0)
    : undefined;
}

/**
 * As a player's turn ends: count it if it began with a tradeable set and no
 * set was traded. A set completed by this turn's own card is not counted,
 * because it could not have been traded yet.
 */
export function noteTurnEnd(player: PlayerState): void {
  const startCount = player.set_in_hand_at_turn_start;
  player.set_in_hand_at_turn_start = undefined;
  if (startCount === undefined || player.is_eliminated) return;
  if ((player.cards_redeemed_count ?? 0) === startCount) {
    player.turns_ended_with_set = (player.turns_ended_with_set ?? 0) + 1;
  }
}

/** The round's fall in territories, when it is the player's worst so far. */
function worse(current: RoundLoss | undefined, turn: number, from: number, to: number): RoundLoss | undefined {
  if (to >= from) return current;
  if (current && current.from - current.to >= from - to) return current;
  return { turn, from, to };
}

/**
 * As a round ends (before `turn_number` advances): measure each player's fall
 * in territories over it. The first round has no starting count, so it is
 * only measured from the second round on.
 */
export function noteRoundEnd(state: GameState): void {
  for (const p of state.players) {
    const from = p.round_start_territory_count;
    if (from !== undefined) p.worst_round_loss = worse(p.worst_round_loss, state.turn_number, from, p.territory_count);
    p.round_start_territory_count = p.territory_count;
  }
}

/** The player's worst round, counting the round the game ended in. */
export function worstRoundLoss(state: GameState, player: PlayerState): RoundLoss | null {
  const from = player.round_start_territory_count;
  const current = from === undefined
    ? player.worst_round_loss
    : worse(player.worst_round_loss, state.turn_number, from, player.territory_count);
  return current ?? null;
}
