/**
 * Guests can PLAY the daily; only registered commanders are RANKED.
 *
 * `POST /daily/start` used to carry `rejectGuest`, which closed the most
 * distinctive thing in the product at the moment intent is highest. Opening it
 * naively would have been worse: the daily board was the one leaderboard in the
 * repo with no `is_guest` filter (guests could never reach it), and a guest
 * identity is a single unauthenticated POST away — so the board would have been
 * farmable by anyone willing to clear their storage. The contract these tests
 * pin: a guest starts a game and gets a result and their would-be place; the
 * board and the attempts count describe registered players only.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=chronouser \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/daily/dailyGuest.routes.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

const enabled = process.env.PG_TEST === '1';

describe.runIf(enabled)('daily challenge — guests play, registered rank (Postgres)', () => {
  let app: FastifyInstance;
  let query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  let signAccessToken: (p: { sub: string; username: string; guest?: boolean; admin?: boolean }) => string;
  const userIds: string[] = [];
  const gameIds: string[] = [];
  let challengeDate: string;

  async function seedUser(base: string, guest: boolean): Promise<{ id: string; name: string }> {
    const id = uuidv4();
    const name = `${base}_${id.slice(0, 8)}`;
    userIds.push(id);
    await query(
      `INSERT INTO users (user_id, username, email, password_hash, is_guest)
       VALUES ($1, $2, $3, 'x', $4)`,
      [id, name, guest ? `${id}@guest.local` : `${name}@test.local`, guest],
    );
    return { id, name };
  }

  /** A settled run for `userId` today. Score/turns pick the board position. */
  async function seedEntry(userId: string, puzzleScore: number, turns: number, won = true) {
    await query(
      `INSERT INTO daily_challenge_entries
         (challenge_date, user_id, won, turn_count, territory_count, puzzle_score, objective_met, archetype, move_feedback_mistakes)
       VALUES ($1, $2, $3, $4, 10, $5, $3, 'domination', 0)`,
      [challengeDate, userId, won, turns, puzzleScore],
    );
  }

  const auth = (u: { id: string; name: string }, guest: boolean) => ({
    authorization: `Bearer ${signAccessToken({ sub: u.id, username: u.name, guest, admin: false })}`,
  });

  const today = async (u: { id: string; name: string }, guest: boolean) => {
    const res = await app.inject({ method: 'GET', url: '/api/daily/today', headers: auth(u, guest) });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as {
      challenge: { challenge_date: string };
      my_entry: unknown | null;
      my_rank: number | null;
      attempts_today: number;
      leaderboard: Array<{ username: string }>;
    };
  };

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as {
      query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    });
    ({ signAccessToken } = await import('../../utils/jwt'));
    const { registerErrorHandler } = await import('../../errorHandler');
    const { dailyRoutes } = await import('./daily.routes');
    app = Fastify();
    registerErrorHandler(app);
    await app.register(dailyRoutes, { prefix: '/api/daily' });
    await app.ready();

    // Resolve today's key through the route itself so the entries we seed land
    // on the same row the board reads.
    const probe = await seedUser('probe', false);
    challengeDate = (await today(probe, false)).challenge.challenge_date;
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
    if (gameIds.length) {
      await query(`DELETE FROM games WHERE game_id = ANY($1)`, [gameIds]).catch(() => {});
    }
    if (userIds.length) {
      await query(`DELETE FROM daily_challenge_entries WHERE user_id = ANY($1)`, [userIds]).catch(() => {});
      await query(`DELETE FROM users WHERE user_id = ANY($1)`, [userIds]).catch(() => {});
    }
  });

  it('lets a guest start today\'s challenge', async () => {
    const guest = await seedUser('guest', true);
    const res = await app.inject({ method: 'POST', url: '/api/daily/start', headers: auth(guest, true) });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as { game_id: string };
    expect(body.game_id).toBeTruthy();
    gameIds.push(body.game_id);
  });

  it('keeps guests off the board and out of the attempts count', async () => {
    const reg = await seedUser('reg', false);
    const guest = await seedUser('ghost', true);
    await seedEntry(reg.id, 900, 8);
    await seedEntry(guest.id, 1000, 5); // would be 1st if admitted

    const view = await today(reg, false);
    const names = view.leaderboard.map((r) => r.username);
    expect(names).toContain(reg.name);
    expect(names).not.toContain(guest.name);
    // The count and the board describe the same population.
    const boardHasOnlyRegistered = await query(
      `SELECT COUNT(*)::int AS n FROM daily_challenge_entries dce JOIN users u ON u.user_id = dce.user_id
       WHERE dce.challenge_date = $1 AND u.is_guest = true`,
      [challengeDate],
    );
    expect(Number(boardHasOnlyRegistered[0].n)).toBeGreaterThan(0); // the guest entry exists…
    const allRegistered = await query(
      `SELECT COUNT(*)::int AS n FROM daily_challenge_entries dce JOIN users u ON u.user_id = dce.user_id
       WHERE dce.challenge_date = $1 AND u.is_guest = false`,
      [challengeDate],
    );
    expect(view.attempts_today).toBe(Number(allRegistered[0].n)); // …and is not counted.
  });

  it('tells a guest the place they would hold, ranked against registered runs only', async () => {
    const top = await seedUser('top', false);
    const mid = await seedUser('mid', false);
    const otherGuest = await seedUser('other', true);
    const me = await seedUser('me', true);
    await seedEntry(top.id, 1000, 4);
    await seedEntry(mid.id, 700, 12);
    await seedEntry(otherGuest.id, 990, 5); // a better guest run must not push me down
    await seedEntry(me.id, 800, 9);

    const view = await today(me, true);
    expect(view.my_entry).not.toBeNull();
    // Above `mid` (700), below `top` (1000), other guests ignored — and other
    // registered entries from earlier cases sit at 900, so count precisely.
    const ahead = await query(
      `SELECT COUNT(*)::int AS n FROM daily_challenge_entries dce JOIN users u ON u.user_id = dce.user_id
       WHERE dce.challenge_date = $1 AND u.is_guest = false AND dce.won = true AND dce.puzzle_score > 800`,
      [challengeDate],
    );
    expect(view.my_rank).toBe(Number(ahead[0].n) + 1);
    expect(view.leaderboard.map((r) => r.username)).not.toContain(me.name);
  });

  it('gives a registered player their real rank', async () => {
    const reg = await seedUser('ranked', false);
    await seedEntry(reg.id, 1000, 3); // beats every seeded run on turns
    const view = await today(reg, false);
    expect(view.my_rank).toBe(1);
    expect(view.leaderboard[0]?.username).toBe(reg.name);
  });

  it('reports no rank before the viewer has played', async () => {
    const fresh = await seedUser('fresh', true);
    const view = await today(fresh, true);
    expect(view.my_entry).toBeNull();
    expect(view.my_rank).toBeNull();
  });
});
