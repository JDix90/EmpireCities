import { query, queryOne } from '../../db/postgres';

/** The longest comment a player can send, in characters (the table checks it too). */
export const FEEDBACK_COMMENT_MAX = 1000;

export type FeedbackTopic = 'galactic_age' | 'general';
export type FeedbackSource = 'beta_panel' | 'game_over' | 'menu';
export type FeedbackRating = 'up' | 'down';
export type FeedbackCategory = 'bug' | 'idea' | 'other';

export interface FeedbackInput {
  userId: string;
  topic: FeedbackTopic;
  source: FeedbackSource;
  rating: FeedbackRating | null;
  /** What a general note is about, as the player put it. */
  category: FeedbackCategory | null;
  comment: string | null;
  gameId: string | null;
  turn: number | null;
  device: string | null;
  viewport: string | null;
  /** The page a general note was sent from, e.g. /lobby. */
  page: string | null;
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
    input.gameId, input.turn, input.device, input.viewport, input.category, input.page,
  ];
  if (input.source === 'game_over') {
    const row = await queryOne<{ feedback_id: string }>(
      `INSERT INTO game_feedback (user_id, topic, source, rating, comment, game_id, turn_number, device, viewport, category, page)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
    `INSERT INTO game_feedback (user_id, topic, source, rating, comment, game_id, turn_number, device, viewport, category, page)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING feedback_id`,
    values,
  );
  return row!.feedback_id;
}

export interface FeedbackItem {
  feedback_id: string;
  created_at: string;
  updated_at: string;
  topic: FeedbackTopic;
  source: FeedbackSource;
  rating: FeedbackRating | null;
  category: FeedbackCategory | null;
  comment: string | null;
  game_id: string | null;
  turn_number: number | null;
  device: string | null;
  viewport: string | null;
  page: string | null;
  user_id: string;
  username: string | null;
  is_guest: boolean;
}

export interface FeedbackReport {
  summary: { total: number; up: number; down: number; with_comment: number; bugs: number; ideas: number };
  items: FeedbackItem[];
}

/**
 * Admin → Feedback: the newest feedback, and its counts. `topic` null reads
 * every topic; `days` 0 reads all time. `rating` and `category` narrow the
 * list (not the counts) to one thumb or one kind of note.
 */
export async function loadFeedbackReport(opts: {
  topic: FeedbackTopic | null;
  days: number;
  rating?: FeedbackRating;
  category?: FeedbackCategory;
  limit: number;
}): Promise<FeedbackReport> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (opts.topic) {
    params.push(opts.topic);
    where.push(`f.topic = $${params.length}`);
  }
  if (opts.days > 0) {
    params.push(opts.days);
    where.push(`f.created_at >= NOW() - ($${params.length} * INTERVAL '1 day')`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const summary = await queryOne<{ total: string; up: string; down: string; with_comment: string; bugs: string; ideas: string }>(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE f.rating = 'up') AS up,
            COUNT(*) FILTER (WHERE f.rating = 'down') AS down,
            COUNT(*) FILTER (WHERE f.comment IS NOT NULL) AS with_comment,
            COUNT(*) FILTER (WHERE f.category = 'bug') AS bugs,
            COUNT(*) FILTER (WHERE f.category = 'idea') AS ideas
     FROM game_feedback f
     ${whereSql}`,
    params,
  );
  const listParams = [...params];
  const listWhere = [...where];
  if (opts.rating) {
    listParams.push(opts.rating);
    listWhere.push(`f.rating = $${listParams.length}`);
  }
  if (opts.category) {
    listParams.push(opts.category);
    listWhere.push(`f.category = $${listParams.length}`);
  }
  listParams.push(opts.limit);
  const items = await query<FeedbackItem>(
    `SELECT f.feedback_id, f.created_at, f.updated_at, f.topic, f.source, f.rating, f.category, f.comment,
            f.game_id, f.turn_number, f.device, f.viewport, f.page,
            f.user_id, u.username, COALESCE(u.is_guest, false) AS is_guest
     FROM game_feedback f
     LEFT JOIN users u ON u.user_id = f.user_id
     ${listWhere.length ? `WHERE ${listWhere.join(' AND ')}` : ''}
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
      bugs: Number(summary?.bugs ?? 0),
      ideas: Number(summary?.ideas ?? 0),
    },
    items,
  };
}
