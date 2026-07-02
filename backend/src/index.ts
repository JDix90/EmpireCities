import 'dotenv/config';
import { randomUUID } from 'crypto';
import os from 'os';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import type { Server } from 'socket.io';
import { config } from './config';
import { validateProductionEnv } from './config/validateEnv';
import { connectPostgres, pgPool, query, queryOne } from './db/postgres';
import { getEventLoopLagMs } from './services/eventLoopMonitor';
import { aiTurnLimiter, AI_MAX_CONCURRENCY_VALUE } from './game-engine/ai/aiConcurrency';
import { connectRedis, redis } from './db/redis';
import { registerErrorHandler } from './errorHandler';
import { authenticate } from './middleware/authenticate';
import { userOrIpKey } from './middleware/rateLimitKey';
import { authRoutes } from './modules/auth/auth.routes';
import { usersRoutes } from './modules/users/users.routes';
import { gamesRoutes } from './modules/games/games.routes';
import { mapsRoutes } from './modules/maps/maps.routes';
import { getActiveGameMetrics, getGameIo, initGameSocket, shutdownGameSocket, emitWaitingLobbySnapshotPublic } from './sockets/gameSocket';
import { getMigrationMetrics } from './sockets/migrationMetrics';
import { runReadinessChecks } from './health/readiness';
import { featureFlags, getClientFeatureFlags } from './config/featureFlags';
import { matchmakingRoutes, setMatchmakingIo, startMatchmakingSweep, stopMatchmakingSweep } from './modules/matchmaking/matchmaking.routes';
import { dailyRoutes } from './modules/daily/daily.routes';
import { storeRoutes } from './modules/store/store.routes';
import { campaignRoutes } from './modules/campaign/campaign.routes';
import { progressionRoutes } from './modules/progression/progression.routes';
import { shareRoutes } from './modules/share/share.routes';
import { registerReplayPreviewRoutes } from './modules/share/replayPreview';
import { leaderboardRoutes } from './modules/leaderboard/leaderboard.routes';
import { feedRoutes } from './modules/feed/feed.routes';
import { enhancementsRoutes } from './modules/enhancements/enhancements.routes';
import { analyticsRoutes } from './modules/analytics/analytics.routes';
import { adminRoutes } from './modules/admin/admin.routes';
import { getEraTechTree, getEraFactions } from './game-engine/eras';
import { getActiveSeasonal } from './game-engine/events/seasonalDecks';
import { startAsyncDeadlineWorker } from './workers/asyncDeadlineWorker';
import { startSeasonSweep, stopSeasonSweep } from './game-engine/progression/seasonService';
import { startChallengeSweep, stopChallengeSweep } from './game-engine/progression/challengeService';
import { ensureDailyChallengeForToday } from './game-engine/daily/dailyPuzzleService';
import { startOrphanedGameSweep, stopOrphanedGameSweep } from './modules/games/gameCleanupService';
import { startGuestCleanupSweep, stopGuestCleanupSweep } from './modules/users/guestCleanupService';
import { initSentry, captureException } from './services/sentry';
import { refreshAdminConfigCache, startAdminConfigSubscriber, stopAdminConfigSubscriber } from './services/adminConfig';

/**
 * Parse a comma-separated `https://host[:port]` / `wss://...` allowlist for the
 * CSP `connect-src` directive. Invalid entries are ignored with a warning so a
 * typo in ops config cannot break the page; the production schemes are
 * restricted to https/wss so an attacker cannot register a plain `http:` host.
 */
function parseExtraConnectOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const token of raw.split(',')) {
    const t = token.trim();
    if (!t) continue;
    try {
      const u = new URL(t);
      if (u.protocol !== 'https:' && u.protocol !== 'wss:') {
        console.warn(`[csp] Ignoring CSP_EXTRA_CONNECT_ORIGINS entry (must be https/wss): ${t}`);
        continue;
      }
      out.push(`${u.protocol}//${u.host}`);
    } catch {
      console.warn(`[csp] Ignoring malformed CSP_EXTRA_CONNECT_ORIGINS entry: ${t}`);
    }
  }
  return out;
}

/**
 * Derive Sentry ingest hosts from a DSN so CSP can permit the SDK's outbound
 * `connect-src` traffic without opening the directive to all of `https:`.
 */
function sentryIngestHosts(dsn: string): string[] {
  try {
    const u = new URL(dsn);
    return [`${u.protocol}//${u.host}`];
  } catch {
    return [];
  }
}

async function bootstrap(): Promise<void> {
  validateProductionEnv();
  initSentry();

  // Backstop for fire-and-forget async paths (AI turn chains, disconnect
  // cleanup): without a listener, Node kills the process on any unhandled
  // rejection — ending every in-progress game on this instance because one
  // promise was dropped. Log + report instead; the per-path catch blocks
  // remain the first line of defense.
  process.on('unhandledRejection', (reason) => {
    console.error('[Process] Unhandled promise rejection (process kept alive):', reason);
    captureException(reason);
  });

  // Unlike a dropped promise, an uncaught EXCEPTION leaves the process in an
  // undefined state (Node's own guidance). Capture it, then exit so the
  // orchestrator restarts a clean instance (`restart: unless-stopped`).
  // Authoritative game state lives in Redis, so in-progress games are reloaded
  // on restart; with multiple instances the LB/Redis adapter moves affected
  // clients to a healthy node. Staying up in a corrupted state is worse.
  process.on('uncaughtException', (err) => {
    console.error('[Process] Uncaught exception — exiting for a clean restart:', err);
    captureException(err);
    process.exit(1);
  });

  await connectPostgres();
  await connectRedis();

  const app = Fastify({
    logger: config.nodeEnv === 'development',
    trustProxy: true,
    genReqId: () => randomUUID(),
  });

  registerErrorHandler(app);

  // CSP: defense-in-depth against XSS, on top of the input-validation and
  // textContent rendering fixes. Tenor is whitelisted because chat embeds
  // sourced GIFs from media1?.tenor.com (see GameChat.tsx). The Three.js
  // globe textures live on jsdelivr; if you change the image CDN update
  // imgSrc as well. `'unsafe-inline'` is currently required for Tailwind's
  // JIT-injected style blocks; remove once we extract them to a stylesheet.
  //
  // connectSrc was previously `'self' + corsOrigins + 'wss:' + 'https:'`, which
  // effectively allowed any HTTPS/WSS host and defeated most of the protection.
  // We now allowlist only the same-origin endpoints, optional Sentry ingest
  // (if `SENTRY_DSN` is configured), and explicit `CSP_EXTRA_CONNECT_ORIGINS`
  // for ops integrations (analytics, log forwarder, etc.).
  const cspConnectExtras = [
    ...(config.sentryDsn ? sentryIngestHosts(config.sentryDsn) : []),
    ...parseExtraConnectOrigins(process.env.CSP_EXTRA_CONNECT_ORIGINS),
  ];
  await app.register(fastifyHelmet, {
    contentSecurityPolicy:
      config.nodeEnv === 'production'
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: [
                "'self'",
                'data:',
                'blob:',
                'https://media.tenor.com',
                'https://media1.tenor.com',
                'https://cdn.jsdelivr.net',
              ],
              fontSrc: ["'self'", 'data:'],
              connectSrc: ["'self'", ...config.corsOrigins, ...cspConnectExtras],
              frameAncestors: ["'none'"],
              objectSrc: ["'none'"],
              baseUri: ["'self'"],
              formAction: ["'self'"],
            },
          }
        : false,
    // Explicit HSTS in production: 1 year, cover subdomains, preload-eligible.
    // Helmet's default is a shorter max-age without includeSubDomains. TLS is
    // terminated at the edge proxy, so this is defense-in-depth against a
    // downgrade if a redirect/proxy is ever misconfigured. Disabled in dev
    // (plain-http localhost) to avoid pinning the loopback origin.
    hsts:
      config.nodeEnv === 'production'
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
        : false,
  });

  await app.register(fastifyCors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (config.corsOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(fastifyCookie, {
    secret: config.jwt.refreshSecret,
  });

  await app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute',
    // Back the limiter with Redis so counters are shared across instances and
    // survive restarts — an in-memory store would give each node its own
    // bucket (effective limit = max × nodeCount) and reset on every deploy.
    redis,
    // Key authenticated traffic by user id (falls back to IP). Without this the
    // limiter keys purely by IP, so users behind shared NAT share a bucket and
    // per-account abuse is invisible. See userOrIpKey for why we verify the
    // token here rather than relying on the (later) authenticate preHandler.
    keyGenerator: userOrIpKey,
    // statusCode is REQUIRED here: without it @fastify/rate-limit's thrown
    // error has no status and the global handler surfaces a 500 instead of
    // a 429 (real users saw "Internal server error" when rate-limited).
    errorResponseBuilder: () => ({
      statusCode: 429,
      message: 'Too many requests. Please slow down.',
    }),
  });

  await app.register(
    async (scope) => {
      await scope.register(fastifyRateLimit, {
        max: 30,
        timeWindow: '1 minute',
        redis,
        // Auth routes are pre-login, so this almost always keys by IP; using the
        // shared generator keeps behaviour consistent and covers token-bearing
        // calls like /refresh and /change-password.
        keyGenerator: userOrIpKey,
        errorResponseBuilder: () => ({
          statusCode: 429,
          message: 'Too many authentication attempts. Please wait and try again.',
        }),
      });
      await scope.register(authRoutes);
    },
    { prefix: '/api/auth' },
  );

  await app.register(usersRoutes, { prefix: '/api/users' });
  await app.register(gamesRoutes, { prefix: '/api/games' });
  await app.register(mapsRoutes, { prefix: '/api/maps' });
  await app.register(matchmakingRoutes, { prefix: '/api/matchmaking' });
  await app.register(dailyRoutes, { prefix: '/api/daily' });
  await app.register(storeRoutes, { prefix: '/api/store' });
  await app.register(campaignRoutes, { prefix: '/api/campaign' });
  await app.register(progressionRoutes, { prefix: '/api/progression' });
  await app.register(shareRoutes, { prefix: '/api/share' });
  // Top-level (no /api prefix) crawler HTML shell for /replay/:id. nginx routes
  // only social/chat crawler user-agents here; humans get the SPA.
  registerReplayPreviewRoutes(app);
  await app.register(leaderboardRoutes, { prefix: '/api/leaderboards' });
  await app.register(feedRoutes, { prefix: '/api/feed' });
  await app.register(enhancementsRoutes, { prefix: '/api/enhancements' });
  await app.register(analyticsRoutes, { prefix: '/api/analytics' });
  await app.register(
    async (scope) => {
      await scope.register(fastifyRateLimit, {
        max: 30,
        timeWindow: '1 minute',
        redis,
        keyGenerator: userOrIpKey,
        errorResponseBuilder: () => ({
          statusCode: 429,
          message: 'Too many admin requests. Please wait and try again.',
        }),
      });
      await scope.register(adminRoutes);
    },
    { prefix: '/api/admin' },
  );

  app.get('/api/feature-flags', async (_req, reply) => {
    return reply.send(getClientFeatureFlags());
  });

  app.get('/api/lobby/seasonal', async (_req, reply) => {
    return reply.send(getActiveSeasonal(new Date()));
  });

  app.post('/api/lobby/faction-select', { preHandler: [authenticate] }, async (req, reply) => {
    const body = req.body as {
      game_id?: unknown;
      player_id?: unknown;
      ai_index?: unknown;
      faction_id?: unknown;
    };

    const gameId = typeof body.game_id === 'string' ? body.game_id : null;
    const playerId = typeof body.player_id === 'string' ? body.player_id : null;
    const aiIndex = typeof body.ai_index === 'number' ? body.ai_index : null;
    const factionId = typeof body.faction_id === 'string' && body.faction_id ? body.faction_id : null;

    if (!gameId) return reply.status(400).send({ error: 'game_id is required' });

    const game = await queryOne<{ status: string; settings_json: unknown }>(
      'SELECT status, settings_json FROM games WHERE game_id = $1',
      [gameId],
    );
    if (!game) return reply.status(404).send({ error: 'Game not found' });
    if (game.status !== 'waiting') return reply.status(409).send({ error: 'Game has already started' });

    const settings = typeof game.settings_json === 'string'
      ? (JSON.parse(game.settings_json) as Record<string, unknown>)
      : (game.settings_json as Record<string, unknown>);

    if (!settings?.factions_enabled) {
      return reply.status(409).send({ error: 'Factions are not enabled for this game' });
    }

    type PlayerRow = { player_index: number; user_id: string | null; is_ai: boolean; faction_id: string | null };
    const players = await query<PlayerRow>(
      'SELECT player_index, user_id, is_ai, faction_id FROM game_players WHERE game_id = $1 ORDER BY player_index',
      [gameId],
    );

    const hostRow = players.find((p) => p.player_index === 0 && !p.is_ai);
    const isHost = hostRow?.user_id === req.userId;

    // Determine which player row to update
    let targetRow: PlayerRow | undefined;
    if (aiIndex !== null) {
      // Assigning AI faction — only the host may do this
      if (!isHost) return reply.status(403).send({ error: 'Only the host can assign factions to AI players' });
      targetRow = players.find((p) => p.is_ai && p.player_index === aiIndex);
    } else if (playerId) {
      // Assigning own faction — must be yourself
      if (playerId !== req.userId) return reply.status(403).send({ error: 'You can only set your own faction' });
      targetRow = players.find((p) => p.user_id === playerId && !p.is_ai);
    } else {
      // No target specified — treat as the requesting user's own row
      targetRow = players.find((p) => p.user_id === req.userId && !p.is_ai);
    }

    if (!targetRow) return reply.status(404).send({ error: 'Player not found in this game' });

    // Ensure no other player has already claimed this faction
    if (factionId) {
      const collision = players.find(
        (p) => p.faction_id === factionId && p.player_index !== targetRow!.player_index,
      );
      if (collision) return reply.status(409).send({ error: 'That faction is already taken by another player' });
    }

    await query(
      'UPDATE game_players SET faction_id = $1 WHERE game_id = $2 AND player_index = $3',
      [factionId, gameId, targetRow.player_index],
    );

    // Notify all players in the lobby about the updated faction selections
    const io = getGameIo();
    if (io) {
      await emitWaitingLobbySnapshotPublic(io, gameId);
    }

    return reply.send({ ok: true });
  });

  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  /** Readiness for orchestrators — verifies Postgres and Redis. */
  app.get('/ready', async (_req, reply) => {
    const result = await runReadinessChecks();
    if (result.ok) return reply.send({ status: 'ready', checks: result.checks });
    // Log the full failure detail server-side, but never return raw datastore
    // error strings (internal hostnames, "password authentication failed",
    // DSN fragments) to an unauthenticated caller in production.
    console.error('[ready] not ready:', JSON.stringify(result.checks));
    const checks =
      config.nodeEnv === 'production'
        ? result.checks.map(({ name, ok }) => ({ name, ok }))
        : result.checks;
    return reply.code(503).send({ status: 'not_ready', checks });
  });

  /**
   * Lightweight process metrics (no secrets). Disable with METRICS_ENDPOINT_ENABLED=false.
   * For dashboards, scrape this or forward to your metrics stack.
   */
  app.get('/metrics/json', async (_req, reply) => {
    if (!featureFlags.metricsEndpointEnabled) {
      return reply.code(404).send({ error: 'Not found' });
    }
    const mem = process.memoryUsage();
    const { activeGameRooms, pendingEvictions } = getActiveGameMetrics();
    const migration = getMigrationMetrics();
    return reply.send({
      uptime_seconds: process.uptime(),
      active_game_rooms: activeGameRooms,
      pending_evictions: pendingEvictions,
      redis_migration: migration,
      rss_bytes: mem.rss,
      heap_used_bytes: mem.heapUsed,
      // Burst-triage gauges: pool saturation and event-loop lag are what break
      // first under a game-creation spike; AI queue depth shows worker-cap
      // backpressure. (pending/waiting climbing = shedding/queueing in effect.)
      pg_pool: {
        total: pgPool.totalCount,
        idle: pgPool.idleCount,
        waiting: pgPool.waitingCount,
      },
      event_loop_lag_ms: getEventLoopLagMs(),
      ai_turns: {
        active: aiTurnLimiter.activeCount,
        queued: aiTurnLimiter.queuedCount,
        max: AI_MAX_CONCURRENCY_VALUE,
      },
      timestamp: new Date().toISOString(),
    });
  });

  /** Instance identity for multi-node debugging (non-production or when metrics enabled). */
  app.get('/api/instance', async (_req, reply) => {
    if (config.nodeEnv === 'production' && !featureFlags.metricsEndpointEnabled) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return reply.send({ instanceId: process.env.INSTANCE_ID || os.hostname() });
  });

  // Static era tech tree — public, no auth needed
  app.get<{ Params: { era: string } }>('/api/eras/:era/tech-tree', async (req, reply) => {
    try {
      const techTree = getEraTechTree(req.params.era as Parameters<typeof getEraTechTree>[0]);
      return reply.send({ techTree });
    } catch {
      return reply.code(404).send({ error: 'Unknown era' });
    }
  });

  // Static era factions — public, no auth needed
  app.get<{ Params: { era: string } }>('/api/eras/:era/factions', async (req, reply) => {
    try {
      const factions = getEraFactions(req.params.era as Parameters<typeof getEraFactions>[0]);
      return reply.send({ factions });
    } catch {
      return reply.code(404).send({ error: 'Unknown era' });
    }
  });

  await app.ready();
  const io = initGameSocket(app.server);
  setMatchmakingIo(io);
  startMatchmakingSweep();
  startAsyncDeadlineWorker();
  const { startTurnTimerWorker } = await import('./workers/gameTimerWorker');
  startTurnTimerWorker();
  startSeasonSweep();
  startChallengeSweep();
  startOrphanedGameSweep();
  startGuestCleanupSweep();
  // Hourly re-engagement sweep (streak reminders, win-back). Sends are gated
  // by the retention_notifications_enabled flag, so starting the worker with
  // the flag off is a safe no-op dark launch.
  const { startRetentionNotificationWorker } = await import('./workers/retentionNotificationWorker');
  await startRetentionNotificationWorker().catch((err) =>
    console.error('[Retention] Worker failed to start:', err),
  );
  await refreshAdminConfigCache().catch(() => {});
  await startAdminConfigSubscriber().catch((err) =>
    console.warn('[adminConfig] subscriber start failed (config edits will be per-instance until restart):', err),
  );

  void ensureDailyChallengeForToday().catch((err) => {
    console.error('[daily] Failed to ensure today challenge row:', err);
  });

  await app.listen({ port: config.port, host: '0.0.0.0' });

  console.log(`\n🚀 Borderfall backend running on http://localhost:${config.port}`);
  console.log(`   Environment: ${config.nodeEnv}`);
  console.log(`   CORS origins: ${config.corsOrigins.join(', ')}\n`);

  setupGracefulShutdown(app, io);
}

function setupGracefulShutdown(app: FastifyInstance, io: Server): void {
  let inProgress = false;

  const shutdown = async (signal: string) => {
    if (inProgress) return;
    inProgress = true;
    console.log(`\n[shutdown] Received ${signal}, draining...`);
    // Hard cap: if a drain step hangs (stuck socket close, slow flush), force
    // exit rather than wait for the orchestrator's SIGKILL.
    const forceExit = setTimeout(() => {
      console.error('[shutdown] Drain exceeded 15s — forcing exit');
      process.exit(1);
    }, 15_000);
    forceExit.unref();
    try {
      stopMatchmakingSweep();
      stopSeasonSweep();
      stopChallengeSweep();
      stopOrphanedGameSweep();
      stopGuestCleanupSweep();
      await import('./workers/retentionNotificationWorker')
        .then((m) => m.stopRetentionNotificationWorker())
        .catch(() => {});
      await stopAdminConfigSubscriber();
      await shutdownGameSocket(io);
      await app.close();
      await redis.quit();
      await pgPool.end();
      console.log('[shutdown] Clean exit');
    } catch (err) {
      console.error('[shutdown] Error during shutdown:', err);
    } finally {
      clearTimeout(forceExit);
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

bootstrap().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
