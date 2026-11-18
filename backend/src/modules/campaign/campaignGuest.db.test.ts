/**
 * Guests in the campaign (guest_campaign_enabled): refused with the flag off,
 * as before; with it on, let into the paths marked open to guests and no
 * others, for every stage of them.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1, as
 * campaignEventsRoutes.db.test.ts is.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { CAMPAIGN_PATHS, allCampaignStages, pathOpenToGuests } from './campaignPaths';
import { setAdminConfigCacheForTests } from '../../services/adminConfig';

const recorded: Array<{ event: string; props: Record<string, unknown> }> = [];
vi.mock('../../services/analyticsEvents', () => ({
  recordServerEvent: (event: string, props: Record<string, unknown>) => {
    recorded.push({ event, props });
  },
}));

describe('paths open to guests', () => {
  it('opens a path only once every stage of it states its objective and runs on a clock', () => {
    for (const { path, index, line_id, stage } of allCampaignStages()) {
      if (!path.guest_open) continue;
      const stated = !!stage.mission || stage.allowed_victory_conditions.includes('threshold');
      expect({ path: path.path_id, stage: index + 1, line_id, stated, clock: stage.max_turns != null })
        .toEqual({ path: path.path_id, stage: index + 1, line_id, stated: true, clock: true });
      // Short enough to finish in a sitting.
      expect(stage.max_turns!).toBeLessThanOrEqual(40);
    }
  });

  it('opens all three paths', () => {
    expect(Object.values(CAMPAIGN_PATHS).filter((p) => p.guest_open).map((p) => p.path_id))
      .toEqual(['blood_empire', 'revolutionary_flame', 'last_defenders']);
  });

  it('never opens the classic campaign, which has no path', () => {
    expect(pathOpenToGuests(null)).toBe(false);
    expect(pathOpenToGuests(undefined)).toBe(false);
    expect(pathOpenToGuests('not_a_path')).toBe(false);
    expect(pathOpenToGuests('blood_empire')).toBe(true);
  });
});

const enabled = process.env.PG_TEST === '1';

describe.runIf(enabled)('guests in the campaign (Postgres)', () => {
  let app: FastifyInstance;
  let query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
  let headers: { authorization: string };
  const userId = uuidv4();
  const flag = (on: boolean) => setAdminConfigCacheForTests({ feature_flags: { guest_campaign_enabled: on } });
  const start = (path_id?: string) =>
    app.inject({ method: 'POST', url: '/api/campaign/start', headers, payload: path_id ? { path_id } : {} });

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as {
      query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
    });
    const name = `camp_guest_${userId.slice(0, 8)}`;
    await query(
      `INSERT INTO users (user_id, username, email, password_hash, is_guest) VALUES ($1, $2, $3, 'x', true)`,
      [userId, name, `${name}@test.local`],
    );
    const { signAccessToken } = await import('../../utils/jwt');
    headers = { authorization: `Bearer ${signAccessToken({ sub: userId, username: name, guest: true, admin: false })}` };
    const { campaignRoutes } = await import('./campaign.routes');
    app = Fastify();
    await app.register(campaignRoutes, { prefix: '/api/campaign' });
    await app.ready();
  }, 30_000);

  afterEach(() => setAdminConfigCacheForTests({}));

  afterAll(async () => {
    if (app) await app.close();
    await query('DELETE FROM user_campaigns WHERE user_id = $1', [userId]).catch(() => {});
    await query(
      `DELETE FROM games WHERE game_id IN (SELECT game_id FROM game_players WHERE user_id = $1)`,
      [userId],
    ).catch(() => {});
    await query('DELETE FROM users WHERE user_id = $1', [userId]).catch(() => {});
  });

  it('refuses a guest with the flag off, as before', async () => {
    flag(false);
    expect((await start('blood_empire')).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/campaign/continue', headers, payload: {} })).statusCode).toBe(403);
    expect(await query('SELECT 1 FROM user_campaigns WHERE user_id = $1', [userId])).toEqual([]);
  });

  it('with the flag on, still refuses the classic campaign, which has no path', async () => {
    flag(true);
    const res = await start(undefined);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'guest_path_closed' });
    expect(await query('SELECT 1 FROM user_campaigns WHERE user_id = $1', [userId])).toEqual([]);
  });

  it('with the flag on, refuses a path the config closes to guests', async () => {
    flag(true);
    const path = CAMPAIGN_PATHS.last_defenders;
    path.guest_open = false;
    try {
      const res = await start('last_defenders');
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ code: 'guest_path_closed' });
    } finally {
      path.guest_open = true;
    }
  });

  it('with the flag on, starts and continues an open path, and says the player is a guest', async () => {
    flag(true);
    recorded.length = 0;
    const started = await start('blood_empire');
    expect(started.statusCode).toBe(201);
    const { campaign_id, game_id } = started.json() as { campaign_id: string; game_id: string };
    expect(recorded.find((r) => r.event === 'campaign_started')!.props).toMatchObject({ path_id: 'blood_empire', is_guest: true });
    expect(recorded.find((r) => r.event === 'campaign_stage_started')!.props).toMatchObject({ stage: 1, is_guest: true });

    // Every stage of the path, not the first alone: a later one continues the same way.
    await query(`UPDATE games SET status = 'completed', ended_at = NOW() WHERE game_id = $1`, [game_id]);
    await query(`UPDATE user_campaigns SET current_era_index = 4 WHERE campaign_id = $1`, [campaign_id]);
    const later = await app.inject({ method: 'POST', url: '/api/campaign/continue', headers, payload: { campaign_id } });
    expect(later.statusCode).toBe(201);
    expect(later.json()).toMatchObject({ current_era: 'coldwar', current_era_index: 4 });

    // The flag turned off closes it again at once; the run itself is kept.
    flag(false);
    expect((await app.inject({ method: 'POST', url: '/api/campaign/continue', headers, payload: { campaign_id } })).statusCode).toBe(403);
    expect(await query('SELECT 1 AS kept FROM user_campaigns WHERE campaign_id = $1', [campaign_id])).toEqual([{ kept: 1 }]);
  });

  it('lists the paths with whether a guest can play each', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/campaign/paths', headers });
    const paths = res.json() as Array<{ path_id: string; guest_open: boolean }>;
    expect(paths.map((p) => [p.path_id, p.guest_open])).toEqual([
      ['blood_empire', true], ['revolutionary_flame', true], ['last_defenders', true],
    ]);
  });
});
