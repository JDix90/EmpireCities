import type { DiplomacyEntry, GameState } from '../../types';

/**
 * The truce in force between two players, or null. Nothing forbids attacking a
 * truce partner: any attack on one (a land attack, a blitz, a Fleet Attack, a
 * strike, a bomb, a Drop Assault, Influence) breaks the truce instead.
 */
export function activeTruceBetween(
  state: GameState,
  playerIdA: string,
  playerIdB: string | null | undefined,
): DiplomacyEntry | null {
  if (!playerIdB || playerIdA === playerIdB) return null;
  const a = state.players.find((p) => p.player_id === playerIdA);
  const b = state.players.find((p) => p.player_id === playerIdB);
  if (!a || !b) return null;
  // A state built without the diplomacy list (fixtures, older boards) holds no truces.
  const entry = (state.diplomacy ?? []).find(
    (d) =>
      (d.player_index_a === a.player_index && d.player_index_b === b.player_index) ||
      (d.player_index_a === b.player_index && d.player_index_b === a.player_index),
  );
  return entry?.status === 'truce' && entry.truce_turns_remaining > 0 ? entry : null;
}

/**
 * Break the truce between `breakerId` and `betrayedId`, if one is in force.
 * The pair goes back to neutral, and the betrayed player is owed +1 attack die
 * on their next land attack on the breaker. The caller gives the defender +1
 * defense die on the breaking attack itself, where it rolls dice. Returns
 * whether there was a truce to break.
 */
export function breakTruceBetween(state: GameState, breakerId: string, betrayedId: string | null | undefined): boolean {
  const entry = activeTruceBetween(state, breakerId, betrayedId);
  const betrayed = state.players.find((p) => p.player_id === betrayedId);
  if (!entry || !betrayed) return false;
  entry.status = 'neutral';
  entry.truce_turns_remaining = 0;
  if (!betrayed.truce_break_retaliations) betrayed.truce_break_retaliations = [];
  const owed = betrayed.truce_break_retaliations.find((r) => r.against_player_id === breakerId);
  if (owed) owed.dice_bonus += 1; // stack if somehow broken twice before use
  else betrayed.truce_break_retaliations.push({ against_player_id: breakerId, dice_bonus: 1 });
  return true;
}
