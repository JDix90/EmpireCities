/**
 * Save your account with just an email (email_account_save_enabled, migration 050).
 *
 * A guest saves their account with an email and no password; that account
 * signs in with a one-time link emailed to it, can set a password later, and
 * confirms its own deletion by name. With the flag off the save form still needs
 * a password and the sign-in link routes do not exist.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/auth/emailSave.routes.test.ts
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
type Query = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

describe.runIf(enabled)('save your account with just an email (Postgres)', { timeout: 20_000 }, () => {
  let app: FastifyInstance;
  let usersApp: FastifyInstance;
  let query: Query;
  let adminConfig: typeof import('../../services/adminConfig');
  const userIds: string[] = [];
  const stamp = () => uuidv4().slice(0, 8);
  const setFlag = (on: boolean) =>
    adminConfig.setAdminConfigCacheForTests({ feature_flags: { email_account_save_enabled: on } });

  async function newGuest(): Promise<{ id: string; username: string; auth: { authorization: string } }> {
    const res = await app.inject({ method: 'POST', url: '/api/auth/guest', payload: {} });
    expect(res.statusCode).toBe(200);
    const { accessToken, user } = res.json();
    userIds.push(user.user_id);
    return { id: user.user_id, username: user.username, auth: { authorization: `Bearer ${accessToken}` } };
  }
  const save = (guest: { auth: { authorization: string } }, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/auth/upgrade', headers: guest.auth, payload });
  const row = async (id: string) =>
    (await query('SELECT username, email, is_guest, has_password FROM users WHERE user_id = $1', [id]))[0];
  /** The sign-in token in the last email sent. */
  const lastEmailedToken = () => {
    const html = String(sendMock.mock.calls.at(-1)?.[2] ?? '');
    return decodeURIComponent(/sign-in-link\?token=([^"]+)"/.exec(html)?.[1] ?? '');
  };
  const requestLink = (email: string) =>
    app.inject({ method: 'POST', url: '/api/auth/sign-in-link', payload: { email } });
  const redeem = (token: string) =>
    app.inject({ method: 'POST', url: '/api/auth/sign-in-link/verify', payload: { token } });

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
    const { usersRoutes } = await import('../users/users.routes');
    usersApp = Fastify();
    registerErrorHandler(usersApp);
    await usersApp.register(fastifyCookie, { secret: config.jwt.refreshSecret });
    await usersApp.register(usersRoutes, { prefix: '/api/users' });
    await usersApp.ready();
  }, 30_000);

  afterEach(() => {
    adminConfig.resetAdminConfigCacheForTests();
    sendMock.mockClear();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (usersApp) await usersApp.close();
    if (userIds.length) await query('DELETE FROM users WHERE user_id = ANY($1)', [userIds]).catch(() => {});
  });

  it('saves a guest with just an email, keeping their name, and emails them where it lives', async () => {
    setFlag(true);
    const guest = await newGuest();
    const email = `save_${stamp()}@test.local`;

    const res = await save(guest, { email });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().user).toMatchObject({ username: guest.username, is_guest: false, has_password: false });
    expect(await row(guest.id)).toEqual({ username: guest.username, email, is_guest: false, has_password: false });
    await vi.waitFor(() => expect(sendMock).toHaveBeenCalledWith(email, 'Your Borderfall account is saved', expect.any(String)));
    expect(String(sendMock.mock.calls[0]![2])).toContain('no password needed');
    expect(String(sendMock.mock.calls[0]![2])).not.toContain('token=');

    // No password opens it: the guest's random one is not one anybody knows.
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'anything-at-all' } });
    expect(login.statusCode).toBe(401);
  });

  it('signs a passwordless account in with an emailed link, once', async () => {
    setFlag(true);
    const guest = await newGuest();
    const email = `link_${stamp()}@test.local`;
    expect((await save(guest, { email })).statusCode).toBe(200);
    await vi.waitFor(() => expect(sendMock).toHaveBeenCalled());
    sendMock.mockClear();

    const asked = await requestLink(email);
    expect(asked.json()).toEqual({ message: 'If an account exists for that email, we sent a sign-in link.' });
    expect(sendMock).toHaveBeenCalledWith(email, 'Your Borderfall sign-in link', expect.stringContaining(`as ${guest.username}`));
    const token = lastEmailedToken();
    expect(token.length).toBeGreaterThan(20);

    const signedIn = await redeem(token);
    expect(signedIn.statusCode, signedIn.body).toBe(200);
    expect(signedIn.json().user).toMatchObject({ user_id: guest.id, username: guest.username });
    expect(signedIn.json().accessToken).toEqual(expect.any(String));
    expect(String(signedIn.headers['set-cookie'])).toMatch(/refreshToken=/);

    expect((await redeem(token)).statusCode).toBe(400);
  });

  it('refuses an expired link, and answers the same for an address with no account', async () => {
    setFlag(true);
    const guest = await newGuest();
    const email = `expired_${stamp()}@test.local`;
    expect((await save(guest, { email })).statusCode).toBe(200);
    await requestLink(email);
    const token = lastEmailedToken();
    await query(`UPDATE sign_in_link_tokens SET expires_at = NOW() - INTERVAL '1 minute' WHERE user_id = $1`, [guest.id]);
    expect((await redeem(token)).json()).toEqual({
      error: 'This sign-in link has expired or was already used. Request a new one.',
    });

    sendMock.mockClear();
    const nobody = await requestLink(`nobody_${stamp()}@test.local`);
    expect(nobody.json()).toEqual({ message: 'If an account exists for that email, we sent a sign-in link.' });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('takes a password when the guest gives one, and a new name', async () => {
    setFlag(true);
    const guest = await newGuest();
    const email = `withpw_${stamp()}@test.local`;
    const username = `saved_${stamp()}`;
    const res = await save(guest, { email, username, password: 'Fortress!Wall72' });
    expect(res.statusCode, res.body).toBe(200);
    expect(await row(guest.id)).toMatchObject({ username, has_password: true });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: username, password: 'Fortress!Wall72' } });
    expect(login.statusCode).toBe(200);
  });

  it('lets a passwordless account set a password once, then sign in with it', async () => {
    setFlag(true);
    const guest = await newGuest();
    const email = `setpw_${stamp()}@test.local`;
    const saved = await save(guest, { email });
    const auth = { authorization: `Bearer ${saved.json().accessToken}` };

    const me = await usersApp.inject({ method: 'GET', url: '/api/users/me', headers: auth });
    expect(me.json().has_password).toBe(false);

    const set = await app.inject({ method: 'POST', url: '/api/auth/set-password', headers: auth, payload: { new_password: 'Fortress!Wall72' } });
    expect(set.statusCode, set.body).toBe(200);
    expect(await row(guest.id)).toMatchObject({ has_password: true });
    expect((await usersApp.inject({ method: 'GET', url: '/api/users/me', headers: auth })).json().has_password).toBe(true);

    const again = await app.inject({ method: 'POST', url: '/api/auth/set-password', headers: auth, payload: { new_password: 'Another!Wall93' } });
    expect(again.statusCode).toBe(409);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: guest.username, password: 'Fortress!Wall72' } });
    expect(login.statusCode).toBe(200);
  });

  it('lets a passwordless account delete itself by typing its name', async () => {
    setFlag(true);
    const guest = await newGuest();
    const saved = await save(guest, { email: `delete_${stamp()}@test.local` });
    const auth = { authorization: `Bearer ${saved.json().accessToken}` };

    const wrong = await usersApp.inject({ method: 'DELETE', url: '/api/users/me', headers: auth, payload: { confirm_username: 'someone_else' } });
    expect(wrong.statusCode).toBe(401);
    const right = await usersApp.inject({
      method: 'DELETE', url: '/api/users/me', headers: auth, payload: { confirm_username: guest.username.toLowerCase() },
    });
    expect(right.statusCode, right.body).toBe(200);
    expect(await query('SELECT 1 FROM users WHERE user_id = $1', [guest.id])).toHaveLength(0);
  });

  it('keeps a password account deleting by password only', async () => {
    setFlag(true);
    const guest = await newGuest();
    const saved = await save(guest, { email: `pwdelete_${stamp()}@test.local`, password: 'Fortress!Wall72' });
    const auth = { authorization: `Bearer ${saved.json().accessToken}` };
    const byName = await usersApp.inject({ method: 'DELETE', url: '/api/users/me', headers: auth, payload: { confirm_username: guest.username } });
    expect(byName.statusCode).toBe(400);
    expect(await query('SELECT 1 FROM users WHERE user_id = $1', [guest.id])).toHaveLength(1);
  });

  it('is the save form and routes as before with the flag off', async () => {
    setFlag(false);
    const guest = await newGuest();
    const email = `off_${stamp()}@test.local`;
    expect((await save(guest, { email })).statusCode).toBe(400);
    expect((await requestLink(email)).statusCode).toBe(404);
    expect((await redeem('anything')).statusCode).toBe(404);

    const saved = await save(guest, { email, username: `off_${stamp()}`, password: 'Fortress!Wall72' });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().user).not.toHaveProperty('has_password');
    expect(sendMock).not.toHaveBeenCalled();
    const auth = { authorization: `Bearer ${saved.json().accessToken}` };
    expect((await usersApp.inject({ method: 'GET', url: '/api/users/me', headers: auth })).json()).not.toHaveProperty('has_password');
  });
});
