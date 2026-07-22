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
import { startWaitingGame } from '../../sockets/gameSocket';

const VALID_BUCKETS = ['blitz_120', 'standard_300', 'long_1200', 'async_43200', 'async_86400', 'async_259200'] as const;
type Bucket = (typeof VALID_BUCKETS)[number];

const VALID_ERA_IDS = ['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern', 'acw', 'risorgimento'] as const;
type RankedEraId = (typeof VALID_ERA_IDS)[number];

/**
 * Per-era opponent-count limits for multi-size ranked (flag
 * `ranked_multi_size_enabled`). `preferred_opponents` P ⇒ a (P+1)-player game.
 * World maps (42–57 territories) support up to 6 players; the regional maps are
 * capped so players don't start with ~2 territories each (ACW has 18
 * territories, Risorgimento 14). Mirrored client-side in
 * frontend/src/utils/rankedPrefs.ts — keep the two tables in sync.
 */
export const RANKED_SIZE_BY_ERA: Record<RankedEraId, { default: number; max: number }> = {
  ancient: { default: 3, max: 5 },
  medieval: { default: 3, max: 5 },
  discovery: { default: 3, max: 5 },
  ww2: { default: 3, max: 5 },
  coldwar: { default: 3, max: 5 },
  modern: { default: 3, max: 5 },
  acw: { default: 2, max: 3 },
  risorgimento: { default: 1, max: 2 },
};

const JoinSchema = z.object({
  era_id: z.enum(VALID_ERA_IDS),
  bucket: z.enum(VALID_BUCKETS),
  preferred_opponents: z.number().int().min(1).max(5).optional(),
});

const AcceptOfferSchema = z.object({
  opponents: z.number().int().min(1).max(5),
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
  preferred_opponents: number;
}

interface MatchmakingThresholdConfig {
  threshold_base: number;
  threshold_wait_bonus_per_30s: number;
}

/**
 * Per-pair compatibility — exactly the historical 1v1 rule: mu difference
 * within a base threshold widened by the higher uncertainty (phi) and by how
 * long the longer-waiting player has been queued, plus the smurf/stall
 * integrity gate.
 */
export function pairOk(
  a: QueueCandidate,
  b: QueueCandidate,
  cfg: MatchmakingThresholdConfig,
  now: number,
): boolean {
  const waitMs = now - Math.min(new Date(a.enqueued_at).getTime(), new Date(b.enqueued_at).getTime());
  const waitBonus = cfg.threshold_wait_bonus_per_30s * Math.floor(waitMs / 30000);
  const threshold = cfg.threshold_base + Math.max(a.phi, b.phi) + waitBonus;
  return Math.abs(a.mu - b.mu) <= threshold && shouldPairByIntegrity(a, b, waitMs);
}

/** All-pairs pairOk over a prospective game roster. */
export function isCliqueCompatible(
  players: QueueCandidate[],
  cfg: MatchmakingThresholdConfig,
  now: number,
): boolean {
  for (let i = 0; i < players.length - 1; i++) {
    for (let j = i + 1; j < players.length; j++) {
      if (!pairOk(players[i], players[j], cfg, now)) return false;
    }
  }
  return true;
}

/**
 * Greedy cohort selection anchored on the longest-waiting player: walk the
 * queue oldest-first, adding each candidate that is pairwise-compatible with
 * everyone already picked, until `need` players are found. Falls back to the
 * next-oldest anchor if the first can't seed a full cohort. At need=2 this
 * degenerates to the historical first-compatible-pair behavior.
 *
 * `candidates` must be ordered by enqueued_at ASC (the SQL does this).
 */
export function findCohort(
  candidates: QueueCandidate[],
  need: number,
  cfg: MatchmakingThresholdConfig,
  now: number,
): QueueCandidate[] | null {
  if (candidates.length < need) return null;
  for (let anchor = 0; anchor <= candidates.length - need; anchor++) {
    const cohort: QueueCandidate[] = [candidates[anchor]];
    for (let i = anchor + 1; i < candidates.length && cohort.length < need; i++) {
      const next = candidates[i];
      if (cohort.every((member) => pairOk(member, next, cfg, now))) cohort.push(next);
    }
    if (cohort.length === need) return cohort;
  }
  return null;
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
async function attemptMatch(eraId: string, bucket: string, preferredOpponents = 1): Promise<void> {
  // Flag off: ignore the preference column entirely and match everyone as 1v1
  // (kill-switch — queued multi-size rows drain instead of stranding).
  const multiSize = featureFlags.rankedMultiSizeEnabled;
  const need = multiSize ? preferredOpponents + 1 : 2;

  const match = await withTransaction(async (client) => {
    const { rows: candidates } = await client.query<QueueCandidate>(
      `SELECT q.*,
              COALESCE(rpp.smurf_risk_score, 0) AS smurf_risk_score,
              COALESCE(rpp.stall_penalties, 0) AS stall_penalties
       FROM ranked_queue q
       LEFT JOIN ranked_placement_progress rpp ON rpp.user_id = q.user_id
       WHERE q.era_id = $1 AND q.bucket = $2
         AND ($3::smallint IS NULL OR q.preferred_opponents = $3)
       ORDER BY enqueued_at
       LIMIT 20
       -- Lock ONLY the ranked_queue rows (OF q). A bare FOR UPDATE tries to
       -- lock both sides of the LEFT JOIN, and Postgres rejects locking the
       -- nullable side of an outer join ("FOR UPDATE cannot be applied to the
       -- nullable side of an outer join", SQLSTATE 0A000) — which threw on
       -- every /join, since this SELECT runs before the candidate-count check.
       FOR UPDATE OF q SKIP LOCKED`,
      [eraId, bucket, multiSize ? preferredOpponents : null],
    );

    const cohort = findCohort(candidates, need, getMatchmakingConfig(), Date.now());
    if (!cohort) return null;

    const gameId = await createRankedGameTx(client, cohort, eraId, bucket as Bucket);
    return { gameId, players: cohort };
  });

  if (!match) return;
  await finalizeRankedGame(match.gameId, match.players);
}

/**
 * Post-commit steps shared by the join path, the sweep, and accept-offer:
 * server-side auto-start (matched players should land straight in play, not a
 * waiting room whose seat-0 "host" must click Start), then notify everyone.
 * Start FIRST so the navigation triggered by matchmaking:found lands on an
 * in_progress game; if the start fails we log and fall back to the waiting
 * room's host-start flow — same degradation the casual auto-start accepts.
 *
 * Note delivery: sockets never populate ranked_queue.socket_id from the web
 * client (the matchmaking:join socket event has no frontend emitter), so
 * emitting to socket_id alone reached nobody. Every authenticated socket joins
 * its `user:<id>` room on connect — emit there, plus socket_id when present.
 */
async function finalizeRankedGame(gameId: string, players: QueueCandidate[]): Promise<void> {
  if (!_io) return;
  try {
    const started = await startWaitingGame(_io, gameId);
    if (!started.ok) {
      console.error('[matchmaking] ranked auto-start failed:', { gameId, error: started.error });
    }
  } catch (err) {
    console.error('[matchmaking] ranked auto-start threw:', { gameId, err });
  }
  for (const p of players) {
    _io.to(`user:${p.user_id}`).emit('matchmaking:found', { game_id: gameId });
    if (p.socket_id) _io.to(p.socket_id).emit('matchmaking:found', { game_id: gameId });
  }
}

/**
 * Read-only scan for a smaller-size cohort this user could complete: some
 * preference Q < P whose queue count is exactly Q (a (Q+1)-player game one
 * seat short), where the whole group ∪ this user is mutually compatible.
 * Returns the largest such Q (closest to the user's own preference), or null.
 * Skipped entirely if the user is no longer queued (attemptMatch just placed
 * them into their own-size game).
 */
async function findSmallerGameOffer(
  userId: string,
  eraId: string,
  bucket: string,
  preferredOpponents: number,
  self: { mu: number; phi: number; smurf_risk_score: number; stall_penalties: number },
): Promise<{ opponents: number; era_id: string; bucket: string } | null> {
  const stillQueued = await queryOne<{ user_id: string }>(
    'SELECT user_id FROM ranked_queue WHERE user_id = $1',
    [userId],
  );
  if (!stillQueued) return null;

  const shortCohorts = await query<{ q: number }>(
    `SELECT preferred_opponents AS q
     FROM ranked_queue
     WHERE era_id = $1 AND bucket = $2 AND preferred_opponents < $3 AND user_id <> $4
     GROUP BY preferred_opponents
     HAVING COUNT(*) = preferred_opponents
     ORDER BY preferred_opponents DESC`,
    [eraId, bucket, preferredOpponents, userId],
  );
  if (shortCohorts.length === 0) return null;

  const selfCandidate: QueueCandidate = {
    id: '',
    user_id: userId,
    era_id: eraId,
    bucket,
    mu: self.mu,
    phi: self.phi,
    socket_id: null,
    enqueued_at: new Date(),
    smurf_risk_score: self.smurf_risk_score,
    stall_penalties: self.stall_penalties,
    preferred_opponents: preferredOpponents,
  };
  const mmCfg = getMatchmakingConfig();
  const now = Date.now();

  for (const { q } of shortCohorts) {
    const members = await query<QueueCandidate>(
      `SELECT q.*,
              COALESCE(rpp.smurf_risk_score, 0) AS smurf_risk_score,
              COALESCE(rpp.stall_penalties, 0) AS stall_penalties
       FROM ranked_queue q
       LEFT JOIN ranked_placement_progress rpp ON rpp.user_id = q.user_id
       WHERE q.era_id = $1 AND q.bucket = $2 AND q.preferred_opponents = $3 AND q.user_id <> $4
       ORDER BY enqueued_at`,
      [eraId, bucket, q, userId],
    );
    if (members.length !== q) continue; // raced away between the two reads
    if (isCliqueCompatible([...members, selfCandidate], mmCfg, now)) {
      return { opponents: q, era_id: eraId, bucket };
    }
  }
  return null;
}

async function createRankedGameTx(
  client: import('pg').PoolClient,
  players: QueueCandidate[],
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
    max_players: players.length,
  };
  if (bucketCfg.async_mode) {
    settings.async_mode = true;
    settings.async_turn_deadline_seconds = bucketCfg.turn_timer_seconds;
  }
  // Ranked Era Advancement: opt-in via flag (default OFF — product decision).
  // Only ancient-start buckets are eligible, since the spine begins in Ancient.
  // NOTE: its balance review (eraBalanceTuning.md) was 1v1-scoped — keep this
  // flag OFF while multi-size ranked is on until re-reviewed for FFA sizes.
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

  // COLORS has 8 entries; cohort sizes cap at 6 players.
  for (let i = 0; i < players.length; i++) {
    await client.query(
      `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai)
       VALUES ($1, $2, $3, $4, false)`,
      [gameId, players[i].user_id, i, COLORS[i]],
    );
  }

  await client.query('DELETE FROM ranked_queue WHERE user_id = ANY($1)', [
    players.map((p) => p.user_id),
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

    // Effective opponent preference: flag off → always 1 (strict 1v1, byte-
    // identical to the pre-flag behavior regardless of payload); flag on →
    // requested value (or the era default) clamped to the era's map-size cap.
    const eraSize = RANKED_SIZE_BY_ERA[era_id];
    const preferredOpponents = featureFlags.rankedMultiSizeEnabled
      ? Math.min(Math.max(parsed.data.preferred_opponents ?? eraSize.default, 1), eraSize.max)
      : 1;

    await query(
      `INSERT INTO ranked_queue (user_id, era_id, bucket, mu, phi, preferred_opponents)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE
       SET era_id = $2, bucket = $3, mu = $4, phi = $5, preferred_opponents = $6, enqueued_at = NOW()`,
      [request.userId, era_id, bucket, mu, phi, preferredOpponents],
    );

    await attemptMatch(era_id, bucket, preferredOpponents);
    checkOnboardingQuests(request.userId, 'ranked_join').catch(() => {});

    // Join-time offer (requirement: "be the final piece of a smaller game"):
    // if this player wasn't just matched at their own size, look for a cohort
    // with a SMALLER preference that is exactly one seat short and fully
    // compatible with this player, and surface it as a one-time offer. The
    // offer is advisory — nothing is reserved; /accept-offer re-validates.
    let offer: { opponents: number; era_id: string; bucket: string } | null = null;
    if (featureFlags.rankedMultiSizeEnabled && preferredOpponents > 1) {
      offer = await findSmallerGameOffer(request.userId, era_id, bucket, preferredOpponents, {
        mu,
        phi,
        smurf_risk_score: smurfRiskScore,
        stall_penalties: existingProgress?.stall_penalties ?? 0,
      });
    }

    return reply.send({
      queued: true,
      integrity: {
        smurf_risk_score: smurfRiskScore,
        smurf_risk_tier: tierFromSmurfRisk(smurfRiskScore),
        stall_penalties: existingProgress?.stall_penalties ?? 0,
      },
      ...(offer ? { offer } : {}),
    });
  });

  // Accept a join-time smaller-game offer: try ONCE, atomically, to complete a
  // (Q+1)-player game from the Q-preference cohort plus the caller. Nothing was
  // reserved when the offer was surfaced, so this re-validates everything under
  // lock; on any failure the caller's own queue row (at their original larger
  // preference) is untouched and they simply keep waiting.
  fastify.post('/accept-offer', { preHandler: [authenticate, rejectGuest], config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (!featureFlags.rankedMultiSizeEnabled) {
      return reply.status(404).send({ error: 'Not available' });
    }
    const parsed = AcceptOfferSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(formatZodError(parsed.error, 'Invalid offer parameters'));
    }
    const targetOpponents = parsed.data.opponents;

    const match = await withTransaction(async (client) => {
      // Lock the caller's own queue row first — plain FOR UPDATE (no SKIP
      // LOCKED): if a concurrent sweep holds it we wait for its verdict rather
      // than misreport. Absent afterwards → the sweep matched them while the
      // modal was open (matchmaking:found already navigated them), or they
      // left the queue.
      const { rows: selfRows } = await client.query<QueueCandidate>(
        `SELECT q.*, 0::real AS smurf_risk_score, 0 AS stall_penalties
         FROM ranked_queue q
         WHERE q.user_id = $1
         FOR UPDATE OF q`,
        [request.userId],
      );
      if (selfRows.length === 0) return { formed: false as const, reason: 'not_queued' as const };
      const self = selfRows[0];
      const selfIntegrity = await client.query<{ smurf_risk_score: number; stall_penalties: number }>(
        `SELECT COALESCE(smurf_risk_score, 0) AS smurf_risk_score,
                COALESCE(stall_penalties, 0) AS stall_penalties
         FROM ranked_placement_progress WHERE user_id = $1`,
        [request.userId],
      );
      self.smurf_risk_score = selfIntegrity.rows[0]?.smurf_risk_score ?? 0;
      self.stall_penalties = selfIntegrity.rows[0]?.stall_penalties ?? 0;

      const { rows: candidates } = await client.query<QueueCandidate>(
        `SELECT q.*,
                COALESCE(rpp.smurf_risk_score, 0) AS smurf_risk_score,
                COALESCE(rpp.stall_penalties, 0) AS stall_penalties
         FROM ranked_queue q
         LEFT JOIN ranked_placement_progress rpp ON rpp.user_id = q.user_id
         WHERE q.era_id = $1 AND q.bucket = $2 AND q.preferred_opponents = $3 AND q.user_id <> $4
         ORDER BY enqueued_at
         LIMIT 20
         FOR UPDATE OF q SKIP LOCKED`,
        [self.era_id, self.bucket, targetOpponents, request.userId],
      );

      // Greedy-fill Q members, each compatible with the caller and all picks.
      const now = Date.now();
      const mmCfg = getMatchmakingConfig();
      const cohort: QueueCandidate[] = [self];
      for (const c of candidates) {
        if (cohort.length === targetOpponents + 1) break;
        if (cohort.every((member) => pairOk(member, c, mmCfg, now))) cohort.push(c);
      }
      if (cohort.length < targetOpponents + 1) {
        return { formed: false as const, reason: 'cohort_gone' as const };
      }

      const gameId = await createRankedGameTx(client, cohort, self.era_id, self.bucket as Bucket);
      return { formed: true as const, gameId, players: cohort };
    });

    if (!match.formed) {
      return reply.send({ formed: false, reason: match.reason });
    }
    await finalizeRankedGame(match.gameId, match.players);
    return reply.send({ formed: true, game_id: match.gameId });
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
      bucket: string; era_id: string; enqueued_at: Date; preferred_opponents: number;
      smurf_risk_score: number; stall_penalties: number; provisional: boolean;
    }>(
      `SELECT q.bucket, q.era_id, q.enqueued_at, q.preferred_opponents,
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
      preferred_opponents: row.preferred_opponents,
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
    // Flag on: one attempt per (era, bucket, size) cohort. Flag off: the
    // preference column is ignored (attemptMatch matches everyone as 1v1), so
    // the historical (era, bucket) grouping drains the whole queue.
    if (featureFlags.rankedMultiSizeEnabled) {
      const distinct = await query<{ era_id: string; bucket: string; preferred_opponents: number }>(
        'SELECT DISTINCT era_id, bucket, preferred_opponents FROM ranked_queue',
      );
      for (const { era_id, bucket, preferred_opponents } of distinct) {
        try {
          await attemptMatch(era_id, bucket, preferred_opponents);
        } catch (err) {
          console.error('[matchmaking] attemptMatch failed:', { era_id, bucket, preferred_opponents, err });
        }
      }
      return;
    }
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
