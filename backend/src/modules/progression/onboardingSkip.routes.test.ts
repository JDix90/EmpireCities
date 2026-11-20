/**
 * POST /progression/onboarding/skip and what GET /progression/quests says of
 * it (quest_banner_skip_enabled).
 *
 * The rows here are the ones the server holds. A player's onboarding_stage is
 * 0 from the day the account is made and finishing the tutorial leaves it at
 * 0, which is why the route's "Complete the tutorial before skipping" refused
 * everyone.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const db = vi.hoisted(() => ({
  /** users.onboarding_stage by user id; a missing id is a deleted account. */
  stage: new Map<string, number>(),
  updates: [] as Array<{ sql: string; params: unknown[] }>,
}));
const run = async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
  if (sql.startsWith('UPDATE users SET onboarding_stage')) {
    db.updates.push({ sql, params });
    const [userId, stage] = params as [string, number];
    if (db.stage.has(userId)) db.stage.set(userId, stage);
    return [];
  }
  if (sql.includes('FROM users WHERE user_id')) {
    const stage = db.stage.get(params[0] as string);
    return stage === undefined ? [] : [{ onboarding_stage: stage }];
  }
  // user_quests: nothing completed.
  return [];
};
vi.mock('../../db/postgres', () => ({
  query: (sql: string, params?: unknown[]) => run(sql, params),
  queryOne: async (sql: string, params?: unknown[]) => (await run(sql, params))[0] ?? null,
  withTransaction: async () => undefined,
}));

const PLAYER_ID = '11111111-2222-4333-8444-555555555555';
const GUEST_ID = '66666666-7777-4888-8999-000000000000';
const GONE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('onboarding skip', () => {
  let app: FastifyInstance;
  let player: { authorization: string };
  let guest: { authorization: string };
  let gone: { authorization: string };
  let adminConfig: typeof import('../../services/adminConfig');
  const setFlag = (on: boolean) => adminConfig.setAdminConfigCacheForTests({ feature_flags: { quest_banner_skip_enabled: on } });
  const skip = (headers: { authorization: string }) =>
    app.inject({ method: 'POST', url: '/api/progression/onboarding/skip', headers });
  const quests = (headers: { authorization: string }) =>
    app.inject({ method: 'GET', url: '/api/progression/quests', headers });

  beforeAll(async () => {
    adminConfig = await import('../../services/adminConfig');
    const { signAccessToken } = await import('../../utils/jwt');
    const bearer = (sub: string, username: string, isGuest: boolean) => ({
      authorization: `Bearer ${signAccessToken({ sub, username, guest: isGuest, admin: false })}`,
    });
    player = bearer(PLAYER_ID, 'commander', false);
    guest = bearer(GUEST_ID, 'SwiftFalcon_48213', true);
    gone = bearer(GONE_ID, 'deleted', false);
    const { progressionRoutes } = await import('./progression.routes');
    app = Fastify();
    await app.register(progressionRoutes, { prefix: '/api/progression' });
    await app.ready();
  });
  afterAll(() => app.close());
  beforeEach(() => {
    db.stage.clear();
    db.stage.set(PLAYER_ID, 0);
    db.stage.set(GUEST_ID, 0);
    db.updates.length = 0;
  });
  afterEach(() => adminConfig.resetAdminConfigCacheForTests());

  describe('with quest_banner_skip_enabled', () => {
    beforeEach(() => setFlag(true));

    it('lets a player at stage 0 skip, and stores it', async () => {
      const res = await skip(player);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ onboarding_stage: 3 });
      expect(db.updates).toHaveLength(1);
      expect(db.updates[0].params).toEqual([PLAYER_ID, 3]);
      expect(db.stage.get(PLAYER_ID)).toBe(3);
    });

    it('tells the lobby on the next load: /quests says skipped, with the quests still listed', async () => {
      const before = (await quests(player)).json();
      expect(before.skipped).toBe(false);
      expect(before.quests.length).toBeGreaterThan(0);

      await skip(player);

      const after = (await quests(player)).json();
      expect(after.skipped).toBe(true);
      expect(after.quests).toEqual(before.quests);
    });

    it('skips for the player who pressed it and no one else', async () => {
      await skip(player);
      expect((await quests(guest)).json().skipped).toBe(false);
      expect(db.stage.get(GUEST_ID)).toBe(0);
    });

    it('lets a guest skip: a guest sees the banner and its button too', async () => {
      const res = await skip(guest);
      expect(res.statusCode).toBe(200);
      expect(db.stage.get(GUEST_ID)).toBe(3);
      expect((await quests(guest)).json().skipped).toBe(true);
    });

    it('is safe to press twice', async () => {
      await skip(player);
      const again = await skip(player);
      expect(again.statusCode).toBe(200);
      expect(db.stage.get(PLAYER_ID)).toBe(3);
    });

    it('answers 404 for an account that is gone, and writes nothing', async () => {
      const res = await skip(gone);
      expect(res.statusCode).toBe(404);
      expect(db.updates).toHaveLength(0);
    });

    it('needs a signed-in player', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/progression/onboarding/skip' });
      expect(res.statusCode).toBe(401);
      expect(db.updates).toHaveLength(0);
    });
  });

  describe('with the flag off, as before', () => {
    beforeEach(() => setFlag(false));

    it('refuses a player at stage 0, and writes nothing', async () => {
      const res = await skip(player);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'Complete the tutorial before skipping' });
      expect(db.updates).toHaveLength(0);
    });

    it('refuses a guest', async () => {
      const res = await skip(guest);
      expect(res.statusCode).toBe(403);
      expect(db.updates).toHaveLength(0);
    });

    it('still takes a player past stage 0', async () => {
      db.stage.set(PLAYER_ID, 1);
      const res = await skip(player);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ onboarding_stage: 3 });
    });

    it('leaves /quests without `skipped`, even for a player at stage 3', async () => {
      db.stage.set(PLAYER_ID, 3);
      const body = (await quests(player)).json();
      expect(Object.keys(body)).toEqual(['quests']);
    });
  });
});
