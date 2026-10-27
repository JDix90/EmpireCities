/**
 * Against Postgres: two refreshes carrying one cookie both succeed, and so does
 * a retry after a reply that never arrived, while an old token whose
 * replacement has been used is still refused. The second request waits on the
 * first one's row lock, so this needs the real database: a mock cannot show
 * what that request can see once the lock is released.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/auth/refreshGrace.db.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

const enabled = process.env.PG_TEST === '1';
type Query = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

describe.runIf(enabled)('refresh grace (Postgres)', { timeout: 30_000 }, () => {
  let query: Query;
  let app: FastifyInstance;
  let setFlags: (graceOn: boolean) => void;
  const userId = uuidv4();

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as { query: Query });
    const adminConfig = await import('../../services/adminConfig');
    setFlags = (graceOn) =>
      adminConfig.setAdminConfigCacheForTests({ feature_flags: { session_refresh_grace_enabled: graceOn } });
    await query(
      `INSERT INTO users (user_id, username, email, password_hash) VALUES ($1, $2, $3, 'x')`,
      [userId, `grace_${userId.slice(0, 8)}`, `grace_${userId.slice(0, 8)}@test.local`],
    );
    const { default: fastifyCookie } = await import('@fastify/cookie');
    const { config } = await import('../../config');
    const { authRoutes } = await import('./auth.routes');
    app = Fastify();
    await app.register(fastifyCookie, { secret: config.jwt.refreshSecret });
    await app.register(authRoutes, { prefix: '/api/auth' });
    await app.ready();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    if (query) await query('DELETE FROM users WHERE user_id = $1', [userId]).catch(() => {});
  });

  /** A live refresh token for the test user, as a sign-in would issue. */
  async function signIn(): Promise<string> {
    const { signRefreshToken } = await import('../../utils/jwt');
    const tokenId = uuidv4();
    const token = signRefreshToken({ sub: userId, tokenId }, '30d');
    await query(
      `INSERT INTO refresh_tokens (token_id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '30 days')`,
      [tokenId, userId, createHash('sha256').update(token).digest('hex')],
    );
    return token;
  }

  const refresh = (token: string) =>
    app.inject({ method: 'POST', url: '/api/auth/refresh', cookies: { refreshToken: token } });
  const newCookie = (res: Awaited<ReturnType<typeof refresh>>) =>
    res.cookies.find((c) => c.name === 'refreshToken')!.value;

  it('lets two refreshes carrying one cookie both succeed', async () => {
    setFlags(true);
    for (let i = 0; i < 5; i += 1) {
      const token = await signIn();
      const statuses = (await Promise.all([refresh(token), refresh(token)])).map((r) => r.statusCode);
      expect(statuses).toEqual([200, 200]);
    }
  });

  it('gave the second one a 401 without the grace, which signed the player out', async () => {
    setFlags(false);
    const token = await signIn();
    const statuses = (await Promise.all([refresh(token), refresh(token)])).map((r) => r.statusCode);
    expect(statuses.sort()).toEqual([200, 401]);
  });

  it('accepts a retry after a lost reply until the replacement is used', async () => {
    setFlags(true);
    const old = await signIn();
    const lost = await refresh(old);
    expect(lost.statusCode).toBe(200);

    const retry = await refresh(old);
    expect(retry.statusCode).toBe(200);
    const next = await refresh(newCookie(retry));
    expect(next.statusCode).toBe(200);

    // The browser that holds the lost reply's token uses it: the old one is done.
    expect((await refresh(newCookie(lost))).statusCode).toBe(200);
    expect((await refresh(old)).statusCode).toBe(401);
  });

  it('refuses the replaced token once the session is ended', async () => {
    setFlags(true);
    const old = await signIn();
    const current = newCookie(await refresh(old));
    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', cookies: { refreshToken: current } });
    expect(out.statusCode).toBe(200);
    expect((await refresh(old)).statusCode).toBe(401);
  });
});
