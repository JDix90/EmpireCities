import type { PlayerState } from '../../types';

/**
 * Take a player out of the game, recording who did it: the player whose attack,
 * bomb or Influence took their last territory, or null when nobody did (a
 * resignation, a rebellion). An "Eliminate X" secret mission succeeds only for
 * its holder's own kill, so every elimination goes through here.
 */
export function eliminatePlayer(player: PlayerState, by: string | null): void {
  player.is_eliminated = true;
  player.eliminated_by = by;
}
