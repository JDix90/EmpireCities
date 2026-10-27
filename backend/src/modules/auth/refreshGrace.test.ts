/**
 * A refresh token rotation replaced moments ago still renews the session while
 * its replacement has never been used (session_refresh_grace_enabled). Two
 * requests carrying one cookie, or a retry after a reply that never reached a
 * phone, used to get a 401, which the client reads as signed out.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
vi.mock('../../services/analyticsEvents', () => ({ recordServerEvent: vi.fn() }));

const USER_ID = '11111111-2222-4333-8444-555555555555';
const REPLACEMENT = '99999999-2222-4333-8444-555555555555';

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

interface Row {
  revoked: boolean;
  recently_rotated: boolean | null;
  replaced_by: string | null;
  /** Whether the replacement is still unused (live). */
  replacementLive?: boolean;
}

/** A refresh cookie whose refresh_tokens row looks like `row`. */
async function cookieFor(row: Row): Promise<string> {
  const { signRefreshToken } = await import('../../utils/jwt');
  const token = signRefreshToken({ sub: USER_ID, tokenId: 'tok-1' });
  const tokenHash = createHash('sha256').update(token).digest('hex');
  txnClientQueryMock.mockImplementation(async (sql: string) => {
    if (/FROM refresh_tokens\s+WHERE token_id = \$1 AND user_id = \$2/.test(sql)) {
      return { rows: [{ token_hash: tokenHash, revoked: row.revoked, recently_rotated: row.recently_rotated, replaced_by: row.replaced_by }] };
    }
    if (/SELECT 1 FROM refresh_tokens WHERE token_id = \$1 AND revoked = FALSE/.test(sql)) {
      return { rows: row.replacementLive ? [{ '?column?': 1 }] : [] };
    }
    if (/FROM users/.test(sql)) return { rows: [{ username: 'ada', is_admin: false, is_guest: false, is_banned: false }] };
    return { rows: [] };
  });
  return token;
}

const txnCalls = (re: RegExp) => txnClientQueryMock.mock.calls.filter(([sql]) => re.test(String(sql)));
let adminConfig: typeof import('../../services/adminConfig');
let app: FastifyInstance;

const refresh = (token: string) =>
  app.inject({ method: 'POST', url: '/api/auth/refresh', cookies: { refreshToken: token } });

beforeEach(async () => {
  queryMock.mockReset();
  txnClientQueryMock.mockReset();
  queryMock.mockResolvedValue([]);
  adminConfig = await import('../../services/adminConfig');
  adminConfig.setAdminConfigCacheForTests({ feature_flags: { session_refresh_grace_enabled: true } });
  app = await buildApp();
});

afterEach(async () => {
  await app.close();
});

describe('/refresh grace for a token rotation just replaced', () => {
  it('records when a token is replaced, and by which one', async () => {
    const res = await refresh(await cookieFor({ revoked: false, recently_rotated: null, replaced_by: null }));
    expect(res.statusCode).toBe(200);
    const [retire] = txnCalls(/UPDATE refresh_tokens SET revoked = TRUE, rotated_at = NOW\(\), replaced_by = \$2 WHERE token_id = \$1/);
    const [insert] = txnCalls(/INSERT INTO refresh_tokens/);
    expect(retire![1]).toEqual(['tok-1', (insert![1] as unknown[])[0]]);
  });

  it('renews a token replaced moments ago whose replacement has never been used', async () => {
    const res = await refresh(await cookieFor({
      revoked: true, recently_rotated: true, replaced_by: REPLACEMENT, replacementLive: true,
    }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('accessToken');
    expect(String(res.headers['set-cookie'] ?? '')).toMatch(/refreshToken=ey/);
    // A new token is issued; the retired one keeps pointing at its first replacement.
    expect(txnCalls(/INSERT INTO refresh_tokens/)).toHaveLength(1);
    expect(txnCalls(/UPDATE refresh_tokens/)).toHaveLength(0);
  });

  it('refuses it once the replacement has been used, or revoked by a logout or password change', async () => {
    const res = await refresh(await cookieFor({
      revoked: true, recently_rotated: true, replaced_by: REPLACEMENT, replacementLive: false,
    }));
    expect(res.statusCode).toBe(401);
    expect(txnCalls(/INSERT INTO refresh_tokens/)).toHaveLength(0);
  });

  it('refuses a token replaced longer ago than the grace', async () => {
    const res = await refresh(await cookieFor({
      revoked: true, recently_rotated: false, replaced_by: REPLACEMENT, replacementLive: true,
    }));
    expect(res.statusCode).toBe(401);
    expect(txnCalls(/SELECT 1 FROM refresh_tokens/)).toHaveLength(0);
  });

  it('refuses a token revoked without rotation (logout, password change, ban)', async () => {
    const res = await refresh(await cookieFor({ revoked: true, recently_rotated: null, replaced_by: null }));
    expect(res.statusCode).toBe(401);
  });

  it('refuses every revoked token with the kill switch off', async () => {
    adminConfig.setAdminConfigCacheForTests({ feature_flags: { session_refresh_grace_enabled: false } });
    const res = await refresh(await cookieFor({
      revoked: true, recently_rotated: true, replaced_by: REPLACEMENT, replacementLive: true,
    }));
    expect(res.statusCode).toBe(401);
  });
});
