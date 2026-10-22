/**
 * A guest's own things (guest_personal_features_enabled): their achievements,
 * their unlocked cosmetics and their tutorial progress. Each of these routes
 * refused every guest; with the flag on a guest gets through, and with it off
 * the route refuses guests as before. Social and spending routes stay closed.
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

/** The guest's own routes, each with a body it accepts. */
const PERSONAL: Array<{ method: 'GET' | 'PUT' | 'POST'; url: string; payload?: Record<string, unknown> }> = [
  { method: 'GET', url: '/api/users/me/achievements' },
  { method: 'GET', url: '/api/users/me/achievements/progress' },
  { method: 'GET', url: '/api/users/me/cosmetics' },
  { method: 'PUT', url: '/api/users/me/cosmetics/equip', payload: {} },
  { method: 'POST', url: '/api/users/me/tutorial-modules/core' },
];

/**
 * Routes that still need an account whatever the flag says. Notification
 * settings are left out: guest_push_reminders_enabled decides those
 * (guestPreferencesRoutes.test.ts).
 */
const ACCOUNT_ONLY: Array<{ method: 'GET' | 'PUT'; url: string; payload?: Record<string, unknown> }> = [
  { method: 'GET', url: '/api/users/me/friends' },
  { method: 'GET', url: '/api/users/me/game-invites' },
];

describe('a guest\'s own things', () => {
  let app: FastifyInstance;
  let guestAuth: { authorization: string };
  let adminConfig: typeof import('../../services/adminConfig');
  const setFlag = (on: boolean) =>
    adminConfig.setAdminConfigCacheForTests({ feature_flags: { guest_personal_features_enabled: on } });

  beforeAll(async () => {
    adminConfig = await import('../../services/adminConfig');
    const { signAccessToken } = await import('../../utils/jwt');
    guestAuth = { authorization: `Bearer ${signAccessToken({ sub: GUEST_ID, username: 'SwiftFalcon_48213', guest: true, admin: false })}` };
    const { usersRoutes } = await import('./users.routes');
    app = Fastify();
    await app.register(usersRoutes, { prefix: '/api/users' });
    await app.ready();
  });
  afterAll(() => app.close());
  afterEach(() => adminConfig.resetAdminConfigCacheForTests());

  const call = (route: { method: string; url: string; payload?: Record<string, unknown> }) =>
    app.inject({ method: route.method as 'GET', url: route.url, headers: guestAuth, payload: route.payload });

  it('lets a guest reach them with the flag on', async () => {
    setFlag(true);
    for (const route of PERSONAL) {
      // Past the guest gate: the handler answers (the mocked database has no rows,
      // so equip's own 404 for a missing account counts as getting through).
      const res = await call(route);
      expect(res.statusCode, `${route.method} ${route.url}`).not.toBe(403);
    }
  });

  it('refuses a guest as before with the flag off', async () => {
    setFlag(false);
    for (const route of PERSONAL) {
      const res = await call(route);
      expect(res.statusCode, `${route.method} ${route.url}`).toBe(403);
      expect(res.json()).toEqual({ error: 'Guest accounts cannot access this resource' });
    }
  });

  it('keeps friends and invites account-only with the flag on', async () => {
    setFlag(true);
    for (const route of ACCOUNT_ONLY) {
      expect((await call(route)).statusCode, `${route.method} ${route.url}`).toBe(403);
    }
  });
});
