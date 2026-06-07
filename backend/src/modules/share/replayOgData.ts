/**
 * Shared data-loading for replay link previews (OG image + HTML meta tags).
 */
import { query, queryOne } from '../../db/postgres';
import type { ReplayOgOptions } from './ogImage';

export interface ReplayPreviewData extends ReplayOgOptions {
  gameId: string;
  isPublic: boolean;
}

/** Humanize an era id like `era_industrial` → `Industrial`. */
export function humanizeEra(eraId: string | null | undefined): string {
  if (!eraId) return 'Custom';
  return eraId
    .replace(/^era_/, '')
    .split(/[_-]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Assemble link-preview data for a completed game. Returns null when the game
 * doesn't exist or isn't completed (no preview to show).
 */
export async function buildReplayPreviewData(gameId: string): Promise<ReplayPreviewData | null> {
  const game = await queryOne<{
    status: string;
    era_id: string | null;
    winner_id: string | null;
    is_replay_public: boolean;
  }>(
    'SELECT status, era_id, winner_id, is_replay_public FROM games WHERE game_id = $1',
    [gameId],
  );
  if (!game) return null;
  if (game.status !== 'completed') return null;

  const players = await query<{ user_id: string | null; username: string | null; player_color: string | null }>(
    `SELECT gp.user_id, u.username, gp.player_color
     FROM game_players gp LEFT JOIN users u ON u.user_id = gp.user_id
     WHERE gp.game_id = $1 ORDER BY gp.player_index`,
    [gameId],
  );

  const turnRow = await queryOne<{ max_turn: number | null }>(
    'SELECT MAX(turn_number) AS max_turn FROM game_states WHERE game_id = $1',
    [gameId],
  );

  const winner = game.winner_id ? players.find((p) => p.user_id === game.winner_id) : undefined;
  const winnerName = winner?.username ?? 'Champion';
  const winnerColor = winner?.player_color ?? '#c9a84c';

  return {
    gameId,
    isPublic: game.is_replay_public,
    winnerName,
    winnerColor,
    eraLabel: humanizeEra(game.era_id),
    turnCount: turnRow?.max_turn ?? 0,
    playerCount: players.length,
    playerColors: players.map((p) => p.player_color ?? '#888888'),
  };
}

/** OG-image subset (used by the og-image.png route). */
export async function buildReplayOgOptions(gameId: string): Promise<ReplayOgOptions | null> {
  return buildReplayPreviewData(gameId);
}
