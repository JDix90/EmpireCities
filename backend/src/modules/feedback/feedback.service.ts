import { query, queryOne } from '../../db/postgres';

/** The longest comment a player can send, in characters (the table checks it too). */
export const FEEDBACK_COMMENT_MAX = 1000;

export type FeedbackTopic = 'galactic_age';
export type FeedbackSource = 'beta_panel' | 'game_over';
export type FeedbackRating = 'up' | 'down';

export interface FeedbackInput {
  userId: string;
  topic: FeedbackTopic;
  source: FeedbackSource;
  rating: FeedbackRating | null;
  comment: string | null;
  gameId: string | null;
  turn: number | null;
  device: string | null;
  viewport: string | null;
}

/**
 * Store one piece of feedback; returns its id. A game-over answer is one row
 * per player per game: the thumb is sent on the tap, and a comment added after
 * it fills in the same row rather than adding a second, without blanking a
 * rating the comment did not carry.
 */
export async function recordFeedback(input: FeedbackInput): Promise<string> {
  const values = [
    input.userId, input.topic, input.source, input.rating, input.comment,
    input.gameId, input.turn, input.device, input.viewport,
  ];
  if (input.source === 'game_over') {
    const row = await queryOne<{ feedback_id: string }>(
      `INSERT INTO game_feedback (user_id, topic, source, rating, comment, game_id, turn_number, device, viewport)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (user_id, game_id) WHERE source = 'game_over'
       DO UPDATE SET
         rating = COALESCE(EXCLUDED.rating, game_feedback.rating),
         comment = COALESCE(EXCLUDED.comment, game_feedback.comment),
         turn_number = COALESCE(EXCLUDED.turn_number, game_feedback.turn_number),
         device = COALESCE(EXCLUDED.device, game_feedback.device),
         viewport = COALESCE(EXCLUDED.viewport, game_feedback.viewport),
         updated_at = NOW()
       RETURNING feedback_id`,
      values,
    );
    return row!.feedback_id;
  }
  const row = await queryOne<{ feedback_id: string }>(
    `INSERT INTO game_feedback (user_id, topic, source, rating, comment, game_id, turn_number, device, viewport)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING feedback_id`,
    values,
  );
  return row!.feedback_id;
}

export interface FeedbackItem {
  feedback_id: string;
  created_at: string;
  updated_at: string;
  source: FeedbackSource;
  rating: FeedbackRating | null;
  comment: string | null;
  game_id: string | null;
  turn_number: number | null;
  device: string | null;
  viewport: string | null;
  user_id: string;
  username: string | null;
  is_guest: boolean;
}

export interface FeedbackReport {
  summary: { total: number; up: number; down: number; with_comment: number };
  items: FeedbackItem[];
}

/**
 * Admin → Feedback: the newest feedback on a topic, and its counts. `days` 0
 * reads all time; `rating` narrows the list (not the counts) to one thumb.
 */
export async function loadFeedbackReport(opts: {
  topic: FeedbackTopic;
  days: number;
  rating?: FeedbackRating;
  limit: number;
}): Promise<FeedbackReport> {
  const since = opts.days > 0 ? `AND f.created_at >= NOW() - ($2 * INTERVAL '1 day')` : '';
  const params: unknown[] = [opts.topic];
  if (opts.days > 0) params.push(opts.days);
  const summary = await queryOne<{ total: string; up: string; down: string; with_comment: string }>(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE f.rating = 'up') AS up,
            COUNT(*) FILTER (WHERE f.rating = 'down') AS down,
            COUNT(*) FILTER (WHERE f.comment IS NOT NULL) AS with_comment
     FROM game_feedback f
     WHERE f.topic = $1 ${since}`,
    params,
  );
  const listParams = [...params];
  let ratingClause = '';
  if (opts.rating) {
    listParams.push(opts.rating);
    ratingClause = `AND f.rating = $${listParams.length}`;
  }
  listParams.push(opts.limit);
  const items = await query<FeedbackItem>(
    `SELECT f.feedback_id, f.created_at, f.updated_at, f.source, f.rating, f.comment,
            f.game_id, f.turn_number, f.device, f.viewport,
            f.user_id, u.username, COALESCE(u.is_guest, false) AS is_guest
     FROM game_feedback f
     LEFT JOIN users u ON u.user_id = f.user_id
     WHERE f.topic = $1 ${since} ${ratingClause}
     ORDER BY f.created_at DESC
     LIMIT $${listParams.length}`,
    listParams,
  );
  return {
    summary: {
      total: Number(summary?.total ?? 0),
      up: Number(summary?.up ?? 0),
      down: Number(summary?.down ?? 0),
      with_comment: Number(summary?.with_comment ?? 0),
    },
    items,
  };
}
