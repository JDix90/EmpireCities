/**
 * The website against the iOS and Android apps (Admin → Analytics, By
 * platform), against real Postgres: signups by the platform on the signup
 * event, what became of them, who opened the game where, and the platform
 * filter on the activation and first-turn funnels.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/services/platformBreakdown.db.test.ts
 *
 * The breakdown and the first-turn funnel are limited to the players this file
 * seeds, so it is safe beside the other PG_TEST files on a shared database.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type {
  getPlatformBreakdown as GetPlatformBreakdown,
  getFirstTurnFunnel as GetFirstTurnFunnel,
} from './analyticsQueries';

const enabled = process.env.PG_TEST === '1';

describe.runIf(enabled)('signups and visits by platform (Postgres)', () => {
  let query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  let getPlatformBreakdown: typeof GetPlatformBreakdown;
  let getFirstTurnFunnel: typeof GetFirstTurnFunnel;
  const userIds: string[] = [];
  /** Today's two signups, one per platform: see the first-turn test. */
  let today: string[] = [];

  async function event(userId: string, name: string, properties: Record<string, unknown> = {}, daysAgo = 0): Promise<void> {
    await query(
      `INSERT INTO analytics_events (event, user_id, properties, created_at)
       VALUES ($1, $2, $3::jsonb, NOW() - make_interval(days => $4::int))`,
      [name, userId, JSON.stringify(properties), daysAgo],
    );
  }

  /** A guest whose signup event carries `signup` (a platform, or nothing at all). */
  async function newPlayer(name: string, signup: Record<string, unknown>, daysAgo = 0): Promise<string> {
    const id = uuidv4();
    userIds.push(id);
    const username = `${name}_${id.slice(0, 8)}`;
    await query(
      `INSERT INTO users (user_id, username, email, password_hash, is_guest) VALUES ($1, $2, $3, 'x', true)`,
      [id, username, `${username}@guest.local`],
    );
    await event(id, 'guest_created', signup, daysAgo);
    return id;
  }

  const real = { is_tutorial: 'false' };

  beforeAll(async () => {
    ({ query } = (await import('../db/postgres')) as unknown as {
      query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    });
    ({ getPlatformBreakdown, getFirstTurnFunnel } = await import('./analyticsQueries'));

    // The iOS app: signed up two days ago, played a real game through, saved
    // the account, came back the next day, and opened the app today.
    const ios = await newPlayer('pf_ios', { device: 'phone', platform: 'ios' }, 2);
    await event(ios, 'game_started', real, 2);
    await event(ios, 'map_rendered', real, 2);
    await event(ios, 'game_finished', real, 2);
    await event(ios, 'guest_upgraded', { platform: 'ios' }, 2);
    await event(ios, 'app_opened', { device: 'phone', platform: 'ios' }, 1);
    await event(ios, 'app_opened', { device: 'phone', platform: 'ios' }, 0);

    // A second iOS signup, today: too new to be in the day-1 cohort, and only
    // played the tutorial, which is not a real game.
    const iosNew = await newPlayer('pf_ios_new', { device: 'phone', platform: 'ios' });
    await event(iosNew, 'game_started', { is_tutorial: 'true' });
    // The first-turn funnel counts signups from the day its steps were first
    // recorded. One recorded now makes that day today at the latest, whatever
    // else is on the database, so today's signups are always in it.
    await event(iosNew, 'first_turn_step', { step: 'briefing_closed', is_tutorial: 'false' });

    // And a web signup today, with nothing else to its name.
    const webNew = await newPlayer('pf_web_new', { device: 'desktop', platform: 'web' });
    today = [iosNew, webNew];

    // Safari on the same kind of phone: a phone to the device class, the web here.
    const web = await newPlayer('pf_web', { device: 'phone', platform: 'web' }, 2);
    await event(web, 'game_started', real, 2);
    await event(web, 'app_opened', { device: 'phone', platform: 'web' }, 0);

    // A signup from before the platform was sent, and a visit from a tab on an
    // older build: both are the website's.
    const old = await newPlayer('pf_old', { device: 'desktop' }, 2);
    await event(old, 'app_opened', { device: 'desktop' }, 0);

    // Signed up on the web, then also opened the iOS app: a web signup, and
    // "opened" under both.
    const both = await newPlayer('pf_both', { device: 'phone', platform: 'web' }, 2);
    await event(both, 'app_opened', { device: 'phone', platform: 'web' }, 0);
    await event(both, 'app_opened', { device: 'phone', platform: 'ios' }, 0);

    // A value outside the set never becomes a platform of its own.
    await newPlayer('pf_junk', { device: 'phone', platform: 'fridge' }, 2);
  });

  afterAll(async () => {
    if (userIds.length) {
      await query('DELETE FROM analytics_events WHERE user_id = ANY($1)', [userIds]).catch(() => {});
      await query('DELETE FROM users WHERE user_id = ANY($1)', [userIds]).catch(() => {});
    }
  });

  it('splits signups, what became of them and visits into web, ios and android', async () => {
    const rows = await getPlatformBreakdown(30, userIds);
    expect(rows).toEqual([
      // pf_web, pf_old, pf_both, pf_junk and pf_web_new signed up; pf_web
      // started a real game; the four old enough for a day one did not come
      // back on it; pf_web, pf_old and pf_both opened it there.
      { platform: 'web', signups: 5, started_game: 1, finished_game: 0, upgraded: 0, d1_cohort: 4, d1: 0, opened: 3 },
      // pf_ios and pf_ios_new signed up; only pf_ios played a real game, saved,
      // and is old enough for day one (and came back); pf_ios and pf_both opened it.
      { platform: 'ios', signups: 2, started_game: 1, finished_game: 1, upgraded: 1, d1_cohort: 1, d1: 1, opened: 2 },
      { platform: 'android', signups: 0, started_game: 0, finished_game: 0, upgraded: 0, d1_cohort: 0, d1: 0, opened: 0 },
    ]);
  });

  it('leaves out a visit from before the window', async () => {
    const rows = await getPlatformBreakdown(1, userIds);
    // A one-day window: only today's signups and the visits since yesterday.
    expect(rows.find((r) => r.platform === 'ios')).toMatchObject({ signups: 1, opened: 2 });
    expect(rows.find((r) => r.platform === 'web')).toMatchObject({ signups: 1, opened: 3 });
  });

  it('narrows the first-turn funnel to signups on one platform', async () => {
    expect((await getFirstTurnFunnel(30, null, today)).new_players).toBe(2);
    expect(await getFirstTurnFunnel(30, null, today, 'ios')).toMatchObject({ new_players: 1, briefing_closed: 1 });
    expect(await getFirstTurnFunnel(30, null, today, 'web')).toMatchObject({ new_players: 1, briefing_closed: 0 });
    expect((await getFirstTurnFunnel(30, null, today, 'android')).new_players).toBe(0);
    // Device and platform narrow together: the iOS signup was on a phone.
    expect((await getFirstTurnFunnel(30, 'phone', today, 'ios')).new_players).toBe(1);
    expect((await getFirstTurnFunnel(30, 'desktop', today, 'ios')).new_players).toBe(0);
  });
});
