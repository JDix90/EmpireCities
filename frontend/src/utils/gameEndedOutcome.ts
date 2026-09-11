import type { GameLobbyPlayerRow } from '../types/gameLobbyApi';

export interface EndedOutcomeInput {
  /** The game's status from the lobby snapshot. Only 'completed' has a result. */
  status: string;
  /** `games.winner_id`: a user id, or null when a bot won (bot ids are not UUIDs). */
  winnerId: string | null;
  players: GameLobbyPlayerRow[];
  /** The signed-in viewer, if any. */
  viewerId: string | null;
  /** The page's own naming rule, so bots and blank usernames read the same everywhere. */
  displayName: (p: GameLobbyPlayerRow) => string;
}

/**
 * One sentence saying who won a finished match, phrased for the viewer, or
 * null when there is nothing honest to say.
 *
 * The server persists NULL for a bot's win (finalizeGame: bot ids are not
 * UUIDs), so a null winner on a completed game with bots in it means exactly
 * "a bot won" — we say so rather than guess which one. A null winner with no
 * bots on the roster should not happen; the caller's generic copy covers it.
 */
export function describeEndedOutcome(input: EndedOutcomeInput): string | null {
  if (input.status !== 'completed') return null;
  if (input.winnerId) {
    if (input.viewerId && input.winnerId === input.viewerId) return 'You won this one.';
    const winner = input.players.find((p) => p.user_id === input.winnerId);
    return winner ? `${input.displayName(winner)} won.` : null;
  }
  return input.players.some((p) => p.is_ai) ? 'An AI commander took this one.' : null;
}
