import type { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { authenticate } from '../../middleware/authenticate';
import { query, queryOne } from '../../db/postgres';
import type { Server } from 'socket.io';
import { checkOnboardingQuests } from '../../game-engine/progression/progressionService';

const VALID_BUCKETS = ['blitz_120', 'standard_300', 'long_1200', 'async_43200', 'async_86400', 'async_259200'] as const;
type Bucket = (typeof VALID_BUCKETS)[number];

const BUCKET_SETTINGS: Record<Bucket, { turn_timer_seconds: number; label: string; async_mode?: boolean }> = {
  blitz_120:    { turn_timer_seconds: 120,    label: 'Blitz 2m' },
  standard_300: { turn_timer_seconds: 300,    label: 'Standard 5m' },
  long_1200:    { turn_timer_seconds: 1200,   label: 'Long 20m' },
  async_43200:  { turn_timer_seconds: 43200,  label: 'Async 12h',  async_mode: true },
  async_86400:  { turn_timer_seconds: 86400,  label: 'Async 24h',  async_mode: true },
  async_259200: { turn_timer_seconds: 259200, label: 'Async 3d',   async_mode: true },
};

const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#ecf0f1'];

let _io: Server | null = null;

export function setMatchmakingIo(io: Server): void {
  _io = io;
}

async function attemptMatch(eraId: string, bucket: string): Promise<void> {
  const candidates = await query<{
    id: string; user_id: string; era_id: string; bucket: string;
    mu: number; phi: number; socket_id: string | null; enqueued_at: Date;
  }>(
    `SELECT * FROM ranked_queue
     WHERE era_id = $1 AND bucket = $2
     ORDER BY enqueued_at
     LIMIT 20`,
    [eraId, bucket],
  );

  if (candidates.length < 2) return;

  for (let i = 0; i < candidates.length - 1; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      const waitMs = Date.now() - Math.min(
        new Date(a.enqueued_at).getTime(),
        new Date(b.enqueued_at).getTime(),
      );
      const waitBonus = 50 * Math.floor(waitMs / 30000);
      const threshold = 200 + Math.max(a.phi, b.phi) + waitBonus;

      if (Math.abs(a.mu - b.mu) <= threshold) {
        await createRankedGame(a, b, eraId, bucket as Bucket);
        return;
      }
    }
  }
}

async function createRankedGame(
  playerA: { user_id: string; socket_id: string | null },
  playerB: { user_id: string; socket_id: string | null },
  eraId: string,
  bucket: Bucket,
): Promise<void> {
  const gameId = uuidv4();
  const bucketCfg = BUCKET_SETTINGS[bucket];
  const settings: Record<string, unknown> = {
    fog_of_war: false,
    allowed_victory_conditions: ['domination'],
    victory_type: 'domination',
    turn_timer_seconds: bucketCfg.turn_timer_seconds,
    initial_unit_count: 3,
    card_set_escalating: true,
    diplomacy_enabled: false,
    max_players: 2,
  };
  if (bucketCfg.async_mode) {
    settings.async_mode = true;
    settings.async_turn_deadline_seconds = bucketCfg.turn_timer_seconds;
  }

  const eraMapIds: Record<string, string> = {
    ancient: 'era_ancient', medieval: 'era_medieval', discovery: 'era_discovery',
    ww2: 'era_ww2', coldwar: 'era_coldwar', modern: 'era_modern', acw: 'era_acw',
    risorgimento: 'era_risorgimento',
  };

  await query(
    `INSERT INTO games (game_id, map_id, era_id, status, settings_json, game_type, is_ranked, queue_bucket, async_mode)
     VALUES ($1, $2, $3, 'waiting', $4, 'multiplayer', true, $5, $6)`,
    [gameId, eraMapIds[eraId] ?? 'era_ancient', eraId, JSON.stringify(settings), bucket, !!bucketCfg.async_mode],
  );

  await query(
    `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai)
     VALUES ($1, $2, 0, $3, false)`,
    [gameId, playerA.user_id, COLORS[0]],
  );
  await query(
    `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai)
     VALUES ($1, $2, 1, $3, false)`,
    [gameId, playerB.user_id, COLORS[1]],
  );

  // Remove both from queue
  await query('DELETE FROM ranked_queue WHERE user_id = ANY($1)', [
    [playerA.user_id, playerB.user_id],
  ]);

  // Notify via socket
  if (_io) {
    if (playerA.socket_id) _io.to(playerA.socket_id).emit('matchmaking:found', { game_id: gameId });
    if (playerB.socket_id) _io.to(playerB.socket_id).emit('matchmaking:found', { game_id: gameId });
  }
}

export async function matchmakingRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/join', { preHandler: authenticate }, async (request, reply) => {
    const body = request.body as { era_id?: string; bucket?: string } | undefined;
    if (!body?.era_id || !body?.bucket) {
      return reply.status(400).send({ error: 'era_id and bucket are required' });
    }
    if (!VALID_BUCKETS.includes(body.bucket as Bucket)) {
      return reply.status(400).send({ error: 'Invalid bucket' });
    }

    const rating = await queryOne<{ mu: number; phi: number }>(
      `SELECT mu, phi FROM user_ratings WHERE user_id = $1 AND rating_type = 'ranked'`,
      [request.userId],
    );
    const mu = rating?.mu ?? 1500;
    const phi = rating?.phi ?? 350;

    await query(
      `INSERT INTO ranked_queue (user_id, era_id, bucket, mu, phi)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE
       SET era_id = $2, bucket = $3, mu = $4, phi = $5, enqueued_at = NOW()`,
      [request.userId, body.era_id, body.bucket, mu, phi],
    );

    await attemptMatch(body.era_id, body.bucket);
    checkOnboardingQuests(request.userId, 'ranked_join').catch(() => {});

    return reply.send({ queued: true });
  });

  fastify.delete('/leave', { preHandler: authenticate }, async (request, reply) => {
    await query('DELETE FROM ranked_queue WHERE user_id = $1', [request.userId]);
    return reply.send({ queued: false });
  });

  fastify.get('/status', { preHandler: authenticate }, async (request, reply) => {
    const row = await queryOne<{
      bucket: string; era_id: string; enqueued_at: Date;
    }>(
      'SELECT bucket, era_id, enqueued_at FROM ranked_queue WHERE user_id = $1',
      [request.userId],
    );
    if (!row) return reply.send({ queued: false });
    return reply.send({ queued: true, bucket: row.bucket, era_id: row.era_id, enqueued_at: row.enqueued_at });
  });
}

// Periodic sweep to match players whose wait time has widened the threshold
let sweepInterval: ReturnType<typeof setInterval> | null = null;

export function startMatchmakingSweep(): void {
  if (sweepInterval) return;
  sweepInterval = setInterval(async () => {
    try {
      const distinct = await query<{ era_id: string; bucket: string }>(
        'SELECT DISTINCT era_id, bucket FROM ranked_queue',
      );
      for (const { era_id, bucket } of distinct) {
        await attemptMatch(era_id, bucket);
      }
    } catch {
      // Silently fail sweep
    }
  }, 5000);
  sweepInterval.unref();
}

export function stopMatchmakingSweep(): void {
  if (sweepInterval) {
    clearInterval(sweepInterval);
    sweepInterval = null;
  }
}
