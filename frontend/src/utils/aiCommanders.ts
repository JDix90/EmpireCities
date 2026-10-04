import { aiCommanderName, aiDifficultyPlaysStyle, aiPlayerName, drawAiCommanders, type AiStyle } from '@borderfall/shared';

export interface SeatCommander {
  /** The seat's name as the board will show it, "(AI)" included. */
  name: string;
  /** The style it will play; null at Easy and below, which play none. */
  style: AiStyle | null;
}

interface LobbyLike {
  game_id: string;
  settings_json: { ai_personalities?: unknown } | null;
  players: ReadonlyArray<{ player_index: number; is_ai: boolean; ai_difficulty: string | null }>;
}

/**
 * The commanders a waiting game will seat (ai_personalities_enabled, baked
 * into its settings at create): the same draw the server makes when the game
 * starts (@borderfall/shared drawAiCommanders), so the lobby shows who you
 * will face. Null for a game without commanders.
 */
export function lobbyCommanders(lobby: LobbyLike | null | undefined): Record<number, SeatCommander> | null {
  if (!lobby || lobby.settings_json?.ai_personalities !== true) return null;
  const bots = lobby.players.filter((p) => p.is_ai);
  const drawn = drawAiCommanders(lobby.game_id, bots.map((p) => p.player_index));
  const out: Record<number, SeatCommander> = {};
  for (const p of bots) {
    const c = drawn[p.player_index];
    if (!c) continue;
    out[p.player_index] = { name: aiCommanderName(c), style: aiDifficultyPlaysStyle(p.ai_difficulty) ? c.style : null };
  }
  return out;
}

/** A waiting seat's name: its commander's, or the bot name from before commanders. */
export function lobbyBotName(playerIndex: number, commanders: Record<number, SeatCommander> | null): string {
  return commanders?.[playerIndex]?.name ?? aiPlayerName(playerIndex);
}
