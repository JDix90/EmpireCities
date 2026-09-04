import type { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { authenticate } from '../../middleware/authenticate';
import { rejectGuest } from '../../middleware/rejectGuest';
import { query, queryOne, withTransaction } from '../../db/postgres';
import { ensureDailyChallengeForToday } from '../../game-engine/daily/dailyPuzzleService';
import type { DailyPuzzleSpec } from '../../game-engine/daily/dailyPuzzleTypes';
import { applyAdminSnapshotsToSettings } from '../../services/adminConfig';

const PLAYER_COLORS = ['#3498db', '#e74c3c', '#2ecc71', '#f39c12'];

/** Client-safe spec (omit deterministic dice seed). */
function toPublicSpec(
  spec: DailyPuzzleSpec,
): Omit<DailyPuzzleSpec, 'dice_queue_seed' | 'starting_board' | 'settings_overrides' | 'grants' | 'clear_board'> {
  // The dice seed stays server-side (determinism is not a spoiler, but the
  // stream is), and the authored internals are game-start inputs, not display
  // data — the client sees the board when the game begins.
  const {
    dice_queue_seed: _d,
    starting_board: _b,
    settings_overrides: _o,
    grants: _g,
    clear_board: _c,
    ...rest
  } = spec;
  return rest;
}

/** Settings keys an authored spec may never override. */
const PROTECTED_SETTINGS_KEYS = new Set([
  'daily_challenge_date',
  'daily_challenge_spec',
  'seed',
  'max_players',
]);

export function buildGameSettingsFromChallenge(row: Awaited<ReturnType<typeof ensureDailyChallengeForToday>>): Record<string, unknown> {
  const spec = row.spec;
  const common: Record<string, unknown> = {
    fog_of_war: false,
    turn_timer_seconds: 0,
    initial_unit_count: 3,
    card_set_escalating: true,
    diplomacy_enabled: false,
    daily_challenge_date: row.challenge_date,
    daily_challenge_spec: spec,
    seed: row.seed,
    max_players: row.player_count,
  };

  if (spec.archetype === 'domination') {
    return withSpecOverrides(
      {
        ...common,
        allowed_victory_conditions: ['domination'],
        victory_type: 'domination',
      },
      spec,
    );
  }

  const extra: Record<string, unknown> = {
    ...common,
    allowed_victory_conditions: [],
    victory_type: 'domination',
  };

  if (spec.archetype === 'economy_build') {
    extra.economy_enabled = true;
  }
  if (spec.archetype === 'tech_research') {
    extra.tech_trees_enabled = true;
    // Economy too, or the day cannot be played. Tech points accrue only inside
    // applyEconomyIncome, which returns early when economy is off, and the
    // starting-resource bootstrap in initializeGameState requires BOTH flags.
    // With tech alone a player begins on 0 points and earns none for the whole
    // puzzle: an authored day was winnable only because its grant covered the
    // full cost, and a generated tech day — which grants nothing — could never
    // be solved at all.
    extra.economy_enabled = true;
  }
  return withSpecOverrides(extra, spec);
}

/**
 * Authored days may layer extra settings (e.g. naval_enabled) onto the daily
 * defaults. Protected keys are dropped, and everything that survives still
 * passes the normal settings normalizer at game start — an override can only
 * reach keys the normalizer understands.
 */
function withSpecOverrides(
  settings: Record<string, unknown>,
  spec: DailyPuzzleSpec,
): Record<string, unknown> {
  if (!spec.settings_overrides) return settings;
  const merged = { ...settings };
  for (const [key, value] of Object.entries(spec.settings_overrides)) {
    if (PROTECTED_SETTINGS_KEYS.has(key)) continue;
    merged[key] = value;
  }
  return merged;
}

export async function dailyRoutes(fastify: FastifyInstance): Promise<void> {
  // ── GET /api/daily/today ─────────────────────────────────────────────────
  fastify.get('/today', { preHandler: authenticate }, async (request, reply) => {
    const row = await ensureDailyChallengeForToday();

    const challenge = {
      challenge_date: row.challenge_date,
      era_id: row.era_id,
      map_id: row.map_id,
      seed: row.seed,
      player_count: row.player_count,
      kind: row.kind,
      spec: toPublicSpec(row.spec),
    };

    // Is the user already playing or has completed today?
    const myEntry = await queryOne<{
      entry_id: string;
      won: boolean;
      puzzle_score: number | null;
      turn_count: number | null;
      territory_count: number | null;
      completed_at: string;
    }>(
      `SELECT entry_id, won, puzzle_score, turn_count, territory_count, completed_at
       FROM daily_challenge_entries
       WHERE challenge_date = $1 AND user_id = $2`,
      [row.challenge_date, request.userId],
    );

    // Check if there's an in-progress game for this user+challenge.
    // The JSONB stored value is the JSON-stringified Date (e.g.
    // '2026-05-01T06:00:00.000Z'), but `row.challenge_date` is a pg Date
    // object that Postgres coerces to a different timestamp text — so we
    // cast both sides to ::date to compare safely.
    const activeGame = await queryOne<{ game_id: string }>(
      `SELECT g.game_id
       FROM games g
       JOIN game_players gp ON gp.game_id = g.game_id
       WHERE (g.settings_json->>'daily_challenge_date')::date = $1::date
         AND gp.user_id = $2
         AND g.status IN ('waiting', 'in_progress')
       LIMIT 1`,
      [row.challenge_date, request.userId],
    );

    // Look up the user's completed game for today's challenge so the client
    // can offer a "Watch replay" link without needing a second request. Only
    // exposed when the user actually won — the replay/insights endpoints are
    // also gated to participants, but presenting a replay button for a loss
    // would conflict with the "successfully completed" framing.
    const completedGame = myEntry?.won
      ? await queryOne<{ game_id: string }>(
          `SELECT g.game_id
           FROM games g
           JOIN game_players gp ON gp.game_id = g.game_id
           WHERE (g.settings_json->>'daily_challenge_date')::date = $1::date
             AND gp.user_id = $2
             AND g.status = 'completed'
           ORDER BY g.ended_at DESC NULLS LAST
           LIMIT 1`,
          [row.challenge_date, request.userId],
        )
      : null;

    // Honest "shared event" signal: how many commanders have attempted today's
    // challenge. Real count, interesting even when small.
    const attemptsRow = await queryOne<{ attempts: string }>(
      `SELECT COUNT(*)::int AS attempts
       FROM daily_challenge_entries
       WHERE challenge_date = $1`,
      [row.challenge_date],
    );

    // Top 10 leaderboard for today
    // puzzle_score is the primary metric among winners: it is what the move
    // grading actually measures (1000 minus mistake penalties). Turn count
    // breaks ties, so domination days — where every winner scores 1000 —
    // rank exactly as before.
    const leaderboard = await query<{
      username: string;
      won: boolean;
      puzzle_score: number | null;
      turn_count: number | null;
      territory_count: number | null;
      completed_at: string;
    }>(
      `SELECT u.username, dce.won, dce.puzzle_score, dce.turn_count, dce.territory_count, dce.completed_at
       FROM daily_challenge_entries dce
       JOIN users u ON u.user_id = dce.user_id
       WHERE dce.challenge_date = $1
       ORDER BY dce.won DESC, dce.puzzle_score DESC NULLS LAST, dce.turn_count ASC NULLS LAST, dce.territory_count DESC NULLS LAST
       LIMIT 10`,
      [row.challenge_date],
    );

    return reply.send({
      challenge,
      my_entry: myEntry ?? null,
      active_game_id: activeGame?.game_id ?? null,
      completed_game_id: completedGame?.game_id ?? null,
      attempts_today: attemptsRow?.attempts ? Number(attemptsRow.attempts) : 0,
      leaderboard,
    });
  });

  // ── POST /api/daily/start ─────────────────────────────────────────────────
  fastify.post('/start', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    const row = await ensureDailyChallengeForToday();
    const userId = request.userId;

    // The "already played" and "resume active game" checks plus the game insert
    // run in ONE transaction under a per-(user, day) advisory lock. Without the
    // lock, two concurrent /start calls both read "no entry, no active game" and
    // each create a daily game — a second live attempt at the same shared puzzle.
    // The lock serializes them so the second caller sees the first's game and
    // resumes it instead. (The sequential abandon → /start retry is closed
    // separately: abandoning past the grace window records a losing entry, which
    // the "already played" check below then blocks on — see
    // game-engine/daily/recordDailyEntry.ts.)
    type StartResult =
      | { code: 'played' }
      | { code: 'resume'; gameId: string }
      | { code: 'created'; gameId: string };

    const result = await withTransaction<StartResult>(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `daily:${userId}:${row.challenge_date}`,
      ]);

      // Block if user already has an entry for today (a completed game, or a
      // past-grace abandon recorded by recordDailyChallengeLoss).
      const myEntry = await client.query<{ entry_id: string }>(
        `SELECT entry_id FROM daily_challenge_entries
         WHERE challenge_date = $1 AND user_id = $2`,
        [row.challenge_date, userId],
      );
      if (myEntry.rows.length > 0) return { code: 'played' };

      // Resume if an in-progress game exists. (See /today for why we cast.)
      const activeGame = await client.query<{ game_id: string }>(
        `SELECT g.game_id
         FROM games g
         JOIN game_players gp ON gp.game_id = g.game_id
         WHERE (g.settings_json->>'daily_challenge_date')::date = $1::date
           AND gp.user_id = $2
           AND g.status IN ('waiting', 'in_progress')
         LIMIT 1`,
        [row.challenge_date, userId],
      );
      if (activeGame.rows.length > 0) return { code: 'resume', gameId: activeGame.rows[0].game_id };

      const gameId = uuidv4();
      const settings = buildGameSettingsFromChallenge(row);

      await client.query(
        `INSERT INTO games (game_id, map_id, era_id, status, settings_json, game_type)
         VALUES ($1, $2, $3, 'waiting', $4, 'solo')`,
        [gameId, row.map_id, row.era_id, JSON.stringify(applyAdminSnapshotsToSettings(settings))],
      );

      // Human player at index 0
      await client.query(
        `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai)
         VALUES ($1, $2, 0, $3, false)`,
        [gameId, userId, PLAYER_COLORS[0]],
      );

      const aiCount = Math.max(1, row.player_count - 1);
      // Backstop for a spec that omits the field — a stored row from before the
      // generator set it. 'hard' made an unset field the hardest content in the
      // feature; the daily is a puzzle, so the default matches the calendar.
      const aiDifficulty = row.spec.ai_difficulty ?? 'medium';
      for (let i = 0; i < aiCount; i++) {
        await client.query(
          `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai, ai_difficulty)
           VALUES ($1, NULL, $2, $3, true, $4)`,
          [gameId, i + 1, PLAYER_COLORS[(i + 1) % PLAYER_COLORS.length], aiDifficulty],
        );
      }

      return { code: 'created', gameId };
    });

    if (result.code === 'played') {
      return reply.status(409).send({ error: 'You have already played today\'s challenge' });
    }
    if (result.code === 'resume') {
      return reply.status(200).send({ game_id: result.gameId });
    }
    return reply.status(201).send({ game_id: result.gameId });
  });
}
