/**
 * A guest's notification preferences (guest_push_reminders_enabled). A guest
 * has no email, so with the flag on they may read their preferences and switch
 * push on or off, and nothing else; with it off the routes refuse guests as
 * before. An account is not affected either way.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const queryMock = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
vi.mock('../../db/postgres', () => ({
  query: (...a: unknown[]) => queryMock(...(a as [])),
  queryOne: async (...a: unknown[]) => ((await queryMock(...(a as []))) as unknown[])[0] ?? null,
  withTransaction: async (fn: (client: { query: () => Promise<{ rows: unknown[] }> }) => Promise<unknown>) =>
    fn({ query: async () => ({ rows: [] }) }),
  pgPool: { query: async () => ({ rows: [] }) },
}));

const GUEST_ID = '11111111-2222-4333-8444-555555555555';
const ACCOUNT_ID = '66666666-7777-4888-8999-000000000000';
const REFUSED = { error: 'Guest accounts cannot access this resource' };

describe("a guest's notification preferences", () => {
  let app: FastifyInstance;
  let guestAuth: { authorization: string };
  let accountAuth: { authorization: string };
  let adminConfig: typeof import('../../services/adminConfig');
  const setFlag = (on: boolean) =>
    adminConfig.setAdminConfigCacheForTests({ feature_flags: { guest_push_reminders_enabled: on } });

  beforeAll(async () => {
    adminConfig = await import('../../services/adminConfig');
    const { signAccessToken } = await import('../../utils/jwt');
    guestAuth = { authorization: `Bearer ${signAccessToken({ sub: GUEST_ID, username: 'SwiftFalcon_48213', guest: true, admin: false })}` };
    accountAuth = { authorization: `Bearer ${signAccessToken({ sub: ACCOUNT_ID, username: 'player', guest: false, admin: false })}` };
    const { usersRoutes } = await import('./users.routes');
    app = Fastify();
    await app.register(usersRoutes, { prefix: '/api/users' });
    await app.ready();
  });
  afterAll(() => app.close());
  afterEach(() => {
    adminConfig.resetAdminConfigCacheForTests();
    queryMock.mockClear();
  });

  const get = (headers: { authorization: string }) =>
    app.inject({ method: 'GET', url: '/api/users/me/preferences', headers });
  const put = (headers: { authorization: string }, payload: Record<string, unknown>) =>
    app.inject({ method: 'PUT', url: '/api/users/me/preferences', headers, payload });
  const writes = () => queryMock.mock.calls.filter((c) => String((c as unknown[])[0]).includes('INSERT INTO user_preferences'));

  it('refuses a guest as before with the flag off', async () => {
    setFlag(false);
    const read = await get(guestAuth);
    expect(read.statusCode).toBe(403);
    expect(read.json()).toEqual(REFUSED);
    const write = await put(guestAuth, { push_enabled: false });
    expect(write.statusCode).toBe(403);
    expect(write.json()).toEqual(REFUSED);
    expect(writes()).toHaveLength(0);
  });

  it('lets a guest read them and switch push with the flag on', async () => {
    setFlag(true);
    const read = await get(guestAuth);
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ push_enabled: true });

    queryMock.mockClear();
    const write = await put(guestAuth, { push_enabled: false });
    expect(write.statusCode).toBe(200);
    expect(writes()).toHaveLength(1);
    const [sql, params] = writes()[0] as unknown as [string, unknown[]];
    expect(sql).toContain('push_enabled = $2');
    expect(params).toEqual([GUEST_ID, false]);
  });

  it('refuses a guest any email setting, even alongside push', async () => {
    setFlag(true);
    for (const payload of [
      { email_notifications: true },
      { turn_emails_enabled: false },
      { friend_requests_policy: 'nobody' },
      { push_enabled: true, email_notifications: true },
    ]) {
      const res = await put(guestAuth, payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(403);
    }
    expect(writes()).toHaveLength(0);
  });

  it('leaves an account free to change everything with the flag off', async () => {
    setFlag(false);
    const res = await put(accountAuth, { push_enabled: false, email_notifications: true, turn_emails_enabled: false });
    expect(res.statusCode).toBe(200);
    expect(writes()).toHaveLength(1);
  });
});
