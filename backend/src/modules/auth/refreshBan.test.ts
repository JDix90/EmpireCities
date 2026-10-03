/**
 * A ban ends the session, not just the next login. Returning players never hit
 * /login: the access token lives in memory only, so every page load goes
 * through /refresh. Before this, /refresh never read `is_banned`, so a banned
 * player with a live cookie rotated their way back in on every visit.
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

/** A valid, unrevoked refresh cookie for USER_ID, whose account row says `banned`. */
async function mintRefreshCookie(banned: boolean): Promise<string> {
  const { signRefreshToken } = await import('../../utils/jwt');
  const token = signRefreshToken({ sub: USER_ID, tokenId: 'tok-1' });
  const tokenHash = createHash('sha256').update(token).digest('hex');
  txnClientQueryMock.mockImplementation(async (sql: string) => {
    if (/FROM refresh_tokens/.test(sql)) return { rows: [{ token_hash: tokenHash, revoked: false }] };
    if (/FROM users/.test(sql)) {
      return { rows: [{ username: 'ada', is_admin: false, is_guest: false, is_banned: banned }] };
    }
    return { rows: [] };
  });
  return token;
}

const txnCalls = (re: RegExp) => txnClientQueryMock.mock.calls.filter(([sql]) => re.test(String(sql)));

beforeEach(() => {
  queryMock.mockReset();
  txnClientQueryMock.mockReset();
  queryMock.mockResolvedValue([]);
});

describe('/refresh and bans', () => {
  it('refuses a banned account, revokes all its tokens and clears the cookie', async () => {
    const app = await buildApp();
    try {
      const token = await mintRefreshCookie(true);
      const res = await app.inject({ method: 'POST', url: '/api/auth/refresh', cookies: { refreshToken: token } });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'Account is banned' });
      // Every token the account holds, not only the one presented.
      const revokeAll = txnCalls(/UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = \$1/);
      expect(revokeAll).toHaveLength(1);
      expect(revokeAll[0]![1]).toEqual([USER_ID]);
      // No replacement token is minted.
      expect(txnCalls(/INSERT INTO refresh_tokens/)).toHaveLength(0);
      const setCookie = String(res.headers['set-cookie'] ?? '');
      expect(setCookie).toMatch(/refreshToken=;/);
    } finally {
      await app.close();
    }
  });

  it('still rotates for an account in good standing', async () => {
    const app = await buildApp();
    try {
      const token = await mintRefreshCookie(false);
      const res = await app.inject({ method: 'POST', url: '/api/auth/refresh', cookies: { refreshToken: token } });

      expect(res.statusCode).toBe(200);
      expect(res.json().accessToken).toEqual(expect.any(String));
      expect(txnCalls(/INSERT INTO refresh_tokens/)).toHaveLength(1);
      expect(txnCalls(/WHERE user_id = \$1 AND revoked = FALSE/)).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});
