/**
 * Returns and active players against real Postgres: what counts as a player
 * coming back, and who is active on each day.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/services/analyticsActivity.db.test.ts
 *
 * Both queries are limited to the players this file seeds, so it is safe
 * beside the other PG_TEST files on a shared database.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type {
  getActivePlayers as GetActivePlayers,
  getRetentionByCohort as GetRetentionByCohort,
} from './analyticsQueries';

const enabled = process.env.PG_TEST === '1';

describe.runIf(enabled)('returns and active players (Postgres)', () => {
  let query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  let getActivePlayers: typeof GetActivePlayers;
  let getRetentionByCohort: typeof GetRetentionByCohort;
  const userIds: string[] = [];

  async function seedUser(name: string, createdDaysAgo: number, isAdmin = false): Promise<string> {
    const id = uuidv4();
    userIds.push(id);
    const username = `${name}_${id.slice(0, 8)}`;
    await query(
      `INSERT INTO users (user_id, username, email, password_hash, is_admin, created_at)
       VALUES ($1, $2, $3, 'x', $4, NOW() - make_interval(days => $5::int))`,
      [id, username, `${username}@test.local`, isAdmin, createdDaysAgo],
    );
    return id;
  }

  async function event(name: string, userId: string, daysAgo: number): Promise<void> {
    await query(
      `INSERT INTO analytics_events (event, user_id, properties, created_at)
       VALUES ($1, $2, '{}'::jsonb, NOW() - make_interval(days => $3::int))`,
      [name, userId, daysAgo],
    );
  }

  beforeAll(async () => {
    ({ query } = (await import('../db/postgres')) as unknown as {
      query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    });
    ({ getActivePlayers, getRetentionByCohort } = await import('./analyticsQueries'));

    // A guest who left after their first day: today brings only a reminder.
    const lapsed = await seedUser('lapsed_guest', 1);
    await event('guest_created', lapsed, 1);
    await event('retention_notification_sent', lapsed, 0);
    // A guest who opened the game again today without playing.
    const back = await seedUser('back_guest', 1);
    await event('guest_created', back, 1);
    await event('app_opened', back, 0);
    // An account that played on its second day, then got the D7 win-back.
    const account = await seedUser('account', 7);
    await event('user_registered', account, 7);
    await event('game_started', account, 6);
    await event('retention_notification_sent', account, 0);
    await event('seat_player_away', account, 0);
    // An admin opening the game is never counted.
    const admin = await seedUser('admin', 1, true);
    await event('user_registered', admin, 1);
    await event('app_opened', admin, 0);
  });

  afterAll(async () => {
    if (userIds.length) {
      await query('DELETE FROM analytics_events WHERE user_id = ANY($1)', [userIds]).catch(() => {});
      await query('DELETE FROM users WHERE user_id = ANY($1)', [userIds]).catch(() => {});
    }
  });

  it('counts a return only for something the player did, and a reminder never', async () => {
    expect(await getRetentionByCohort(userIds)).toEqual([
      // Back on day 1 by playing; the D7 win-back is not a return.
      { cohort: 'account', d1_cohort: 1, d1: 1, d7_cohort: 1, d7: 0, d30_cohort: 0, d30: 0 },
      // Opening the game is a return; the reminder to the other guest is not.
      { cohort: 'guest', d1_cohort: 2, d1: 1, d7_cohort: 0, d7: 0, d30_cohort: 0, d30: 0 },
    ]);
  });

  it('counts each active player once a day, new on the day their account was made', async () => {
    const active = await getActivePlayers(3, userIds);
    expect(active.yesterday).toBe(2);
    expect(active.last_7_days).toBe(3);
    expect(active.last_30_days).toBe(3);
    expect(active.daily.map(({ active: n, new_players, returning_players }) => [n, new_players, returning_players])).toEqual([
      [0, 0, 0],
      [2, 2, 0],
      // Today only the guest who opened the game: the reminder, the away seat and the admin do not count.
      [1, 0, 1],
    ]);
    const days = await query(
      `SELECT to_char(CURRENT_DATE - n, 'YYYY-MM-DD') AS day FROM unnest(ARRAY[2, 1, 0]) AS n ORDER BY n DESC`,
    );
    expect(active.daily.map((d) => d.day)).toEqual(days.map((r) => r.day));
  });
});
