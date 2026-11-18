/**
 * "Your game is waiting" against a real database: who the candidate query
 * picks (workers/retentionNotificationWorker.ts, sweepGameWaiting), and that
 * each game is reminded about once.
 *
 * The sends are mocked; the query, the claim and its row are real. Only the
 * players seeded here are asserted on, so other rows on a shared database do
 * not matter.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/workers/gameWaitingReminder.db.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

vi.mock('bullmq', () => ({
  Queue: class {
    upsertJobScheduler = vi.fn();
    close = vi.fn();
  },
  Worker: class {
    on = vi.fn();
    close = vi.fn();
  },
}));

const pushMock = vi.hoisted(() => vi.fn(async () => 1));
const emailMock = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../services/notificationService', () => ({
  isPushConfigured: async () => true,
  sendPushNotification: (...a: unknown[]) => pushMock(...(a as [])),
  sendEngagementEmail: (...a: unknown[]) => emailMock(...(a as [])),
}));
vi.mock('../services/analyticsEvents', () => ({ recordServerEvent: vi.fn() }));

const enabled = process.env.PG_TEST === '1';

describe.runIf(enabled)('your game is waiting (Postgres)', () => {
  let query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  let sweepGameWaiting: (pushReady: boolean, guests: boolean) => Promise<number>;
  const userIds: string[] = [];
  const gameIds: string[] = [];
  const MAP_ID = `test_waiting_${uuidv4().slice(0, 8)}`;

  /** A player who last signed in `loginHoursAgo` hours ago, reachable as asked. */
  async function seedUser(opts: { guest?: boolean; loginHoursAgo?: number; push?: boolean; email?: boolean } = {}): Promise<string> {
    const id = uuidv4();
    userIds.push(id);
    const name = `wait_${id.slice(0, 8)}`;
    await query(
      `INSERT INTO users (user_id, username, email, password_hash, is_guest, last_login_at)
       VALUES ($1, $2, $3, 'x', $4, NOW() - make_interval(hours => $5))`,
      [id, name, opts.guest ? `${name}@guest.local` : `${name}@test.local`, opts.guest ?? false, opts.loginHoursAgo ?? 40],
    );
    if (opts.push ?? true) {
      await query(`INSERT INTO push_tokens (user_id, token) VALUES ($1, $2)`, [id, `tok-${id}`]);
    }
    if (opts.email) {
      await query(`INSERT INTO user_preferences (user_id, email_notifications) VALUES ($1, true)`, [id]);
    }
    return id;
  }

  /**
   * A game against one bot, started `hoursAgo` hours ago with its last board
   * saved then, or with a second person at the table.
   */
  async function seedGame(userId: string, opts: {
    hoursAgo: number;
    status?: string;
    settings?: Record<string, unknown>;
    secondHuman?: string;
  }): Promise<string> {
    const id = uuidv4();
    gameIds.push(id);
    await query(
      `INSERT INTO games (game_id, map_id, era_id, status, settings_json, game_type, created_at, started_at)
       VALUES ($1, $2, 'medieval', $3, $4::jsonb, 'solo', NOW() - make_interval(hours => $5), NOW() - make_interval(hours => $5))`,
      [id, MAP_ID, opts.status ?? 'in_progress', JSON.stringify({ max_players: 2, ...(opts.settings ?? {}) }), opts.hoursAgo],
    );
    await query(
      `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai) VALUES ($1, $2, 0, '#e74c3c', false)`,
      [id, userId],
    );
    await query(
      `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai, ai_difficulty)
       VALUES ($1, $2, 1, '#3498db', $3, $4)`,
      [id, opts.secondHuman ?? null, !opts.secondHuman, opts.secondHuman ? null : 'easy'],
    );
    await query(
      `INSERT INTO game_states (game_id, turn_number, state_json, saved_at) VALUES ($1, 1, '{}'::jsonb, NOW() - make_interval(hours => $2))`,
      [id, opts.hoursAgo],
    );
    return id;
  }

  const pushedTo = () => pushMock.mock.calls.map((c) => (c as unknown[])[0]).filter((u) => userIds.includes(u as string));
  const emailedTo = () => emailMock.mock.calls.map((c) => (c as unknown[])[0]).filter((u) => userIds.includes(u as string));

  beforeAll(async () => {
    ({ query } = (await import('../db/postgres')) as unknown as {
      query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    });
    ({ sweepGameWaiting } = await import('./retentionNotificationWorker'));
    await query(
      `INSERT INTO maps (map_id, creator_id, name, territories, connections, regions)
       VALUES ($1, 'test', 'Test Isles', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
      [MAP_ID],
    );
  }, 30_000);

  afterAll(async () => {
    if (gameIds.length) await query('DELETE FROM games WHERE game_id = ANY($1)', [gameIds]).catch(() => {});
    if (userIds.length) await query('DELETE FROM users WHERE user_id = ANY($1)', [userIds]).catch(() => {});
    await query('DELETE FROM maps WHERE map_id = $1', [MAP_ID]).catch(() => {});
  });

  it('reminds a player of the unfinished solo game they left a day ago, once, and no one else', async () => {
    // Reminded: a guest's first match left 30 hours ago; an account with no
    // device but an email opt-in.
    const guest = await seedUser({ guest: true });
    const guestGame = await seedGame(guest, { hoursAgo: 30, settings: { first_match: true } });
    const emailOnly = await seedUser({ push: false, email: true });
    await seedGame(emailOnly, { hoursAgo: 26 });

    // Not reminded, each for one reason.
    const tooSoon = await seedUser();
    await seedGame(tooSoon, { hoursAgo: 5 });
    const tooLate = await seedUser({ loginHoursAgo: 60 });
    await seedGame(tooLate, { hoursAgo: 55 });
    const movedOn = await seedUser();
    await seedGame(movedOn, { hoursAgo: 30 });
    await seedGame(movedOn, { hoursAgo: 25, status: 'completed' });
    const cameBack = await seedUser({ loginHoursAgo: 2 });
    await seedGame(cameBack, { hoursAgo: 30 });
    const finished = await seedUser();
    await seedGame(finished, { hoursAgo: 30, status: 'completed' });
    const tutorial = await seedUser();
    await seedGame(tutorial, { hoursAgo: 30, settings: { tutorial: true } });
    const daily = await seedUser();
    await seedGame(daily, { hoursAgo: 30, settings: { daily_challenge_date: '2026-01-01' } });
    const friend = await seedUser();
    const withFriend = await seedUser();
    await seedGame(withFriend, { hoursAgo: 30, secondHuman: friend });
    const unreachable = await seedUser({ push: false });
    await seedGame(unreachable, { hoursAgo: 30 });
    const remindedAlready = await seedUser();
    await seedGame(remindedAlready, { hoursAgo: 40 });
    await query(
      `INSERT INTO retention_notifications (user_id, trigger_type, channel, sent_on, sent_at)
       VALUES ($1, 'game_waiting', 'push', (NOW() - INTERVAL '30 hours')::date, NOW() - INTERVAL '30 hours')`,
      [remindedAlready],
    );

    // Guests stay out while guest_push_reminders_enabled is off.
    await sweepGameWaiting(true, false);
    expect(pushedTo()).toEqual([]);
    expect(emailedTo()).toEqual([emailOnly]);

    await sweepGameWaiting(true, true);
    expect(pushedTo()).toEqual([guest]);
    const [, title, body, , url] = pushMock.mock.calls.find((c) => (c as unknown[])[0] === guest) as unknown as [string, string, string, unknown, string];
    expect(title).toBe('Your first match is waiting');
    expect(body).toBe('Test Isles: your battle is right where you left it. Pick it up in one tap.');
    expect(url).toContain(`/game/${guestGame}?rn=game_waiting&`);
    const rows = await query(
      `SELECT trigger_type, channel, delivery_status FROM retention_notifications WHERE user_id = $1`,
      [guest],
    );
    expect(rows).toEqual([{ trigger_type: 'game_waiting', channel: 'push', delivery_status: 'sent' }]);

    // Once: another sweep finds no one new.
    await sweepGameWaiting(true, true);
    expect(pushedTo()).toEqual([guest]);
    expect(emailedTo()).toEqual([emailOnly]);
  });
});
