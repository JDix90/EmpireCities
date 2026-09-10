/**
 * The admin dashboard's "Last login" column is fed by users.last_login_at
 * (migration 033), stamped fire-and-forget from the auth flows. Returning
 * players almost never hit /login — the access token lives in memory only, so
 * every page load goes through /refresh — which makes the rotation stamp the
 * one that keeps the column honest. Lock it in, and lock in that a failed stamp
 * never breaks the refresh itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createHash } from 'crypto';

const queryMock = vi.hoisted(() => vi.fn());
const txnClientQueryMock = vi.hoisted(() => vi.fn());
vi.mock('../../db/postgres', () => ({
  query: (...a: unknown[]) => queryMock(...a),
  queryOne: async (...a: unknown[]) => ((await queryMock(...a)) as unknown[])[0] ?? null,
  withTransaction: async (fn: (client: { query: typeof txnClientQueryMock }) => Promise<unknown>) =>
    fn({ query: txnClientQueryMock }),
  pgPool: { query: (...a: unknown[]) => queryMock(...a) },
}));
vi.mock('../../services/notificationService', () => ({
  sendTransactionalEmailToAddress: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../services/analyticsEvents', () => ({
  recordServerEvent: vi.fn(),
}));

const USER_ID = '11111111-2222-4333-8444-555555555555';

async function buildApp(): Promise<FastifyInstance> {
  const { default: fastifyCookie } = await import('@fastify/cookie');
  const { config } = await import('../../config');
  const { authRoutes } = await import('./auth.routes');
  const app = Fastify();
  await app.register(fastifyCookie, { secret: config.jwt.refreshSecret });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.ready();
  return app;
}

async function mintRefreshCookie(): Promise<string> {
  const { signRefreshToken } = await import('../../utils/jwt');
  const token = signRefreshToken({ sub: USER_ID, tokenId: 'tok-1' });
  const tokenHash = createHash('sha256').update(token).digest('hex');
  txnClientQueryMock.mockImplementation(async (sql: string) => {
    if (/FROM refresh_tokens/.test(sql)) return { rows: [{ token_hash: tokenHash, revoked: false }] };
    if (/FROM users/.test(sql)) return { rows: [{ username: 'ada', is_admin: false, is_guest: false }] };
    return { rows: [] };
  });
  return token;
}

const stampCalls = () =>
  queryMock.mock.calls.filter(([sql]) => /UPDATE users SET last_login_at = NOW\(\)/.test(String(sql)));

beforeEach(() => {
  queryMock.mockReset();
  txnClientQueryMock.mockReset();
  queryMock.mockResolvedValue([]);
});

describe('last_login_at stamp', () => {
  it('is written on refresh rotation, for the rotating user', async () => {
    const app = await buildApp();
    try {
      const token = await mintRefreshCookie();
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        cookies: { refreshToken: token },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().accessToken).toEqual(expect.any(String));

      const calls = stampCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0][1]).toEqual([USER_ID]);
    } finally {
      await app.close();
    }
  });

  it('never fails the refresh when the stamp itself fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = await buildApp();
    try {
      const token = await mintRefreshCookie();
      queryMock.mockImplementation(async (sql: string) => {
        if (/last_login_at/.test(sql)) throw new Error('column does not exist');
        return [];
      });
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        cookies: { refreshToken: token },
      });
      expect(res.statusCode).toBe(200);
      // Give the fire-and-forget rejection a tick to land in the catch.
      await new Promise((r) => setTimeout(r, 0));
      expect(warn).toHaveBeenCalledWith(
        '[auth] last_login_at stamp failed',
        expect.objectContaining({ userId: USER_ID }),
      );
    } finally {
      warn.mockRestore();
      await app.close();
    }
  });

  it('is not written when the refresh token is rejected', async () => {
    const app = await buildApp();
    try {
      const token = await mintRefreshCookie();
      txnClientQueryMock.mockImplementation(async (sql: string) => {
        if (/FROM refresh_tokens/.test(sql)) return { rows: [{ token_hash: 'deadbeef', revoked: true }] };
        return { rows: [] };
      });
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        cookies: { refreshToken: token },
      });
      expect(res.statusCode).toBe(401);
      expect(stampCalls()).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});
