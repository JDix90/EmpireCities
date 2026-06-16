import type { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { rejectGuest } from '../../middleware/rejectGuest';
import { query, queryOne, withTransaction } from '../../db/postgres';
import type { Server } from 'socket.io';
import { checkOnboardingQuests } from '../../game-engine/progression/progressionService';
import { featureFlags } from '../../config/featureFlags';
import { applyAdminSnapshotsToSettings, getMatchmakingConfig } from '../../services/adminConfig';
import { formatZodError } from '../../utils/formatZodError';

const VALID_BUCKETS = ['blitz_120', 'standard_300', 'long_1200', 'async_43200', 'async_86400', 'async_259200'] as const;
type Bucket = (typeof VALID_BUCKETS)[number];

const VALID_ERA_IDS = ['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern', 'acw', 'risorgimento'] as const;

const JoinSchema = z.object({
  era_id: z.enum(VALID_ERA_IDS),
  bucket: z.enum(VALID_BUCKETS),
});

function getBucketSettings(): Record<Bucket, { turn_timer_seconds: number; label: string; async_mode?: boolean }> {
  return getMatchmakingConfig().buckets as Record<Bucket, { turn_timer_seconds: number; label: string; async_mode?: boolean }>;
}

const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#ecf0f1'];

let _io: Server | null = null;
let matchmakingPaused = false;

type IntegrityTier = 'low' | 'medium' | 'high';

function tierFromSmurfRisk(score: number): IntegrityTier {
  if (score >= 0.75) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}

function estimateSmurfRisk(params: {
  mu: number;
  phi: number;
  level: number;
  xp: number;
  placementMatchesPlayed: number;
  rankedGamesPlayed: number;
}): number {
  const { mu, phi, level, xp, placementMatchesPlayed, rankedGamesPlayed } = params;
  const highSkillEarly = mu >= 1750 ? 0.45 : mu >= 1650 ? 0.3 : 0;
  const lowUncertaintyEarly = phi <= 90 ? 0.2 : phi <= 120 ? 0.1 : 0;
  const lowProgression = level <= 4 && xp < 2000 ? 0.2 : level <= 7 && xp < 6000 ? 0.1 : 0;
  const lowVolume = placementMatchesPlayed <= 4 && rankedGamesPlayed <= 6 ? 0.2 : placementMatchesPlayed <= 8 ? 0.1 : 0;
  return Math.max(0, Math.min(1, highSkillEarly + lowUncertaintyEarly + lowProgression + lowVolume));
}

function shouldPairByIntegrity(
  a: { smurf_risk_score: number; stall_penalties: number },
  b: { smurf_risk_score: number; stall_penalties: number },
  waitMs: number,
): boolean {
  const aTier = tierFromSmurfRisk(a.smurf_risk_score);
  const bTier = tierFromSmurfRisk(b.smurf_risk_score);
  const waitSeconds = waitMs / 1000;
  const stallDiff = Math.abs(a.stall_penalties - b.stall_penalties);

  // Keep high-risk suspected smurfs separated from low-risk players unless queue times are long.
  if ((aTier === 'high' && bTier === 'low') || (aTier === 'low' && bTier === 'high')) {
    return waitSeconds >= 120;
  }
  // Pair medium/high tier together earlier, but still avoid instant pairing with low-risk.
  if ((aTier !== bTier) && (aTier === 'medium' || bTier === 'medium')) {
    return waitSeconds >= 45;
  }

  // Anti-stall: avoid matching heavily penalized stallers with clean players too quickly.
  if (stallDiff >= 3) return waitSeconds >= 150;
  if (stallDiff >= 2) return waitSeconds >= 90;
  return true;
}

export function setMatchmakingIo(io: Server): void {
  _io = io;
}

interface QueueCandidate {
  id: string;
  user_id: string;
  era_id: string;
  bucket: string;
  mu: number;
  phi: number;
  socket_id: string | null;
  enqueued_at: Date;
  smurf_risk_score: number;
  stall_penalties: number;
}

/**
 * Scan the ranked queue for a matchable pair and create the game atomically.
 *
 * Concurrency model: both the per-join call and the periodic sweep can run
 * this function simultaneously. Without transactional isolation, two sweeps
 * could SELECT overlapping candidate sets and each pair the same user into a
 * different game, producing two ranked games where one player is in both.
 *
 * Fix: wrap the entire read-pair-delete-insert flow in a single transaction
 * and use `FOR UPDATE SKIP LOCKED` on the candidate SELECT. Rows locked by a
 * parallel matcher are skipped rather than queued for, so concurrent sweeps
 * simply work on disjoint candidate sets. If creation of the game fails, the
 * queue DELETEs roll back and players remain queued for the next attempt.
 */
async function attemptMatch(eraId: string, bucket: string): Promise<void> {
  const match = await withTransaction(async (client) => {
    const { rows: candidates } = await client.query<QueueCandidate>(
      `SELECT q.*,
              COALESCE(rpp.smurf_risk_score, 0) AS smurf_risk_score,
              COALESCE(rpp.stall_penalties, 0) AS stall_penalties
       FROM ranked_queue q
       LEFT JOIN ranked_placement_progress rpp ON rpp.user_id = q.user_id
       WHERE q.era_id = $1 AND q.bucket = $2
       ORDER BY enqueued_at
       LIMIT 20
       FOR UPDATE SKIP LOCKED`,
      [eraId, bucket],
    );

    if (candidates.length < 2) return null;

    // O(n^2) pair search is fine at LIMIT 20.
    for (let i = 0; i < candidates.length - 1; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i];
        const b = candidates[j];
        const waitMs = Date.now() - Math.min(
          new Date(a.enqueued_at).getTime(),
          new Date(b.enqueued_at).getTime(),
        );
        const mmCfg = getMatchmakingConfig();
        const waitBonus = mmCfg.threshold_wait_bonus_per_30s * Math.floor(waitMs / 30000);
        const threshold = mmCfg.threshold_base + Math.max(a.phi, b.phi) + waitBonus;
        const integrityOk = shouldPairByIntegrity(a, b, waitMs);

        if (Math.abs(a.mu - b.mu) <= threshold && integrityOk) {
          const gameId = await createRankedGameTx(client, a, b, eraId, bucket as Bucket);
          return { gameId, a, b };
        }
      }
    }
    return null;
  });

  if (!match || !_io) return;
  if (match.a.socket_id) _io.to(match.a.socket_id).emit('matchmaking:found', { game_id: match.gameId });
  if (match.b.socket_id) _io.to(match.b.socket_id).emit('matchmaking:found', { game_id: match.gameId });
}

async function createRankedGameTx(
  client: import('pg').PoolClient,
  playerA: QueueCandidate,
  playerB: QueueCandidate,
  eraId: string,
  bucket: Bucket,
): Promise<string> {
  const gameId = uuidv4();
  const bucketCfg = getBucketSettings()[bucket];
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
  // Ranked Era Advancement: opt-in via flag (default OFF — product decision).
  // Only ancient-start buckets are eligible, since the spine begins in Ancient.
  if (featureFlags.rankedEraAdvancementEnabled && eraId === 'ancient') {
    settings.era_advancement_enabled = true;
    settings.era_advancement_preset = 'standard';
    settings.economy_enabled = true;
    settings.tech_trees_enabled = true;
    settings.stability_enabled = true;
  }

  const eraMapIds: Record<string, string> = {
    ancient: 'era_ancient', medieval: 'era_medieval', discovery: 'era_discovery',
    ww2: 'era_ww2', coldwar: 'era_coldwar', modern: 'era_modern', acw: 'era_acw',
    risorgimento: 'era_risorgimento',
  };

  await client.query(
    `INSERT INTO games (game_id, map_id, era_id, status, settings_json, game_type, is_ranked, queue_bucket, async_mode)
     VALUES ($1, $2, $3, 'waiting', $4, 'multiplayer', true, $5, $6)`,
    [gameId, eraMapIds[eraId] ?? 'era_ancient', eraId, JSON.stringify(applyAdminSnapshotsToSettings(settings)), bucket, !!bucketCfg.async_mode],
  );

  await client.query(
    `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai)
     VALUES ($1, $2, 0, $3, false)`,
    [gameId, playerA.user_id, COLORS[0]],
  );
  await client.query(
    `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai)
     VALUES ($1, $2, 1, $3, false)`,
    [gameId, playerB.user_id, COLORS[1]],
  );

  await client.query('DELETE FROM ranked_queue WHERE user_id = ANY($1)', [
    [playerA.user_id, playerB.user_id],
  ]);

  return gameId;
}

export async function matchmakingRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/join', { preHandler: [authenticate, rejectGuest], config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = JoinSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(formatZodError(parsed.error, 'Invalid matchmaking parameters'));
    }
    const { era_id, bucket } = parsed.data;

    const rating = await queryOne<{ mu: number; phi: number }>(
      `SELECT mu, phi FROM user_ratings WHERE user_id = $1 AND rating_type = 'ranked'`,
      [request.userId],
    );
    const userRow = await queryOne<{ level: number; xp: number }>(
      'SELECT level, xp FROM users WHERE user_id = $1',
      [request.userId],
    );
    const rankedGamesPlayedRow = await queryOne<{ c: string }>(
      `SELECT COUNT(*)::text AS c
       FROM game_players gp
       JOIN games g ON g.game_id = gp.game_id
       WHERE gp.user_id = $1
         AND g.is_ranked = true
         AND g.status = 'completed'`,
      [request.userId],
    );
    const existingProgress = await queryOne<{
      placement_matches_played: number;
      smurf_risk_score: number;
      stall_penalties: number;
    }>(
      `SELECT placement_matches_played, smurf_risk_score, stall_penalties
       FROM ranked_placement_progress WHERE user_id = $1`,
      [request.userId],
    );

    const mu = rating?.mu ?? 1500;
    const phi = rating?.phi ?? 350;
    const rankedGamesPlayed = Number(rankedGamesPlayedRow?.c ?? '0');
    const smurfRiskScore = estimateSmurfRisk({
      mu,
      phi,
      level: userRow?.level ?? 1,
      xp: userRow?.xp ?? 0,
      placementMatchesPlayed: existingProgress?.placement_matches_played ?? 0,
      rankedGamesPlayed,
    });

    await query(
      `INSERT INTO ranked_placement_progress (
         user_id, season_id, placement_matches_played, provisional, smurf_risk_score, stall_penalties, updated_at
       ) VALUES ($1, '2026_Q2', 0, true, $2, 0, NOW())
       ON CONFLICT (user_id) DO UPDATE
       SET smurf_risk_score = $2,
           updated_at = NOW()`,
      [request.userId, smurfRiskScore],
    );

    await query(
      `INSERT INTO ranked_queue (user_id, era_id, bucket, mu, phi)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE
       SET era_id = $2, bucket = $3, mu = $4, phi = $5, enqueued_at = NOW()`,
      [request.userId, era_id, bucket, mu, phi],
    );

    await attemptMatch(era_id, bucket);
    checkOnboardingQuests(request.userId, 'ranked_join').catch(() => {});

    return reply.send({
      queued: true,
      integrity: {
        smurf_risk_score: smurfRiskScore,
        smurf_risk_tier: tierFromSmurfRisk(smurfRiskScore),
        stall_penalties: existingProgress?.stall_penalties ?? 0,
      },
    });
  });

  fastify.delete('/leave', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    const queueRow = await queryOne<{ enqueued_at: Date }>(
      'SELECT enqueued_at FROM ranked_queue WHERE user_id = $1',
      [request.userId],
    );
    await query('DELETE FROM ranked_queue WHERE user_id = $1', [request.userId]);

    if (queueRow?.enqueued_at) {
      const waitedSeconds = Math.floor((Date.now() - new Date(queueRow.enqueued_at).getTime()) / 1000);
      if (waitedSeconds < 20) {
        await query(
          `INSERT INTO ranked_placement_progress (
             user_id, season_id, placement_matches_played, provisional, smurf_risk_score, stall_penalties, updated_at
           ) VALUES ($1, '2026_Q2', 0, true, 0, 1, NOW())
           ON CONFLICT (user_id) DO UPDATE
           SET stall_penalties = LEAST(10, ranked_placement_progress.stall_penalties + 1),
               updated_at = NOW()`,
          [request.userId],
        );
      } else if (waitedSeconds >= 90) {
        await query(
          `UPDATE ranked_placement_progress
           SET stall_penalties = GREATEST(0, stall_penalties - 1),
               updated_at = NOW()
           WHERE user_id = $1`,
          [request.userId],
        );
      }
    }

    return reply.send({ queued: false });
  });

  fastify.get('/status', { preHandler: authenticate }, async (request, reply) => {
    const row = await queryOne<{
      bucket: string; era_id: string; enqueued_at: Date;
      smurf_risk_score: number; stall_penalties: number; provisional: boolean;
    }>(
      `SELECT q.bucket, q.era_id, q.enqueued_at,
              COALESCE(rpp.smurf_risk_score, 0) AS smurf_risk_score,
              COALESCE(rpp.stall_penalties, 0) AS stall_penalties,
              COALESCE(rpp.provisional, true) AS provisional
       FROM ranked_queue q
       LEFT JOIN ranked_placement_progress rpp ON rpp.user_id = q.user_id
       WHERE q.user_id = $1`,
      [request.userId],
    );
    if (!row) return reply.send({ queued: false });
    return reply.send({
      queued: true,
      bucket: row.bucket,
      era_id: row.era_id,
      enqueued_at: row.enqueued_at,
      integrity: {
        smurf_risk_score: row.smurf_risk_score,
        smurf_risk_tier: tierFromSmurfRisk(row.smurf_risk_score),
        stall_penalties: row.stall_penalties,
        provisional: row.provisional,
      },
    });
  });
}

// Periodic sweep to match players whose wait time has widened the threshold.
//
// Self-rescheduling chain instead of `setInterval` so a slow `attemptMatch`
// can never overlap with the next tick (the previous setInterval-based
// implementation could stack multiple concurrent sweeps when DB queries got
// slow, racing against itself and producing duplicate/orphaned games).
const SWEEP_INTERVAL_MS = 5000;
let sweepTimer: ReturnType<typeof setTimeout> | null = null;
let sweepRunning = false;
let sweepStopped = true;

async function runSweepOnce(): Promise<void> {
  if (matchmakingPaused) return;
  try {
    const distinct = await query<{ era_id: string; bucket: string }>(
      'SELECT DISTINCT era_id, bucket FROM ranked_queue',
    );
    for (const { era_id, bucket } of distinct) {
      try {
        await attemptMatch(era_id, bucket);
      } catch (err) {
        console.error('[matchmaking] attemptMatch failed:', { era_id, bucket, err });
      }
    }
  } catch (err) {
    console.error('[matchmaking] sweep query failed:', err);
  }
}

function scheduleNextSweep(): void {
  if (sweepStopped) return;
  sweepTimer = setTimeout(async () => {
    sweepRunning = true;
    try {
      await runSweepOnce();
    } finally {
      sweepRunning = false;
      scheduleNextSweep();
    }
  }, SWEEP_INTERVAL_MS);
  // Don't keep the process alive just for this timer.
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref();
}

export function startMatchmakingSweep(): void {
  if (!sweepStopped) return;
  sweepStopped = false;
  scheduleNextSweep();
}

export function setMatchmakingPaused(paused: boolean): void {
  matchmakingPaused = paused;
}

export function isMatchmakingPaused(): boolean {
  return matchmakingPaused;
}

export function stopMatchmakingSweep(): void {
  sweepStopped = true;
  if (sweepTimer) {
    clearTimeout(sweepTimer);
    sweepTimer = null;
  }
  // Note: any in-flight `runSweepOnce` will complete naturally without
  // rescheduling because `sweepStopped` is now true.
  void sweepRunning; // documents that we deliberately don't await it
}
