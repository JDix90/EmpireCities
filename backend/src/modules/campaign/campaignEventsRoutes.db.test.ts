/**
 * The campaign routes record what the funnels read: a campaign started, each
 * stage game created (a retry marked as one), and `game_created` for the stage
 * game, which POST /api/games would have recorded had the game gone through it.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1, as
 * campaignAttempts.db.test.ts is.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

const recorded: Array<{ event: string; props: Record<string, unknown>; userId: unknown }> = [];
vi.mock('../../services/analyticsEvents', () => ({
  recordServerEvent: (event: string, props: Record<string, unknown>, userId: unknown) => {
    recorded.push({ event, props, userId });
  },
}));

const enabled = process.env.PG_TEST === '1';

describe.runIf(enabled)('campaign events (Postgres)', () => {
  let app: FastifyInstance;
  let query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
  let headers: { authorization: string };
  const userId = uuidv4();

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as {
      query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
    });
    const name = `camp_events_${userId.slice(0, 8)}`;
    await query(
      `INSERT INTO users (user_id, username, email, password_hash) VALUES ($1, $2, $3, 'x')`,
      [userId, name, `${name}@test.local`],
    );
    const { signAccessToken } = await import('../../utils/jwt');
    headers = { authorization: `Bearer ${signAccessToken({ sub: userId, username: name, guest: false, admin: false })}` };
    const { campaignRoutes } = await import('./campaign.routes');
    app = Fastify();
    await app.register(campaignRoutes, { prefix: '/api/campaign' });
    await app.ready();
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
    await query('DELETE FROM user_campaigns WHERE user_id = $1', [userId]).catch(() => {});
    await query(
      `DELETE FROM games WHERE game_id IN (SELECT game_id FROM game_players WHERE user_id = $1)`,
      [userId],
    ).catch(() => {});
    await query('DELETE FROM users WHERE user_id = $1', [userId]).catch(() => {});
  });

  it('records the start, the stage game and its game_created, then a retry as a retry', async () => {
    const started = await app.inject({
      method: 'POST', url: '/api/campaign/start', headers, payload: { path_id: 'blood_empire' },
    });
    expect(started.statusCode).toBe(201);
    const { campaign_id, game_id: firstGame } = started.json() as { campaign_id: string; game_id: string };

    expect(recorded.map((r) => r.event)).toEqual(['campaign_started', 'game_created', 'campaign_stage_started']);
    expect(recorded.every((r) => r.userId === userId)).toBe(true);
    expect(recorded[0]!.props).toEqual({ campaign_id, path_id: 'blood_empire', is_guest: false });
    expect(recorded[1]!.props).toMatchObject({
      game_id: firstGame, era_id: 'ancient', game_type: 'solo', is_campaign: true, is_tutorial: false, first_match: false,
    });
    expect(recorded[2]!.props).toMatchObject({
      campaign_id, path_id: 'blood_empire', stage: 1, era_id: 'ancient', game_id: firstGame,
      retry: false, failed_attempts: 0, is_guest: false,
    });

    // Resuming the same stage game creates nothing, so records nothing.
    recorded.length = 0;
    await app.inject({ method: 'POST', url: '/api/campaign/continue', headers, payload: { campaign_id } });
    expect(recorded).toEqual([]);

    // The stage game ended without a win; playing the stage again is a retry.
    await query(`UPDATE games SET status = 'completed', ended_at = NOW() WHERE game_id = $1`, [firstGame]);
    const retried = await app.inject({ method: 'POST', url: '/api/campaign/continue', headers, payload: { campaign_id } });
    const { game_id: secondGame } = retried.json() as { game_id: string };
    expect(recorded.map((r) => r.event)).toEqual(['game_created', 'campaign_stage_started']);
    expect(recorded[1]!.props).toMatchObject({ stage: 1, game_id: secondGame, retry: true, failed_attempts: 1 });
  });
});
