import 'dotenv/config';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import { config } from './config';
import { connectPostgres } from './db/postgres';
import { connectMongo } from './db/mongo';
import { connectRedis } from './db/redis';
import { authRoutes } from './modules/auth/auth.routes';
import { usersRoutes } from './modules/users/users.routes';
import { gamesRoutes } from './modules/games/games.routes';
import { mapsRoutes } from './modules/maps/maps.routes';
import { initGameSocket } from './sockets/gameSocket';

async function bootstrap(): Promise<void> {
  // ── Connect to databases ─────────────────────────────────────────────────
  await connectPostgres();
  await connectMongo();
  await connectRedis();

  // ── Create Fastify app ───────────────────────────────────────────────────
  const app = Fastify({
    logger: config.nodeEnv === 'development',
    trustProxy: true,
  });

  // ── Register plugins ─────────────────────────────────────────────────────
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: false, // Handled by frontend
  });

  await app.register(fastifyCors, {
    origin: config.frontendUrl,
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

  // ── Register routes ──────────────────────────────────────────────────────
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(usersRoutes, { prefix: '/api/users' });
  await app.register(gamesRoutes, { prefix: '/api/games' });
  await app.register(mapsRoutes, { prefix: '/api/maps' });

  // ── Health check ─────────────────────────────────────────────────────────
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // ── Attach Socket.io to Fastify's HTTP server ────────────────────────────
  await app.ready();
  const httpServer = app.server;
  const io = initGameSocket(httpServer);

  httpServer.listen(config.port, '0.0.0.0', () => {
    console.log(`\n🚀 ChronoConquest backend running on http://localhost:${config.port}`);
    console.log(`   Environment: ${config.nodeEnv}`);
    console.log(`   Frontend URL: ${config.frontendUrl}\n`);
  });
}

bootstrap().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
