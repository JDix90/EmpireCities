import type { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { authenticate } from '../../middleware/authenticate';
import { rejectGuest } from '../../middleware/rejectGuest';
import { query, queryOne } from '../../db/postgres';
import { ensureDailyChallengeForToday } from '../../game-engine/daily/dailyPuzzleService';
import type { DailyPuzzleSpec } from '../../game-engine/daily/dailyPuzzleTypes';
import { applyAdminSnapshotsToSettings } from '../../services/adminConfig';

const PLAYER_COLORS = ['#3498db', '#e74c3c', '#2ecc71', '#f39c12'];

/** Client-safe spec (omit deterministic dice seed). */
function toPublicSpec(spec: DailyPuzzleSpec): Omit<DailyPuzzleSpec, 'dice_queue_seed'> {
  const { dice_queue_seed: _d, ...rest } = spec;
  return rest;
}

function buildGameSettingsFromChallenge(row: Awaited<ReturnType<typeof ensureDailyChallengeForToday>>): Record<string, unknown> {
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
    return {
      ...common,
      allowed_victory_conditions: ['domination'],
      victory_type: 'domination',
    };
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
  }
  return extra;
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
      turn_count: number | null;
      territory_count: number | null;
      completed_at: string;
    }>(
      `SELECT entry_id, won, turn_count, territory_count, completed_at
       FROM daily_challenge_entries
       WHERE challenge_date = $1 AND user_id = $2`,
      [row.challenge_date, request.userId],
    );

    // Check if there's an in-progress game for this user+challenge
    const activeGame = await queryOne<{ game_id: string }>(
      `SELECT g.game_id
       FROM games g
       JOIN game_players gp ON gp.game_id = g.game_id
       WHERE g.settings_json->>'daily_challenge_date' = $1
         AND gp.user_id = $2
         AND g.status IN ('waiting', 'in_progress')
       LIMIT 1`,
      [row.challenge_date, request.userId],
    );

    // Top 10 leaderboard for today
    const leaderboard = await query<{
      username: string;
      won: boolean;
      turn_count: number | null;
      territory_count: number | null;
      completed_at: string;
    }>(
      `SELECT u.username, dce.won, dce.turn_count, dce.territory_count, dce.completed_at
       FROM daily_challenge_entries dce
       JOIN users u ON u.user_id = dce.user_id
       WHERE dce.challenge_date = $1
       ORDER BY dce.won DESC, dce.turn_count ASC NULLS LAST, dce.territory_count DESC NULLS LAST
       LIMIT 10`,
      [row.challenge_date],
    );

    return reply.send({
      challenge,
      my_entry: myEntry ?? null,
      active_game_id: activeGame?.game_id ?? null,
      leaderboard,
    });
  });

  // ── POST /api/daily/start ─────────────────────────────────────────────────
  fastify.post('/start', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    const row = await ensureDailyChallengeForToday();

    // Block if user already completed today's challenge
    const myEntry = await queryOne<{ entry_id: string }>(
      `SELECT entry_id FROM daily_challenge_entries
       WHERE challenge_date = $1 AND user_id = $2`,
      [row.challenge_date, request.userId],
    );
    if (myEntry) {
      return reply.status(409).send({ error: 'You have already played today\'s challenge' });
    }

    // Resume if an in-progress game exists
    const activeGame = await queryOne<{ game_id: string }>(
      `SELECT g.game_id
       FROM games g
       JOIN game_players gp ON gp.game_id = g.game_id
       WHERE g.settings_json->>'daily_challenge_date' = $1
         AND gp.user_id = $2
         AND g.status IN ('waiting', 'in_progress')
       LIMIT 1`,
      [row.challenge_date, request.userId],
    );
    if (activeGame) {
      return reply.status(200).send({ game_id: activeGame.game_id });
    }

    const gameId = uuidv4();
    const settings = buildGameSettingsFromChallenge(row);

    await query(
      `INSERT INTO games (game_id, map_id, era_id, status, settings_json, game_type)
       VALUES ($1, $2, $3, 'waiting', $4, 'solo')`,
      [gameId, row.map_id, row.era_id, JSON.stringify(applyAdminSnapshotsToSettings(settings))],
    );

    // Human player at index 0
    await query(
      `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai)
       VALUES ($1, $2, 0, $3, false)`,
      [gameId, request.userId, PLAYER_COLORS[0]],
    );

    const aiCount = Math.max(1, row.player_count - 1);
    for (let i = 0; i < aiCount; i++) {
      await query(
        `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai, ai_difficulty)
         VALUES ($1, NULL, $2, $3, true, 'hard')`,
        [gameId, i + 1, PLAYER_COLORS[(i + 1) % PLAYER_COLORS.length]],
      );
    }

    return reply.status(201).send({ game_id: gameId });
  });
}
