/**
 * `/progression/comeback` with comeback_hook_enabled: tomorrow's Daily
 * Challenge by name and how many played yesterday's. Off, the payload is as
 * before and tomorrow's day is never generated.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const state = vi.hoisted(() => ({ lastPlayed: null as string | null }));
const run = async (sql: string): Promise<unknown[]> => {
  if (sql.includes('FROM users WHERE user_id')) {
    return [{ is_guest: true, daily_streak: 2, last_played_date: state.lastPlayed, last_login_date: null, login_streak: 0, streak_freezes: 0, streak_freeze_used_on: null }];
  }
  return [];
};
vi.mock('../../db/postgres', () => ({
  query: (sql: string) => run(sql),
  queryOne: async (sql: string) => (await run(sql))[0] ?? null,
  withTransaction: async () => undefined,
}));
const teaser = vi.hoisted(() => ({
  tomorrowsDailyTeaser: vi.fn(async () => ({ date: '2026-11-13', title: 'The Ottoman Gates', era_id: 'medieval' })),
  dailyPlayersOn: vi.fn(async () => 14),
}));
vi.mock('../../game-engine/daily/dailyTeaser', () => teaser);

const GUEST_ID = '11111111-2222-4333-8444-555555555555';

describe('GET /progression/comeback', () => {
  let app: FastifyInstance;
  let auth: { authorization: string };
  let adminConfig: typeof import('../../services/adminConfig');
  const setFlag = (on: boolean) => adminConfig.setAdminConfigCacheForTests({ feature_flags: { comeback_hook_enabled: on } });

  beforeAll(async () => {
    adminConfig = await import('../../services/adminConfig');
    const { signAccessToken } = await import('../../utils/jwt');
    auth = { authorization: `Bearer ${signAccessToken({ sub: GUEST_ID, username: 'SwiftFalcon_48213', guest: true, admin: false })}` };
    const { progressionRoutes } = await import('./progression.routes');
    app = Fastify();
    await app.register(progressionRoutes, { prefix: '/api/progression' });
    await app.ready();
  });
  afterAll(() => app.close());
  beforeEach(() => {
    teaser.tomorrowsDailyTeaser.mockClear();
    teaser.dailyPlayersOn.mockClear();
  });
  afterEach(() => adminConfig.resetAdminConfigCacheForTests());

  it('names tomorrow\'s challenge and yesterday\'s players with the flag on', async () => {
    setFlag(true);
    const res = await app.inject({ method: 'GET', url: '/api/progression/comeback', headers: auth });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tomorrow_daily).toEqual({ date: '2026-11-13', title: 'The Ottoman Gates', era_id: 'medieval' });
    expect(body.daily_players_yesterday).toBe(14);
    expect(body.is_guest).toBe(true);
    expect(body.daily_streak).toBe(2);
    expect(body.streak_alive).toBe(false);
  });

  it('counts a streak alive only through a game today or yesterday', async () => {
    setFlag(true);
    const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
    for (const [lastPlayed, alive] of [[day(0), true], [day(1), true], [day(2), false]] as const) {
      state.lastPlayed = lastPlayed;
      const res = await app.inject({ method: 'GET', url: '/api/progression/comeback', headers: auth });
      expect(res.json().streak_alive, lastPlayed).toBe(alive);
    }
    state.lastPlayed = null;
  });

  it('does not hold the panel for a slow first generation', async () => {
    setFlag(true);
    teaser.tomorrowsDailyTeaser.mockImplementationOnce(() => new Promise(() => {}));
    const started = Date.now();
    const res = await app.inject({ method: 'GET', url: '/api/progression/comeback', headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json().tomorrow_daily).toBeNull();
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('is the payload as before with the flag off, and generates nothing', async () => {
    setFlag(false);
    const res = await app.inject({ method: 'GET', url: '/api/progression/comeback', headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty('tomorrow_daily');
    expect(res.json()).not.toHaveProperty('daily_players_yesterday');
    expect(res.json()).not.toHaveProperty('streak_alive');
    expect(teaser.tomorrowsDailyTeaser).not.toHaveBeenCalled();
  });
});
