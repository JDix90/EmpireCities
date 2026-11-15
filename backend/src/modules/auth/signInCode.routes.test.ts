/**
 * The code in a sign-in email (sign_in_code_enabled), against Postgres and
 * Redis and the real auth routes: it signs in once, with the address it was
 * sent to, and spends the same one-time row as the link in the same email.
 *
 * Needs Postgres (migrated schema) and Redis, gated on PG_TEST=1 and REDIS_TEST=1:
 *   PG_TEST=1 REDIS_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/auth/signInCode.routes.test.ts
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

const sendMock = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => true));
vi.mock('../../services/notificationService', () => ({
  sendTransactionalEmailToAddress: (...a: unknown[]) => sendMock(...a),
}));

const enabled = process.env.PG_TEST === '1' && process.env.REDIS_TEST === '1';
type Query = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

describe.runIf(enabled)('the code in a sign-in email (Postgres + Redis)', { timeout: 30_000 }, () => {
  let app: FastifyInstance;
  let query: Query;
  let adminConfig: typeof import('../../services/adminConfig');
  let quitRedis: () => Promise<unknown>;
  const userIds: string[] = [];
  const stamp = () => uuidv4().slice(0, 8);
  const setFlags = (codes: boolean) =>
    adminConfig.setAdminConfigCacheForTests({
      feature_flags: { email_account_save_enabled: true, sign_in_code_enabled: codes },
    });

  /** A saved, passwordless account: a guest who saved with just an email. */
  async function savedAccount(): Promise<{ id: string; username: string; email: string }> {
    const guest = await app.inject({ method: 'POST', url: '/api/auth/guest', payload: {} });
    const { accessToken, user } = guest.json();
    userIds.push(user.user_id);
    const email = `code_${stamp()}@test.local`;
    const saved = await app.inject({
      method: 'POST', url: '/api/auth/upgrade', headers: { authorization: `Bearer ${accessToken}` }, payload: { email },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    await vi.waitFor(() => expect(sendMock).toHaveBeenCalled());
    sendMock.mockClear();
    return { id: user.user_id, username: user.username, email };
  }
  const lastEmail = () => String(sendMock.mock.calls.at(-1)?.[2] ?? '');
  const emailedCode = () => /<strong>([A-Z2-9]{4}-[A-Z2-9]{4})<\/strong>/.exec(lastEmail())?.[1] ?? '';
  const emailedToken = () => decodeURIComponent(/sign-in-link\?token=([^"]+)"/.exec(lastEmail())?.[1] ?? '');
  const requestLink = (email: string) =>
    app.inject({ method: 'POST', url: '/api/auth/sign-in-link', payload: { email } });
  const useCode = (email: string, code: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url: '/api/auth/sign-in-link/verify-code', headers, payload: { email, code } });
  const useLink = (token: string) =>
    app.inject({ method: 'POST', url: '/api/auth/sign-in-link/verify', payload: { token } });

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as { query: Query });
    adminConfig = await import('../../services/adminConfig');
    const { redis } = await import('../../db/redis');
    quitRedis = () => redis.quit();
    const { registerErrorHandler } = await import('../../errorHandler');
    const { default: fastifyCookie } = await import('@fastify/cookie');
    const { config } = await import('../../config');
    (config as { nativeAppOrigins: string[] }).nativeAppOrigins = ['capacitor://localhost'];
    const { authRoutes } = await import('./auth.routes');
    app = Fastify();
    registerErrorHandler(app);
    await app.register(fastifyCookie, { secret: config.jwt.refreshSecret });
    await app.register(authRoutes, { prefix: '/api/auth' });
    await app.ready();
  }, 30_000);

  afterEach(() => {
    adminConfig.resetAdminConfigCacheForTests();
    sendMock.mockClear();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (userIds.length) await query('DELETE FROM users WHERE user_id = ANY($1)', [userIds]).catch(() => {});
    await quitRedis?.().catch(() => {});
  });

  it('puts a code in the email beside the link, and signs in with the address and the code', async () => {
    setFlags(true);
    const account = await savedAccount();
    await requestLink(account.email);
    expect(lastEmail()).toContain('sign-in-link?token=');
    expect(lastEmail()).toContain('Type this code where you asked for the link');
    const code = emailedCode();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const res = await useCode(account.email, code);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().user).toMatchObject({ user_id: account.id, username: account.username });
    expect(res.json().accessToken).toEqual(expect.any(String));
    // A browser gets its cookie, as with the link.
    expect(String(res.headers['set-cookie'])).toMatch(/refreshToken=/);
    expect(res.json().refreshToken).toBeUndefined();
  });

  it('is read however it is typed', async () => {
    setFlags(true);
    const account = await savedAccount();
    await requestLink(account.email);
    const typed = ` ${emailedCode().replace('-', ' ').toLowerCase()} `;
    expect((await useCode(account.email.toUpperCase(), typed)).statusCode).toBe(200);
  });

  it('works once, and takes the link in the same email with it', async () => {
    setFlags(true);
    const account = await savedAccount();
    await requestLink(account.email);
    const code = emailedCode();
    const token = emailedToken();
    expect((await useCode(account.email, code)).statusCode).toBe(200);
    expect((await useCode(account.email, code)).statusCode).toBe(400);
    expect((await useLink(token)).statusCode).toBe(400);
  });

  it('stops working once the link in the same email has been used', async () => {
    setFlags(true);
    const account = await savedAccount();
    await requestLink(account.email);
    const code = emailedCode();
    expect((await useLink(emailedToken())).statusCode).toBe(200);
    const res = await useCode(account.email, code);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('That code did not work. Check it against the email, or request a new one.');
  });

  it('is replaced by asking again', async () => {
    setFlags(true);
    const account = await savedAccount();
    await requestLink(account.email);
    const first = emailedCode();
    await requestLink(account.email);
    const second = emailedCode();
    expect(second).not.toBe(first);
    expect((await useCode(account.email, first)).statusCode).toBe(400);
    expect((await useCode(account.email, second)).statusCode).toBe(200);
  });

  it('is no use with a different address, or made up', async () => {
    setFlags(true);
    const account = await savedAccount();
    const other = await savedAccount();
    await requestLink(account.email);
    const code = emailedCode();
    expect((await useCode(other.email, code)).statusCode).toBe(400);
    expect((await useCode(account.email, 'ZZZZ-ZZZZ')).statusCode).toBe(400);
    expect((await useCode(account.email, 'not a code')).statusCode).toBe(400);
    expect((await useCode('not-an-email', code)).statusCode).toBe(400);
    // None of that spent it.
    expect((await useCode(account.email, code)).statusCode).toBe(200);
  });

  it('locks an address after ten tries, so the code cannot be guessed', async () => {
    setFlags(true);
    const account = await savedAccount();
    await requestLink(account.email);
    const code = emailedCode();
    for (let i = 0; i < 10; i += 1) {
      expect((await useCode(account.email, 'ZZZZ-ZZZZ')).statusCode).toBe(400);
    }
    const locked = await useCode(account.email, code);
    expect(locked.statusCode).toBe(429);
    // The link in the email is still a way in.
    expect((await useLink(emailedToken())).statusCode).toBe(200);
  });

  it('hands the native app its session in the body, like every other sign-in', async () => {
    setFlags(true);
    const account = await savedAccount();
    await requestLink(account.email);
    const res = await useCode(account.email, emailedCode(), { origin: 'capacitor://localhost' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().refreshToken).toEqual(expect.any(String));
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  describe('with the flag off', () => {
    it('sends the email it always sent, with no code, and has no code endpoint', async () => {
      setFlags(false);
      const account = await savedAccount();
      await requestLink(account.email);
      expect(lastEmail()).toBe(
        `<p><a href="${/href="([^"]+)"/.exec(lastEmail())![1]}">Sign in to Borderfall as ${account.username}</a></p>\n`
        + '      <p>This link works once and expires in 30 minutes. If you did not ask for it, you can ignore this email.</p>',
      );
      expect((await useCode(account.email, 'ABCD-EFGH')).statusCode).toBe(404);
      // The link works as before.
      expect((await useLink(emailedToken())).statusCode).toBe(200);
    });
  });
});
