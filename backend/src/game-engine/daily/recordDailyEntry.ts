import { query, queryOne } from '../../db/postgres';
import { recordServerEvent } from '../../services/analyticsEvents';

/**
 * Turns 1–2 are a free "mis-start" mulligan, matching the resign grace window
 * (`RESIGN_GRACE_TURNS` in `sockets/gameSocket.ts`): a player who bails before
 * making any meaningful move keeps their attempt. Past that, bailing counts.
 */
export const DAILY_GRACE_TURNS = 2;

/**
 * Record a LOSING daily-challenge entry when a daily game is abandoned or
 * cancelled outside the normal `finalizeGame` path.
 *
 * Why this exists: the daily "one attempt per day" rule is enforced in
 * `POST /api/daily/start`, which blocks when a `daily_challenge_entries` row
 * exists and otherwise resumes any `waiting`/`in_progress` daily game. Entries
 * were written ONLY by `finalizeGame` (a real win/loss to conclusion). The HTTP
 * `DELETE /api/games/:id/abandon` (and `/cancel`) routes set the game to a
 * terminal status WITHOUT calling `finalizeGame`, so they left the day with no
 * entry and no active game — and the next `/start` cheerfully created a fresh
 * game. That let a player retry today's (deterministic) puzzle without limit
 * and keep only their best run, defeating the shared-leaderboard guarantee.
 *
 * Recording a loss here on any past-grace abandon makes the entry row the single
 * authoritative "attempt consumed today" marker, closing that loop while
 * preserving the intended pre-first-move restart (turns 1–2, no entry written).
 *
 * Non-critical and idempotent: `ON CONFLICT DO NOTHING` means a game that later
 * (or concurrently) reaches `finalizeGame` keeps its real result, and a
 * double-abandon writes at most one row. Callers should not let a failure here
 * block the abandon itself.
 */
export async function recordDailyChallengeLoss(gameId: string, userId: string): Promise<void> {
  const gameRow = await queryOne<{ daily_challenge_date: string | null; archetype: string | null }>(
    `SELECT settings_json->>'daily_challenge_date'                    AS daily_challenge_date,
            settings_json->'daily_challenge_spec'->>'archetype'      AS archetype
       FROM games WHERE game_id = $1`,
    [gameId],
  );
  if (!gameRow?.daily_challenge_date) return; // not a daily game — nothing to record

  // Only the human participant's attempt is tracked; a spectator or unrelated
  // caller must never write an entry on someone else's behalf.
  const participant = await queryOne<{ c: number }>(
    `SELECT 1 AS c FROM game_players WHERE game_id = $1 AND user_id = $2 AND is_ai = false`,
    [gameId, userId],
  );
  if (!participant) return;

  // The latest snapshot gives the turn the game actually reached, which decides
  // whether the grace-window mulligan applies. No snapshot => the game never
  // persisted a move => treat as turn 0 (a free restart).
  const snap = await queryOne<{ turn_number: number }>(
    `SELECT turn_number FROM game_states WHERE game_id = $1
     ORDER BY turn_number DESC, saved_at DESC LIMIT 1`,
    [gameId],
  );
  const turnReached = snap?.turn_number ?? 0;
  if (turnReached <= DAILY_GRACE_TURNS) return; // pre-first-move mulligan — attempt not consumed

  const inserted = await query<{ entry_id: string }>(
    `INSERT INTO daily_challenge_entries (
       challenge_date, user_id, won, turn_count, territory_count,
       puzzle_score, objective_met, archetype, move_feedback_mistakes
     )
     VALUES ($1, $2, false, $3, NULL, 0, false, $4, NULL)
     ON CONFLICT (challenge_date, user_id) DO NOTHING
     RETURNING entry_id`,
    [gameRow.daily_challenge_date, userId, turnReached, gameRow.archetype],
  );

  if (inserted.length > 0) {
    recordServerEvent(
      'daily_challenge_settled',
      {
        game_id: gameId,
        challenge_date: gameRow.daily_challenge_date,
        won: false,
        archetype: gameRow.archetype ?? 'domination',
        puzzle_score: 0,
        via: 'abandon',
      },
      userId,
    );
  }
}
