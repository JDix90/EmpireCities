import 'dotenv/config';
import { randomUUID } from 'crypto';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import mongoose from 'mongoose';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import type { Server } from 'socket.io';
import { config } from './config';
import { validateProductionEnv } from './config/validateEnv';
import { connectPostgres, pgPool } from './db/postgres';
import { connectMongo } from './db/mongo';
import { connectRedis, redis } from './db/redis';
import { registerErrorHandler } from './errorHandler';
import { authRoutes } from './modules/auth/auth.routes';
import { usersRoutes } from './modules/users/users.routes';
import { gamesRoutes } from './modules/games/games.routes';
import { mapsRoutes } from './modules/maps/maps.routes';
import { initGameSocket, shutdownGameSocket } from './sockets/gameSocket';
import { matchmakingRoutes, setMatchmakingIo, startMatchmakingSweep, stopMatchmakingSweep } from './modules/matchmaking/matchmaking.routes';
import { dailyRoutes } from './modules/daily/daily.routes';
import { storeRoutes } from './modules/store/store.routes';
import { campaignRoutes } from './modules/campaign/campaign.routes';
import { progressionRoutes } from './modules/progression/progression.routes';
import { shareRoutes } from './modules/share/share.routes';
import { leaderboardRoutes } from './modules/leaderboard/leaderboard.routes';
import { feedRoutes } from './modules/feed/feed.routes';
import { getEraTechTree, getEraFactions } from './game-engine/eras';
import { getActiveSeasonal } from './game-engine/events/seasonalDecks';
import { startAsyncDeadlineWorker } from './workers/asyncDeadlineWorker';
import { startSeasonSweep, stopSeasonSweep } from './game-engine/progression/seasonService';
import { startChallengeSweep, stopChallengeSweep } from './game-engine/progression/challengeService';
import { startOrphanedGameSweep, stopOrphanedGameSweep } from './modules/games/gameCleanupService';
import { startGuestCleanupSweep, stopGuestCleanupSweep } from './modules/users/guestCleanupService';
import { initSentry } from './services/sentry';

async function bootstrap(): Promise<void> {
  validateProductionEnv();
  initSentry();

  await connectPostgres();
  await connectMongo();
  await connectRedis();

  const app = Fastify({
    logger: config.nodeEnv === 'development',
    trustProxy: true,
    genReqId: () => randomUUID(),
  });

  registerErrorHandler(app);

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: false,
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
    errorResponseBuilder: () => ({
      error: 'Too many requests. Please slow down.',
    }),
  });

  await app.register(
    async (scope) => {
      await scope.register(fastifyRateLimit, {
        max: 30,
        timeWindow: '1 minute',
        errorResponseBuilder: () => ({
          error: 'Too many authentication attempts. Please wait and try again.',
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
  await app.register(leaderboardRoutes, { prefix: '/api/leaderboards' });
  await app.register(feedRoutes, { prefix: '/api/feed' });

  app.get('/api/lobby/seasonal', async (_req, reply) => {
    return reply.send(getActiveSeasonal(new Date()));
  });

  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

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
  startSeasonSweep();
  startChallengeSweep();
  startOrphanedGameSweep();
  startGuestCleanupSweep();

  await app.listen({ port: config.port, host: '0.0.0.0' });

  console.log(`\n🚀 Eras of Empire backend running on http://localhost:${config.port}`);
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
    try {
      stopMatchmakingSweep();
      stopSeasonSweep();
      stopChallengeSweep();
      stopOrphanedGameSweep();
      stopGuestCleanupSweep();
      await shutdownGameSocket(io);
      await app.close();
      await mongoose.connection.close();
      await redis.quit();
      await pgPool.end();
      console.log('[shutdown] Clean exit');
    } catch (err) {
      console.error('[shutdown] Error during shutdown:', err);
    } finally {
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
