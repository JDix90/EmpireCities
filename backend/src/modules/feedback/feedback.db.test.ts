/**
 * Galactic Age beta feedback through the real routes: POST /api/feedback
 * stores it, a game-over answer is one row per player per game, the admin
 * report reads it back, and deleting an account deletes what it wrote.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/feedback/feedback.db.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

const enabled = process.env.PG_TEST === '1';

describe.runIf(enabled)('Galactic Age beta feedback (Postgres)', () => {
  let app: FastifyInstance;
  let query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  let signAccessToken: (p: { sub: string; username: string; guest?: boolean; admin?: boolean }) => string;
  let setBeta: (on: boolean) => void;
  const userIds: string[] = [];
  const gameIds: string[] = [];

  async function seedUser(base: string, admin = false): Promise<{ id: string; name: string; admin: boolean }> {
    const id = uuidv4();
    const name = `${base}_${id.slice(0, 8)}`;
    userIds.push(id);
    await query(
      `INSERT INTO users (user_id, username, email, password_hash, is_admin)
       VALUES ($1, $2, $3, 'x', $4)`,
      [id, name, `${name}@test.local`, admin],
    );
    return { id, name, admin };
  }

  async function seedGame(playerId: string, eraId = 'galaxy_age', mapId = 'era_galaxy'): Promise<string> {
    const gameId = uuidv4();
    gameIds.push(gameId);
    await query(
      `INSERT INTO games (game_id, map_id, era_id, status, settings_json, game_type, ended_at)
       VALUES ($1, $2, $3, 'completed', '{"max_players": 2}'::jsonb, 'solo', NOW())`,
      [gameId, mapId, eraId],
    );
    await query(
      `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai)
       VALUES ($1, $2, 0, '#e74c3c', false)`,
      [gameId, playerId],
    );
    return gameId;
  }

  function auth(user: { id: string; name: string; admin: boolean }) {
    return { authorization: `Bearer ${signAccessToken({ sub: user.id, username: user.name, guest: false, admin: user.admin })}` };
  }

  function send(user: { id: string; name: string; admin: boolean }, payload: Record<string, unknown>) {
    return app.inject({ method: 'POST', url: '/api/feedback', headers: auth(user), payload: { topic: 'galactic_age', ...payload } });
  }

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as {
      query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    });
    ({ signAccessToken } = await import('../../utils/jwt'));
    const adminConfig = await import('../../services/adminConfig');
    setBeta = (on) => adminConfig.setAdminConfigCacheForTests({ feature_flags: { galaxy_age_beta_enabled: on } });
    const { registerErrorHandler } = await import('../../errorHandler');
    const { feedbackRoutes } = await import('./feedback.routes');
    const { adminRoutes } = await import('../admin/admin.routes');
    app = Fastify();
    registerErrorHandler(app);
    await app.register(feedbackRoutes, { prefix: '/api/feedback' });
    await app.register(adminRoutes, { prefix: '/api/admin' });
    await app.ready();
  }, 30_000);

  afterAll(async () => {
    setBeta?.(false);
    if (app) await app.close();
    if (userIds.length) {
      await query('DELETE FROM game_feedback WHERE user_id = ANY($1)', [userIds]).catch(() => {});
    }
    if (gameIds.length) {
      await query('DELETE FROM games WHERE game_id = ANY($1)', [gameIds]).catch(() => {});
    }
    if (userIds.length) {
      await query('DELETE FROM users WHERE user_id = ANY($1)', [userIds]).catch(() => {});
    }
  });

  it('takes feedback only while the beta is open, except from an admin', async () => {
    const player = await seedUser('fb_closed');
    const admin = await seedUser('fb_admin_closed', true);
    setBeta(false);
    try {
      expect((await send(player, { source: 'beta_panel', rating: 'up' })).statusCode).toBe(403);
      expect((await send(admin, { source: 'beta_panel', rating: 'up' })).statusCode).toBe(201);
    } finally {
      setBeta(true);
    }
  });

  it('keeps one game-over answer per game: the comment fills in the thumb’s row', async () => {
    setBeta(true);
    const player = await seedUser('fb_gameover');
    const gameId = await seedGame(player.id);

    const thumb = await send(player, { source: 'game_over', rating: 'down', game_id: gameId, turn: 14, device: 'phone', viewport: '390x844' });
    expect(thumb.statusCode).toBe(201);
    const comment = await send(player, { source: 'game_over', comment: '  The chart covers End Turn on my phone.  ', game_id: gameId });
    expect(comment.statusCode).toBe(201);

    const rows = await query('SELECT rating, comment, turn_number, device, viewport FROM game_feedback WHERE user_id = $1', [player.id]);
    expect(rows).toEqual([{
      rating: 'down',
      comment: 'The chart covers End Turn on my phone.',
      turn_number: 14,
      device: 'phone',
      viewport: '390x844',
    }]);
  });

  it('adds a row for each note sent from the BETA panel', async () => {
    setBeta(true);
    const player = await seedUser('fb_panel');
    const gameId = await seedGame(player.id);
    expect((await send(player, { source: 'beta_panel', comment: 'Lanes are great.', game_id: gameId })).statusCode).toBe(201);
    expect((await send(player, { source: 'beta_panel', rating: 'up' })).statusCode).toBe(201);
    const rows = await query('SELECT source FROM game_feedback WHERE user_id = $1', [player.id]);
    expect(rows).toHaveLength(2);
  });

  it("refuses a game the sender did not play, and one that is not the Galactic Age", async () => {
    setBeta(true);
    const player = await seedUser('fb_owner');
    const stranger = await seedUser('fb_stranger');
    const theirs = await seedGame(player.id);
    const ww2 = await seedGame(stranger.id, 'ww2', 'era_ww2');
    expect((await send(stranger, { source: 'game_over', rating: 'up', game_id: theirs })).statusCode).toBe(403);
    expect((await send(stranger, { source: 'game_over', rating: 'up', game_id: ww2 })).statusCode).toBe(403);
  });

  it('reads back in Admin → Feedback, newest first, with its counts', async () => {
    setBeta(true);
    const admin = await seedUser('fb_reader', true);
    const player = await seedUser('fb_reported');
    await send(player, { source: 'beta_panel', rating: 'up', comment: 'first' });
    await send(player, { source: 'beta_panel', rating: 'down', comment: 'second' });

    const res = await app.inject({ method: 'GET', url: '/api/admin/feedback?days=1', headers: auth(admin) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { summary: { total: number; up: number; down: number }; items: Array<{ comment: string; username: string; user_id: string }> };
    const mine = body.items.filter((i) => i.user_id === player.id);
    expect(mine.map((i) => i.comment)).toEqual(['second', 'first']);
    expect(mine[0].username).toBe(player.name);
    expect(body.summary.total).toBeGreaterThanOrEqual(2);
    expect(body.summary.up).toBeGreaterThanOrEqual(1);
    expect(body.summary.down).toBeGreaterThanOrEqual(1);

    const downOnly = await app.inject({ method: 'GET', url: '/api/admin/feedback?days=1&rating=down', headers: auth(admin) });
    const downItems = (downOnly.json() as { items: Array<{ rating: string }> }).items;
    expect(downItems.every((i) => i.rating === 'down')).toBe(true);

    const asPlayer = await app.inject({ method: 'GET', url: '/api/admin/feedback', headers: auth(player) });
    expect(asPlayer.statusCode).toBe(403);
  });

  it('deletes what an account wrote when the account is deleted', async () => {
    setBeta(true);
    const player = await seedUser('fb_leaver');
    await send(player, { source: 'beta_panel', comment: 'bye' });
    await query('DELETE FROM users WHERE user_id = $1', [player.id]);
    const rows = await query('SELECT 1 FROM game_feedback WHERE user_id = $1', [player.id]);
    expect(rows).toHaveLength(0);
  });
});
