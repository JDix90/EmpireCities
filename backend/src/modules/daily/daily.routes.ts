import type { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { authenticate } from '../../middleware/authenticate';
import { rejectGuest } from '../../middleware/rejectGuest';
import { query, queryOne } from '../../db/postgres';

const ERA_MAP_IDS: Record<string, string> = {
  ancient:      'era_ancient',
  medieval:     'era_medieval',
  discovery:    'era_discovery',
  ww2:          'era_ww2',
  coldwar:      'era_coldwar',
  modern:       'era_modern',
  acw:          'era_acw',
  risorgimento: 'era_risorgimento',
};

const PLAYER_COLORS = ['#3498db', '#e74c3c', '#2ecc71', '#f39c12'];

/**
 * Auto-create a daily challenge row for today if one does not exist yet.
 * Uses a deterministic seed from the date so all instances agree.
 */
async function ensureTodayChallenge(): Promise<{
  challenge_date: string;
  era_id: string;
  map_id: string;
  seed: number;
  player_count: number;
}> {
  const today = new Date().toISOString().slice(0, 10);
  const existing = await queryOne<{
    challenge_date: string;
    era_id: string;
    map_id: string;
    seed: number;
    player_count: number;
  }>(
    `SELECT challenge_date, era_id, map_id, seed, player_count
     FROM daily_challenges WHERE challenge_date = $1`,
    [today],
  );
  if (existing) return existing;

  // Deterministic from date: hash the date string to pick an era
  const ROTATING_ERAS = ['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern', 'acw'];
  const dateHash = today
    .replace(/-/g, '')
    .split('')
    .reduce((acc: number, c: string) => acc + c.charCodeAt(0), 0);
  const eraId = ROTATING_ERAS[dateHash % ROTATING_ERAS.length];
  const mapId = ERA_MAP_IDS[eraId] ?? 'era_ancient';
  const seed = dateHash * 31337;

  await query(
    `INSERT INTO daily_challenges (challenge_date, era_id, map_id, seed, player_count)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (challenge_date) DO NOTHING`,
    [today, eraId, mapId, seed, 4],
  );

  return { challenge_date: today, era_id: eraId, map_id: mapId, seed, player_count: 4 };
}

export async function dailyRoutes(fastify: FastifyInstance): Promise<void> {
  // ── GET /api/daily/today ─────────────────────────────────────────────────
  fastify.get('/today', { preHandler: authenticate }, async (request, reply) => {
    const challenge = await ensureTodayChallenge();

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
      [challenge.challenge_date, request.userId],
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
      [challenge.challenge_date, request.userId],
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
      [challenge.challenge_date],
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
    const challenge = await ensureTodayChallenge();

    // Block if user already completed today's challenge
    const myEntry = await queryOne<{ entry_id: string }>(
      `SELECT entry_id FROM daily_challenge_entries
       WHERE challenge_date = $1 AND user_id = $2`,
      [challenge.challenge_date, request.userId],
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
      [challenge.challenge_date, request.userId],
    );
    if (activeGame) {
      return reply.status(200).send({ game_id: activeGame.game_id });
    }

    const gameId = uuidv4();
    const settings = {
      fog_of_war: false,
      allowed_victory_conditions: ['domination'],
      victory_type: 'domination',
      turn_timer_seconds: 0,
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: false,
      daily_challenge_date: challenge.challenge_date,
      seed: challenge.seed,
      max_players: challenge.player_count,
    };

    await query(
      `INSERT INTO games (game_id, map_id, era_id, status, settings_json, game_type)
       VALUES ($1, $2, $3, 'waiting', $4, 'solo')`,
      [gameId, challenge.map_id, challenge.era_id, JSON.stringify(settings)],
    );

    // Human player at index 0
    await query(
      `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai)
       VALUES ($1, $2, 0, $3, false)`,
      [gameId, request.userId, PLAYER_COLORS[0]],
    );

    // AI opponents
    const aiCount = Math.max(1, challenge.player_count - 1);
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
