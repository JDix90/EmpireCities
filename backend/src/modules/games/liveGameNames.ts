import { aiCommanderName, aiPlayerName, drawAiCommanders } from '@borderfall/shared';

interface LivePlayer {
  username: string | null;
  player_index: number;
  is_ai: boolean;
}

/**
 * The live games list's seat names: a bot by its persona name (the same
 * source as the in-game roster), or by the commander its game drew when it
 * was made with bot commanders (ai_personalities_enabled); a player with no
 * name as "Player". Rewrites `players` in place.
 */
export function nameLiveGameSeats(gameId: string, aiPersonalities: boolean | null | undefined, players: LivePlayer[]): void {
  const commanders = aiPersonalities
    ? drawAiCommanders(gameId, players.filter((pl) => pl.is_ai).map((pl) => pl.player_index))
    : null;
  for (const pl of players) {
    if (pl.is_ai) {
      const c = commanders?.[pl.player_index];
      pl.username = c ? aiCommanderName(c) : aiPlayerName(pl.player_index);
    } else if (!pl.username) pl.username = 'Player';
  }
}
