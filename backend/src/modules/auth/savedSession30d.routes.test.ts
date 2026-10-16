/**
 * A saved account keeps the 30-day session too (session_30d_enabled with
 * email_account_save_enabled): saving a guest account and signing in by an
 * emailed link both give 30 days, the same as any other session.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/auth/savedSession30d.routes.test.ts
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

const sendMock = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => true));
vi.mock('../../services/notificationService', () => ({
  sendTransactionalEmailToAddress: (...a: unknown[]) => sendMock(...a),
}));
vi.mock('../../services/analyticsEvents', () => ({ recordServerEvent: vi.fn() }));

const enabled = process.env.PG_TEST === '1';
const DAY_S = 24 * 60 * 60;
type Query = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

describe.runIf(enabled)('saved accounts keep 30-day sessions (Postgres)', { timeout: 20_000 }, () => {
  let app: FastifyInstance;
  let query: Query;
  let adminConfig: typeof import('../../services/adminConfig');
  const userIds: string[] = [];
  const setFlags = (session30d: boolean) =>
    adminConfig.setAdminConfigCacheForTests({
      feature_flags: { session_30d_enabled: session30d, email_account_save_enabled: true },
    });
  /** The refresh cookie's Max-Age, in days. */
  const cookieDays = (setCookie: unknown) => Number(/Max-Age=(\d+)/.exec(String(setCookie))?.[1]) / DAY_S;

  async function savedAccount(): Promise<{ id: string; email: string; saveCookieDays: number }> {
    const guest = await app.inject({ method: 'POST', url: '/api/auth/guest', payload: {} });
    const { accessToken, user } = guest.json();
    userIds.push(user.user_id);
    const email = `saved30_${uuidv4().slice(0, 8)}@test.local`;
    const saved = await app.inject({
      method: 'POST', url: '/api/auth/upgrade', headers: { authorization: `Bearer ${accessToken}` }, payload: { email },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    return { id: user.user_id, email, saveCookieDays: cookieDays(saved.headers['set-cookie']) };
  }

  async function linkSignInCookieDays(email: string): Promise<number> {
    sendMock.mockClear();
    await app.inject({ method: 'POST', url: '/api/auth/sign-in-link', payload: { email } });
    const html = String(sendMock.mock.calls.at(-1)?.[2] ?? '');
    const token = decodeURIComponent(/sign-in-link\?token=([^"]+)"/.exec(html)?.[1] ?? '');
    const res = await app.inject({ method: 'POST', url: '/api/auth/sign-in-link/verify', payload: { token } });
    expect(res.statusCode, res.body).toBe(200);
    return cookieDays(res.headers['set-cookie']);
  }

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as { query: Query });
    adminConfig = await import('../../services/adminConfig');
    const { registerErrorHandler } = await import('../../errorHandler');
    const { default: fastifyCookie } = await import('@fastify/cookie');
    const { config } = await import('../../config');
    const { authRoutes } = await import('./auth.routes');
    app = Fastify();
    registerErrorHandler(app);
    await app.register(fastifyCookie, { secret: config.jwt.refreshSecret });
    await app.register(authRoutes, { prefix: '/api/auth' });
    await app.ready();
  }, 30_000);

  afterEach(() => adminConfig.resetAdminConfigCacheForTests());
  afterAll(async () => {
    if (app) await app.close();
    if (userIds.length) await query('DELETE FROM users WHERE user_id = ANY($1)', [userIds]).catch(() => {});
  });

  it('gives a saved account 30 days when it saves and when it signs in by link', async () => {
    setFlags(true);
    const account = await savedAccount();
    expect(account.saveCookieDays).toBe(30);
    expect(await linkSignInCookieDays(account.email)).toBe(30);
    const rows = await query(
      `SELECT ROUND(EXTRACT(EPOCH FROM (MAX(expires_at) - NOW())) / 86400) AS days FROM refresh_tokens WHERE user_id = $1`,
      [account.id],
    );
    expect(Number(rows[0]!.days)).toBe(30);
  });

  it('keeps 7 days with session_30d_enabled off', async () => {
    setFlags(false);
    const account = await savedAccount();
    expect(account.saveCookieDays).toBe(7);
    expect(await linkSignInCookieDays(account.email)).toBe(7);
  });
});
