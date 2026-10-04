import type { GameState } from '../../types';
import { eliminatePlayer } from './elimination';
import { syncTerritoryCounts } from './gameStateManager';

/**
 * A seat leaves the game by resigning: it is eliminated by nobody, and its
 * territories turn neutral at half strength (at least one unit), so its land
 * is taken back piece by piece rather than handed to anyone. A player's
 * `game:resign` and a beaten bot (ai/aiResign.ts) go through this same step;
 * what follows it (the announcement, the game's end, the hand-off) stays with
 * the caller.
 */
export function resignSeat(state: GameState, playerId: string): void {
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return;
  eliminatePlayer(player, null);
  player.has_resigned = true;
  for (const t of Object.values(state.territories)) {
    if (t.owner_id === playerId) {
      t.owner_id = null;
      t.unit_count = Math.max(1, Math.floor(t.unit_count / 2));
    }
  }
  syncTerritoryCounts(state);
}
