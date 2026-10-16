/**
 * Sessions last 30 days (session_30d_enabled). A player who comes back within
 * a month should still be signed in: for a guest the session is the only way
 * back to the account, and a saved account should not be asked to sign in again.
 * With the flag on every session the auth routes issue, and every refresh,
 * gives the refresh token, its refresh_tokens row and the cookie 30 days;
 * with it off they keep 7.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
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

const DAY_S = 24 * 60 * 60;
const USER_ID = '11111111-2222-4333-8444-555555555555';
const PASSWORD = 'Fortress!Wall72';

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

let adminConfig: typeof import('../../services/adminConfig');
const setFlag = (on: boolean) =>
  adminConfig.setAdminConfigCacheForTests({ feature_flags: { session_30d_enabled: on } });

interface Session {
  /** The cookie's Max-Age, in days. */
  cookieDays: number;
  /** The refresh JWT's lifetime, in days. */
  tokenDays: number;
  /** The refresh_tokens row's expiry, in days from now. */
  rowDays: number;
}

const insertedTokenRow = (calls: unknown[][]) =>
  calls.find(([sql]) => /INSERT INTO refresh_tokens/.test(String(sql)))![1] as unknown[];

function sessionOf(setCookie: string, insertParams: unknown[]): Session {
  const maxAge = Number(/Max-Age=(\d+)/.exec(setCookie)?.[1]);
  const token = /refreshToken=([^;]+)/.exec(setCookie)![1]!;
  const { iat, exp } = jwt.decode(token) as { iat: number; exp: number };
  const expiresAt = insertParams[3] as Date;
  return {
    cookieDays: maxAge / DAY_S,
    tokenDays: (exp - iat) / DAY_S,
    rowDays: Math.round((expiresAt.getTime() - Date.now()) / (DAY_S * 1000)),
  };
}

async function post(url: string, payload: unknown, cookies?: Record<string, string>) {
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'POST', url, payload: payload as Record<string, unknown>, cookies });
    expect(res.statusCode, res.body).toBeLessThan(300);
    return String(res.headers['set-cookie']);
  } finally {
    await app.close();
  }
}

async function guestSession(): Promise<Session> {
  queryMock.mockImplementation(async (sql: string, params: unknown[] = []) =>
    (/INSERT INTO users/.test(sql) ? [{ user_id: params[0] }] : []));
  const cookie = await post('/api/auth/guest', {});
  return sessionOf(cookie, insertedTokenRow(queryMock.mock.calls));
}

async function loginSession(): Promise<Session> {
  const password_hash = await bcrypt.hash(PASSWORD, 4);
  queryMock.mockImplementation(async (sql: string) =>
    (/FROM users/.test(sql)
      ? [{ user_id: USER_ID, username: 'ada', password_hash, level: 3, xp: 900, mmr: 1000, is_banned: false, is_admin: false }]
      : []));
  const cookie = await post('/api/auth/login', { email: 'ada', password: PASSWORD });
  return sessionOf(cookie, insertedTokenRow(queryMock.mock.calls));
}

async function registerSession(): Promise<Session> {
  queryMock.mockImplementation(async (sql: string) => {
    if (/INSERT INTO users/.test(sql)) return [{ user_id: USER_ID, username: 'ada_lovelace', level: 1, xp: 0, mmr: 1000, is_admin: false }];
    if (/COUNT\(\*\)/.test(sql)) return [{ count: 0 }];
    return [];
  });
  const cookie = await post('/api/auth/register', { username: 'ada_lovelace', email: 'ada@example.test', password: PASSWORD });
  return sessionOf(cookie, insertedTokenRow(queryMock.mock.calls));
}

async function refreshedSession(isGuest: boolean): Promise<Session> {
  const { signRefreshToken } = await import('../../utils/jwt');
  const token = signRefreshToken({ sub: USER_ID, tokenId: 'tok-1' });
  const tokenHash = createHash('sha256').update(token).digest('hex');
  txnClientQueryMock.mockImplementation(async (sql: string) => {
    if (/FROM refresh_tokens/.test(sql)) return { rows: [{ token_hash: tokenHash, revoked: false }] };
    if (/FROM users/.test(sql)) {
      return { rows: [{ username: 'SwiftFalcon_48213', is_admin: false, is_guest: isGuest, is_banned: false }] };
    }
    return { rows: [] };
  });
  const cookie = await post('/api/auth/refresh', {}, { refreshToken: token });
  return sessionOf(cookie, insertedTokenRow(txnClientQueryMock.mock.calls));
}

const THIRTY: Session = { cookieDays: 30, tokenDays: 30, rowDays: 30 };
const SEVEN: Session = { cookieDays: 7, tokenDays: 7, rowDays: 7 };

describe('sessions last 30 days', () => {
  beforeEach(async () => {
    queryMock.mockReset();
    txnClientQueryMock.mockReset();
    queryMock.mockResolvedValue([]);
    adminConfig = await import('../../services/adminConfig');
  });
  afterEach(() => adminConfig.resetAdminConfigCacheForTests());

  it('gives every new session 30 days with the flag on: guest, login and register', async () => {
    setFlag(true);
    expect(await guestSession()).toEqual(THIRTY);
    expect(await loginSession()).toEqual(THIRTY);
    expect(await registerSession()).toEqual(THIRTY);
  });

  it('renews a guest and an account for 30 days on every refresh', async () => {
    setFlag(true);
    expect(await refreshedSession(true)).toEqual(THIRTY);
    txnClientQueryMock.mockReset();
    expect(await refreshedSession(false)).toEqual(THIRTY);
  });

  it('keeps 7 days everywhere with the flag off', async () => {
    setFlag(false);
    expect(await guestSession()).toEqual(SEVEN);
    expect(await loginSession()).toEqual(SEVEN);
    expect(await registerSession()).toEqual(SEVEN);
    expect(await refreshedSession(true)).toEqual(SEVEN);
  });
});
