/**
 * A guest deletes their own account (guest_account_deletion_enabled): through
 * DELETE /api/users/me, confirming by name, never by password; with the switch
 * off, guests are refused as before, and accounts delete as before either way.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/users/guestDelete.db.test.ts
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('../../services/analyticsEvents', () => ({ recordServerEvent: vi.fn() }));

const enabled = process.env.PG_TEST === '1';
type Query = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

describe.runIf(enabled)('a guest deletes their own account (Postgres)', { timeout: 20_000 }, () => {
  let authApp: FastifyInstance;
  let usersApp: FastifyInstance;
  let query: Query;
  let adminConfig: typeof import('../../services/adminConfig');
  const userIds: string[] = [];
  const setFlag = (on: boolean) =>
    adminConfig.setAdminConfigCacheForTests({ feature_flags: { guest_account_deletion_enabled: on } });

  async function newGuest(): Promise<{ id: string; username: string; auth: { authorization: string } }> {
    const res = await authApp.inject({ method: 'POST', url: '/api/auth/guest', payload: {} });
    expect(res.statusCode).toBe(200);
    const { accessToken, user } = res.json();
    userIds.push(user.user_id);
    return { id: user.user_id, username: user.username, auth: { authorization: `Bearer ${accessToken}` } };
  }
  const del = (auth: { authorization: string }, payload: Record<string, unknown>) =>
    usersApp.inject({ method: 'DELETE', url: '/api/users/me', headers: auth, payload });
  const exists = async (id: string) => (await query('SELECT 1 FROM users WHERE user_id = $1', [id])).length === 1;

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as { query: Query });
    adminConfig = await import('../../services/adminConfig');
    const { registerErrorHandler } = await import('../../errorHandler');
    const { default: fastifyCookie } = await import('@fastify/cookie');
    const { config } = await import('../../config');
    const { authRoutes } = await import('../auth/auth.routes');
    const { usersRoutes } = await import('./users.routes');
    authApp = Fastify();
    registerErrorHandler(authApp);
    await authApp.register(fastifyCookie, { secret: config.jwt.refreshSecret });
    await authApp.register(authRoutes, { prefix: '/api/auth' });
    await authApp.ready();
    usersApp = Fastify();
    registerErrorHandler(usersApp);
    await usersApp.register(fastifyCookie, { secret: config.jwt.refreshSecret });
    await usersApp.register(usersRoutes, { prefix: '/api/users' });
    await usersApp.ready();
  }, 30_000);

  afterEach(() => adminConfig.resetAdminConfigCacheForTests());

  afterAll(async () => {
    if (authApp) await authApp.close();
    if (usersApp) await usersApp.close();
    if (userIds.length) await query('DELETE FROM users WHERE user_id = ANY($1)', [userIds]).catch(() => {});
  });

  it('deletes a guest who types their name, and signs them out', async () => {
    setFlag(true);
    const guest = await newGuest();
    expect((await del(guest.auth, { confirm_username: 'someone_else' })).statusCode).toBe(401);
    expect(await exists(guest.id)).toBe(true);
    const res = await del(guest.auth, { confirm_username: `  ${guest.username.toUpperCase()} ` });
    expect(res.statusCode, res.body).toBe(200);
    expect(await exists(guest.id)).toBe(false);
    // The refresh cookie is cleared.
    expect(String(res.headers['set-cookie'] ?? '')).toMatch(/refreshToken=;/);
  });

  it('never takes a password from a guest, and asks for the name instead', async () => {
    setFlag(true);
    const guest = await newGuest();
    const res = await del(guest.auth, { password: 'anything-at-all' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Type your username to confirm');
    expect(await exists(guest.id)).toBe(true);
  });

  it('refuses guests with the switch off, as before', async () => {
    setFlag(false);
    const guest = await newGuest();
    expect((await del(guest.auth, { confirm_username: guest.username })).statusCode).toBe(403);
    expect(await exists(guest.id)).toBe(true);
  });

  it('keeps an account with a password deleting by password only, whatever the switch', async () => {
    for (const on of [true, false]) {
      setFlag(on);
      const guest = await newGuest();
      const saved = await authApp.inject({
        method: 'POST', url: '/api/auth/upgrade', headers: guest.auth,
        payload: { email: `gdel_${guest.id.slice(0, 8)}@test.local`, username: `gdel_${guest.id.slice(0, 8)}`, password: 'Fortress!Wall72' },
      });
      expect(saved.statusCode, saved.body).toBe(200);
      const auth = { authorization: `Bearer ${saved.json().accessToken}` };
      expect((await del(auth, { confirm_username: `gdel_${guest.id.slice(0, 8)}` })).statusCode).toBe(400);
      expect((await del(auth, { password: 'wrong-password' })).statusCode).toBe(401);
      expect((await del(auth, { password: 'Fortress!Wall72' })).statusCode).toBe(200);
      expect(await exists(guest.id)).toBe(false);
    }
  });
});
