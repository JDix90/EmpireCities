/**
 * A guest shares their own finished game (guest_replay_sharing_enabled).
 * Recording a share, making the replay public and making it private again
 * refused every guest, while the results screen offered guests Share, so a
 * guest's link opened on "This replay isn't public". With the flag on a guest
 * who played in the game gets through; with it off they are refused as before;
 * either way nobody shares a game they did not play in.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const db = vi.hoisted(() => ({
  participant: true,
  updates: [] as Array<{ sql: string; params: unknown[] }>,
}));

const run = async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
  if (/^\s*(UPDATE|INSERT)/i.test(sql)) {
    db.updates.push({ sql, params });
    return [];
  }
  if (sql.includes('FROM games')) return [{ game_id: params[0], status: 'completed', era_id: 'medieval' }];
  if (sql.includes('FROM game_players')) return db.participant ? [{ user_id: params[1] }] : [];
  if (sql.includes('FROM users')) return [{ username: 'SwiftFalcon_48213' }];
  return [];
};

vi.mock('../../db/postgres', () => ({
  query: (sql: string, params?: unknown[]) => run(sql, params),
  queryOne: async (sql: string, params?: unknown[]) => (await run(sql, params))[0] ?? null,
}));
vi.mock('../../services/activityService', () => ({ recordActivity: vi.fn(async () => {}) }));

const GUEST_ID = '11111111-2222-4333-8444-555555555555';
const GAME_ID = '99999999-8888-4777-8666-555555555555';

const ROUTES: Array<{ url: string; payload?: Record<string, unknown> }> = [
  { url: `/api/share/${GAME_ID}`, payload: { platform: 'clipboard' } },
  { url: `/api/share/${GAME_ID}/make-public` },
  { url: `/api/share/${GAME_ID}/make-private` },
];

describe('a guest sharing their own game', () => {
  let app: FastifyInstance;
  let guestAuth: { authorization: string };
  let adminConfig: typeof import('../../services/adminConfig');
  const setFlag = (on: boolean) =>
    adminConfig.setAdminConfigCacheForTests({ feature_flags: { guest_replay_sharing_enabled: on } });

  beforeAll(async () => {
    adminConfig = await import('../../services/adminConfig');
    const { signAccessToken } = await import('../../utils/jwt');
    guestAuth = { authorization: `Bearer ${signAccessToken({ sub: GUEST_ID, username: 'SwiftFalcon_48213', guest: true, admin: false })}` };
    const { shareRoutes } = await import('./share.routes');
    app = Fastify();
    await app.register(shareRoutes, { prefix: '/api/share' });
    await app.ready();
  });
  afterAll(() => app.close());
  beforeEach(() => {
    db.participant = true;
    db.updates.length = 0;
  });
  afterEach(() => adminConfig.resetAdminConfigCacheForTests());

  const post = (route: { url: string; payload?: Record<string, unknown> }) =>
    app.inject({ method: 'POST', url: route.url, headers: guestAuth, payload: route.payload ?? {} });

  it('lets a guest who played make the replay public, so the link they hand out opens', async () => {
    setFlag(true);
    const res = await post(ROUTES[1]!);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, public_url: `/replay/${GAME_ID}` });
    expect(db.updates.some((u) => u.sql.includes('is_replay_public = true') && u.params[0] === GAME_ID)).toBe(true);
  });

  it('lets them record a share and make the replay private again', async () => {
    setFlag(true);
    expect((await post(ROUTES[0]!)).statusCode).toBe(200);
    expect(db.updates.some((u) => u.sql.includes('INSERT INTO game_shares'))).toBe(true);
    expect((await post(ROUTES[2]!)).statusCode).toBe(200);
    expect(db.updates.some((u) => u.sql.includes('is_replay_public = false'))).toBe(true);
  });

  it('refuses a guest as before with the flag off', async () => {
    setFlag(false);
    for (const route of ROUTES) {
      const res = await post(route);
      expect(res.statusCode, route.url).toBe(403);
      expect(res.json()).toEqual({ error: 'Guest accounts cannot access this resource' });
    }
    expect(db.updates).toEqual([]);
  });

  it('never lets a guest share a game they did not play in', async () => {
    setFlag(true);
    db.participant = false;
    for (const route of ROUTES) {
      const res = await post(route);
      expect(res.statusCode, route.url).toBe(403);
      expect(res.json()).toEqual({ error: 'Not a participant' });
    }
    expect(db.updates).toEqual([]);
  });
});
