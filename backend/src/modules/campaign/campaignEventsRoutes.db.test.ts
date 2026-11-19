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

  it('opens an attempt at a stage already lost with the units trying again adds', async () => {
    const [{ campaign_id }] = (await query(
      `SELECT campaign_id FROM user_campaigns WHERE user_id = $1 AND path_id = 'blood_empire'`, [userId],
    )) as Array<{ campaign_id: string }>;
    // As the completion handler leaves a stage lost twice.
    await query(
      `UPDATE user_campaigns SET path_narrative = '{"era_0_outcome":"lost","era_0_losses":"2"}'::jsonb WHERE campaign_id = $1`,
      [campaign_id],
    );
    await query(
      `UPDATE games SET status = 'completed', ended_at = NOW()
       WHERE game_id IN (SELECT game_id FROM campaign_entries WHERE campaign_id = $1)`, [campaign_id],
    );
    recorded.length = 0;
    const res = await app.inject({ method: 'POST', url: '/api/campaign/continue', headers, payload: { campaign_id } });
    expect(res.statusCode).toBe(201);
    const [game] = (await query(`SELECT settings_json FROM games WHERE game_id = $1`, [(res.json() as { game_id: string }).game_id])) as Array<{ settings_json: Record<string, any> }>;
    expect(game!.settings_json.campaign_retry_units).toBe(4);
    expect(game!.settings_json.campaign_carry_effects).toEqual([
      { key: 'retry', label: 'Trying again', text: '+4 starting units on this era', until_round: 1 },
    ]);
    expect(recorded.find((r) => r.event === 'campaign_stage_started')!.props).toMatchObject({ stage: 1, retry: true, retry_units: 4 });
    // The losses are the stage's: the count is kept, and the campaign page says what it is worth.
    const listed = (await app.inject({ method: 'GET', url: '/api/campaign/list', headers })).json() as { campaigns: Array<Record<string, any>> };
    expect(listed.campaigns.find((c) => c.campaign_id === campaign_id)!.carry_effects).toEqual([
      { key: 'retry', label: 'Trying again', text: '+4 starting units on this era', until_round: 1 },
    ]);
  });

  it('plays the side asked for at the stage that offers one, and keeps it', async () => {
    const [{ campaign_id }] = (await query(
      `SELECT campaign_id FROM user_campaigns WHERE user_id = $1 AND path_id = 'blood_empire'`, [userId],
    )) as Array<{ campaign_id: string }>;
    await query(`UPDATE user_campaigns SET current_era_index = 3 WHERE campaign_id = $1`, [campaign_id]);
    const stageOf = async (gameId: string) => {
      const [game] = (await query(`SELECT settings_json FROM games WHERE game_id = $1`, [gameId])) as Array<{ settings_json: Record<string, unknown> }>;
      const seats = (await query(
        `SELECT faction_id FROM game_players WHERE game_id = $1 ORDER BY player_index`, [gameId],
      )) as Array<{ faction_id: string }>;
      return { settings: game!.settings_json, factions: seats.map((s) => s.faction_id) };
    };
    const listed = async () => {
      const res = await app.inject({ method: 'GET', url: '/api/campaign/list', headers });
      return (res.json() as { campaigns: Array<Record<string, any>> }).campaigns.find((c) => c.campaign_id === campaign_id)!;
    };

    // Before the choice the stage belongs to no side: no faction, no text.
    const before = await listed();
    expect(before.line_choice).toMatchObject({ choose_at: 3, chosen: null });
    expect(before.eras[3]).toMatchObject({ faction_id: null, intro_text: null, title: null });

    recorded.length = 0;
    const asSoviets = await app.inject({
      method: 'POST', url: '/api/campaign/continue', headers, payload: { campaign_id, line: 'soviets' },
    });
    expect(asSoviets.statusCode).toBe(201);
    const first = await stageOf((asSoviets.json() as { game_id: string }).game_id);
    expect(first.factions[0]).toBe('soviet_union');
    expect(first.settings).toMatchObject({
      campaign_stage_title: 'Berlin and Manchuria, 1945',
      campaign_mission: { kind: 'capture_territories', territory_ids: ['germany', 'manchuria_ww2'] },
      allowed_victory_conditions: ['secret_mission'],
    });
    expect(recorded.find((r) => r.event === 'campaign_stage_started')!.props).toMatchObject({ stage: 4, line: 'soviets' });
    const taken = await listed();
    expect(taken.line_choice.chosen).toBe('soviets');
    expect(taken.eras[3]).toMatchObject({ faction_id: 'soviet_union', title: 'Berlin and Manchuria, 1945' });
    // The eras that follow are the same side's.
    expect(taken.eras[4]).toMatchObject({ faction_id: 'ussr' });
    expect(taken.eras[5]).toMatchObject({ faction_id: 'eastern_bloc' });

    // A stage game in progress is resumed on the side it was started on.
    const resumed = await app.inject({
      method: 'POST', url: '/api/campaign/continue', headers, payload: { campaign_id, line: 'allies' },
    });
    expect((resumed.json() as { game_id: string }).game_id).toBe((asSoviets.json() as { game_id: string }).game_id);
    expect((await listed()).line_choice.chosen).toBe('soviets');

    // Lost: the stage is played again, and may be played from the other side.
    await query(`UPDATE games SET status = 'completed', ended_at = NOW() WHERE game_id = $1`, [(asSoviets.json() as { game_id: string }).game_id]);
    const asAllies = await app.inject({
      method: 'POST', url: '/api/campaign/continue', headers, payload: { campaign_id, line: 'allies' },
    });
    expect((await stageOf((asAllies.json() as { game_id: string }).game_id)).factions[0]).toBe('usa');
    expect((await listed()).line_choice.chosen).toBe('allies');

    // Past the choice the side is the one stored, whatever a request names.
    await query(`UPDATE games SET status = 'completed', ended_at = NOW() WHERE game_id = $1`, [(asAllies.json() as { game_id: string }).game_id]);
    await query(`UPDATE user_campaigns SET current_era_index = 4 WHERE campaign_id = $1`, [campaign_id]);
    const coldWar = await app.inject({
      method: 'POST', url: '/api/campaign/continue', headers, payload: { campaign_id, line: 'soviets' },
    });
    expect((await stageOf((coldWar.json() as { game_id: string }).game_id)).factions[0]).toBe('usa_cw');
  });

  it('plays the default side for a request that names none', async () => {
    const [{ campaign_id }] = (await query(
      `SELECT campaign_id FROM user_campaigns WHERE user_id = $1 AND path_id = 'blood_empire'`, [userId],
    )) as Array<{ campaign_id: string }>;
    await query(
      `UPDATE user_campaigns SET current_era_index = 3, path_narrative = '{}'::jsonb WHERE campaign_id = $1`, [campaign_id],
    );
    await query(`DELETE FROM campaign_entries WHERE campaign_id = $1 AND era_id = 'ww2'`, [campaign_id]);
    const res = await app.inject({ method: 'POST', url: '/api/campaign/continue', headers, payload: { campaign_id } });
    expect(res.statusCode).toBe(201);
    const [row] = (await query(`SELECT path_narrative FROM user_campaigns WHERE campaign_id = $1`, [campaign_id])) as Array<{ path_narrative: Record<string, string> }>;
    expect(row!.path_narrative.line).toBe('allies');
  });
});
