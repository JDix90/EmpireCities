/**
 * The First turn report (first_turn_events_enabled), against real Postgres:
 * how far new players got in the first turn of a real game, step by step.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/services/firstTurnFunnel.db.test.ts
 *
 * The query is limited to the players this file seeds, so it is safe beside the
 * other PG_TEST files on a shared database.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { getFirstTurnFunnel as GetFirstTurnFunnel } from './analyticsQueries';

const enabled = process.env.PG_TEST === '1';

describe.runIf(enabled)('the first turn of a real game, step by step (Postgres)', () => {
  let query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  let getFirstTurnFunnel: typeof GetFirstTurnFunnel;
  const userIds: string[] = [];

  async function newPlayer(name: string, device: string, opts: { admin?: boolean } = {}): Promise<string> {
    const id = uuidv4();
    userIds.push(id);
    const username = `${name}_${id.slice(0, 8)}`;
    await query(
      `INSERT INTO users (user_id, username, email, password_hash, is_guest, is_admin) VALUES ($1, $2, $3, 'x', true, $4)`,
      [id, username, `${username}@guest.local`, opts.admin ?? false],
    );
    await event(id, 'guest_created', { device });
    return id;
  }

  async function event(userId: string, name: string, properties: Record<string, unknown> = {}): Promise<void> {
    await query(
      `INSERT INTO analytics_events (event, user_id, properties) VALUES ($1, $2, $3::jsonb)`,
      [name, userId, JSON.stringify(properties)],
    );
  }

  const real = { is_tutorial: 'false' };
  const step = (s: string) => ({ step: s, game_id: 'g', era: 'medieval', first_match: 'true', layout: 'phone', seconds: '12' });

  beforeAll(async () => {
    ({ query } = (await import('../db/postgres')) as unknown as {
      query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    });
    ({ getFirstTurnFunnel } = await import('./analyticsQueries'));

    // Got all the way to a capture.
    const all = await newPlayer('ft_all', 'phone');
    await event(all, 'map_rendered', real);
    for (const s of ['briefing_closed', 'territory_opened', 'units_placed', 'draft_ended']) await event(all, 'first_turn_step', step(s));
    await event(all, 'first_attack', real);
    await event(all, 'first_territory_captured', real);

    // Opened a territory and stopped there; their clock ran out.
    const stuck = await newPlayer('ft_stuck', 'phone');
    await event(stuck, 'map_rendered', real);
    await event(stuck, 'first_turn_step', step('briefing_closed'));
    await event(stuck, 'first_turn_step', step('territory_opened'));
    await event(stuck, 'turn_timed_out', { game_id: 'g', turn_number: 1, phase: 'draft', is_tutorial: false });
    // A later turn's clock running out is not the first turn's.
    await event(stuck, 'turn_timed_out', { game_id: 'g', turn_number: 4, phase: 'attack', is_tutorial: false });

    // Only played the tutorial: none of it is a real game's.
    const tutorialOnly = await newPlayer('ft_tutorial', 'desktop');
    await event(tutorialOnly, 'map_rendered', { is_tutorial: 'true' });
    await event(tutorialOnly, 'first_attack', { is_tutorial: 'true' });

    // An admin's play is left out of the stats.
    const admin = await newPlayer('ft_admin', 'phone', { admin: true });
    await event(admin, 'map_rendered', real);
  });

  afterAll(async () => {
    if (userIds.length) {
      await query('DELETE FROM analytics_events WHERE user_id = ANY($1)', [userIds]).catch(() => {});
      await query('DELETE FROM users WHERE user_id = ANY($1)', [userIds]).catch(() => {});
    }
  });

  it('counts each step a new player reached in a real game', async () => {
    const r = await getFirstTurnFunnel(30, null, userIds);
    expect(r).toMatchObject({
      new_players: 3,
      saw_map: 2,
      briefing_closed: 2,
      territory_opened: 2,
      units_placed: 1,
      draft_ended: 1,
      attacked: 1,
      captured: 1,
      clock_ran_out: 1,
    });
    expect(r.measured_since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('narrows to the device a player signed up on', async () => {
    const phone = await getFirstTurnFunnel(30, 'phone', userIds);
    expect(phone).toMatchObject({ new_players: 2, saw_map: 2, territory_opened: 2, units_placed: 1 });
    const desktop = await getFirstTurnFunnel(30, 'desktop', userIds);
    expect(desktop).toMatchObject({ new_players: 1, saw_map: 0, attacked: 0 });
  });
});
