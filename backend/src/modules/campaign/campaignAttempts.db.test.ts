/**
 * Perfect Campaign ("Complete all 6 campaign eras without a loss") needs to
 * know whether an era was ever lost. A retry replaces the lost attempt's entry
 * and clears its outcome, so the campaign counts the attempts that did not win
 * their era (migration 051), and the game end grants Perfect Campaign only to
 * a campaign that finishes at zero.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/campaign/campaignAttempts.db.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

const enabled = process.env.PG_TEST === '1';

describe.runIf(enabled)('campaign era attempts (Postgres)', () => {
  let app: FastifyInstance;
  let query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
  let headers: { authorization: string };
  const userId = uuidv4();

  const attempts = async (campaignId: string) =>
    ((await query('SELECT failed_era_attempts FROM user_campaigns WHERE campaign_id = $1', [campaignId])) as
      Array<{ failed_era_attempts: number | null }>)[0].failed_era_attempts;

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as {
      query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
    });
    const name = `campaigner_${userId.slice(0, 8)}`;
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
    // The entries reference the era games with no cascade, and deleting the
    // user only nulls its game_players rows: campaigns first, then the games
    // while they can still be found by player, then the user.
    await query('DELETE FROM user_campaigns WHERE user_id = $1', [userId]).catch(() => {});
    await query(
      `DELETE FROM games WHERE game_id IN (SELECT game_id FROM game_players WHERE user_id = $1)`,
      [userId],
    ).catch(() => {});
    await query('DELETE FROM users WHERE user_id = $1', [userId]).catch(() => {});
  });

  it('starts at zero, counts an era played again after a loss, and not a resumed game', async () => {
    const started = await app.inject({ method: 'POST', url: '/api/campaign/start', headers, payload: {} });
    expect(started.statusCode).toBe(201);
    const { campaign_id, game_id: firstGame } = started.json() as { campaign_id: string; game_id: string };
    expect(await attempts(campaign_id)).toBe(0);

    // Continuing while the era's game is still on resumes it: no new attempt.
    const resumed = await app.inject({ method: 'POST', url: '/api/campaign/continue', headers, payload: { campaign_id } });
    expect((resumed.json() as { game_id: string }).game_id).toBe(firstGame);
    expect(await attempts(campaign_id)).toBe(0);

    // The era's game ends without the campaign advancing (a loss), and the
    // player plays the era again: one failed attempt.
    await query(`UPDATE games SET status = 'completed', ended_at = NOW() WHERE game_id = $1`, [firstGame]);
    const retried = await app.inject({ method: 'POST', url: '/api/campaign/continue', headers, payload: { campaign_id } });
    expect(retried.statusCode).toBe(201);
    expect((retried.json() as { game_id: string }).game_id).not.toBe(firstGame);
    expect(await attempts(campaign_id)).toBe(1);
  });

  it('leaves a campaign begun before attempts were counted at NULL, never eligible', async () => {
    const started = await app.inject({
      method: 'POST', url: '/api/campaign/start', headers, payload: { path_id: 'blood_empire' },
    });
    expect(started.statusCode).toBe(201);
    const { campaign_id, game_id } = started.json() as { campaign_id: string; game_id: string };
    await query('UPDATE user_campaigns SET failed_era_attempts = NULL WHERE campaign_id = $1', [campaign_id]);
    await query(`UPDATE games SET status = 'abandoned', ended_at = NOW() WHERE game_id = $1`, [game_id]);
    await app.inject({ method: 'POST', url: '/api/campaign/continue', headers, payload: { campaign_id } });
    expect(await attempts(campaign_id)).toBeNull();
  });
});
