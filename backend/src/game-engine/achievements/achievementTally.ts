import type { GameState, PlayerState } from '../../types';

/**
 * Running tallies the achievements read when a game ends, kept on every game
 * like the loss reason's (state/lossTally.ts). Nothing in play reads them; the
 * skill profile reads the Blitzkrieg count after the game too
 * (services/playerValueEnhancements.ts).
 *
 * - Perfect Defense, "Win without losing a single territory after turn 3":
 *   `territories_lost_after_turn_3` counts every territory a player loses from
 *   turn 4 on, to an attack, influence, an atom bomb or rebels. It starts at 0
 *   when a game begins; a game already running when it shipped has none, and
 *   cannot show a perfect defence.
 * - Comeback King, "Win after holding the fewest territories at any point
 *   mid-game": `held_fewest_territories` is set when, at a hand-off from turn 2
 *   on, the player holds fewer territories than every other player still in.
 *
 * Both used to be read off the win-probability history, which weighs armies
 * as well as land: Perfect Defense failed a player who lost no territory but
 * fell behind on units, and Comeback King came free to the winner of any game
 * of three or more dealt evenly, its opening snapshot counting a tie for the
 * fewest.
 */

/**
 * Blitzkrieg, "Capture 10 or more territories in a single turn": a capture by
 * attack, blitz, Drop Assault landing or Influence (which the game calls a
 * capture too). The turn's count resets at every hand-off; the best turn is
 * kept.
 */
export function noteCapture(player: PlayerState): void {
  player.territories_captured_this_turn = (player.territories_captured_this_turn ?? 0) + 1;
  if (player.territories_captured_this_turn > (player.territories_captured_turn_max ?? 0)) {
    player.territories_captured_turn_max = player.territories_captured_this_turn;
  }
}

/** A territory `loserId` held has been taken, by a player or by nobody. */
export function noteTerritoryLost(state: GameState, loserId: string | null | undefined): void {
  if (!loserId || state.turn_number <= 3) return;
  const loser = state.players.find((p) => p.player_id === loserId);
  if (loser && loser.territories_lost_after_turn_3 !== undefined) loser.territories_lost_after_turn_3 += 1;
}

/** At a hand-off: mark whoever now holds strictly the fewest territories, from turn 2 on. */
export function noteFewestTerritories(state: GameState): void {
  if (state.turn_number < 2) return;
  const held = new Map(state.players.filter((p) => !p.is_eliminated).map((p) => [p.player_id, 0]));
  if (held.size < 2) return;
  for (const t of Object.values(state.territories)) {
    const n = t.owner_id ? held.get(t.owner_id) : undefined;
    if (n !== undefined) held.set(t.owner_id!, n + 1);
  }
  const [[fewestId, fewest], [, next]] = [...held.entries()].sort((a, b) => a[1] - b[1]);
  if (fewest === next) return;
  const player = state.players.find((p) => p.player_id === fewestId);
  if (player) player.held_fewest_territories = true;
}
