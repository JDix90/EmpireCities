/**
 * Chat safety through the real routes: blocks, reports quoted from the
 * server's own copy of the message, Admin → Reports, the switch, and what
 * deleting an account leaves behind.
 *
 * Needs Postgres (migrated schema) and Redis, gated on PG_TEST=1 and REDIS_TEST=1:
 *   PG_TEST=1 REDIS_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= REDIS_HOST=127.0.0.1 REDIS_PORT=6399 \
 *     pnpm exec vitest run src/modules/safety/chatSafety.db.test.ts
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

// The admins' badge is told about each report filed or closed (reportAlerts.ts,
// which loads the game server); here it is only counted.
const announceMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('./reportAlerts', () => ({ announceOpenReports: announceMock, ADMIN_CHAT_REPORTS_EVENT: 'admin:chat_reports' }));

const enabled = process.env.PG_TEST === '1' && process.env.REDIS_TEST === '1';

type User = { id: string; name: string; admin: boolean; guest: boolean };

describe.runIf(enabled)('chat safety (Postgres + Redis)', () => {
  let app: FastifyInstance;
  let query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  let signAccessToken: (p: { sub: string; username: string; guest?: boolean; admin?: boolean }) => string;
  let setSafety: (on: boolean) => void;
  let remember: typeof import('./chatSafety.service').rememberChatMessage;
  const userIds: string[] = [];
  const gameIds: string[] = [];

  async function seedUser(base: string, opts: { admin?: boolean; guest?: boolean } = {}): Promise<User> {
    const id = uuidv4();
    const name = `${base}_${id.slice(0, 8)}`;
    userIds.push(id);
    await query(
      `INSERT INTO users (user_id, username, email, password_hash, is_admin, is_guest)
       VALUES ($1, $2, $3, 'x', $4, $5)`,
      [id, name, `${name}@${opts.guest ? 'guest' : 'test'}.local`, !!opts.admin, !!opts.guest],
    );
    return { id, name, admin: !!opts.admin, guest: !!opts.guest };
  }

  async function seedGame(): Promise<string> {
    const gameId = uuidv4();
    gameIds.push(gameId);
    await query(
      `INSERT INTO games (game_id, map_id, era_id, status, settings_json, game_type)
       VALUES ($1, 'era_medieval', 'medieval', 'in_progress', '{"max_players": 2}'::jsonb, 'solo')`,
      [gameId],
    );
    return gameId;
  }

  const auth = (u: User) => ({
    authorization: `Bearer ${signAccessToken({ sub: u.id, username: u.name, guest: u.guest, admin: u.admin })}`,
  });
  const call = (u: User, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: Record<string, unknown>) =>
    app.inject({ method, url, headers: auth(u), ...(payload ? { payload } : {}) });

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as {
      query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    });
    ({ signAccessToken } = await import('../../utils/jwt'));
    ({ rememberChatMessage: remember } = await import('./chatSafety.service'));
    const adminConfig = await import('../../services/adminConfig');
    setSafety = (on) => adminConfig.setAdminConfigCacheForTests({ feature_flags: { chat_safety_enabled: on } });
    const { registerErrorHandler } = await import('../../errorHandler');
    const { chatSafetyRoutes } = await import('./chatSafety.routes');
    const { adminRoutes } = await import('../admin/admin.routes');
    app = Fastify();
    registerErrorHandler(app);
    await app.register(chatSafetyRoutes, { prefix: '/api/safety' });
    await app.register(adminRoutes, { prefix: '/api/admin' });
    await app.ready();
    setSafety(true);
  }, 30_000);

  afterAll(async () => {
    setSafety?.(false);
    if (app) await app.close();
    if (userIds.length) {
      await query('DELETE FROM chat_reports WHERE reporter_id = ANY($1) OR reported_id = ANY($1)', [userIds]).catch(() => {});
    }
    if (gameIds.length) {
      await query('DELETE FROM chat_reports WHERE game_id = ANY($1)', [gameIds]).catch(() => {});
      await query('DELETE FROM games WHERE game_id = ANY($1)', [gameIds]).catch(() => {});
    }
    if (userIds.length) {
      await query('DELETE FROM users WHERE user_id = ANY($1)', [userIds]).catch(() => {});
    }
  });

  it('lets a guest block and unblock a player, and lists who they have blocked', async () => {
    const guest = await seedUser('cs_guest', { guest: true });
    const rude = await seedUser('cs_rude');
    expect((await call(guest, 'POST', '/api/safety/blocks', { user_id: rude.id })).statusCode).toBe(201);
    // Twice is still one block.
    expect((await call(guest, 'POST', '/api/safety/blocks', { user_id: rude.id })).statusCode).toBe(201);
    const list = (await call(guest, 'GET', '/api/safety/blocks')).json() as { blocks: Array<{ user_id: string; username: string }> };
    expect(list.blocks).toEqual([expect.objectContaining({ user_id: rude.id, username: rude.name })]);

    const { blockersOf } = await import('./chatSafety.service');
    expect(await blockersOf(rude.id)).toEqual([guest.id]);

    expect((await call(guest, 'DELETE', `/api/safety/blocks/${rude.id}`)).statusCode).toBe(204);
    expect(((await call(guest, 'GET', '/api/safety/blocks')).json() as { blocks: unknown[] }).blocks).toEqual([]);
  });

  it('refuses to block yourself or a player who does not exist', async () => {
    const me = await seedUser('cs_self');
    expect((await call(me, 'POST', '/api/safety/blocks', { user_id: me.id })).statusCode).toBe(400);
    expect((await call(me, 'POST', '/api/safety/blocks', { user_id: uuidv4() })).statusCode).toBe(404);
  });

  it('files a report with the server\'s copy of the message, not the reporter\'s', async () => {
    const reporter = await seedUser('cs_reporter');
    const sender = await seedUser('cs_sender');
    const gameId = await seedGame();
    const messageId = uuidv4();
    await remember(gameId, { id: messageId, channel: 'game', senderId: sender.id, username: sender.name, message: 'you are ****', at: Date.now() });

    const res = await call(reporter, 'POST', '/api/safety/reports', {
      game_id: gameId, channel: 'game', message_id: messageId, reported_user_id: sender.id,
      reason: 'harassment', details: 'kept at it all game', message: 'something else entirely',
    });
    expect(res.statusCode).toBe(201);
    // A second tap files nothing new.
    expect((await call(reporter, 'POST', '/api/safety/reports', {
      game_id: gameId, channel: 'game', message_id: messageId, reported_user_id: sender.id, reason: 'harassment',
    })).statusCode).toBe(201);

    const rows = await query('SELECT * FROM chat_reports WHERE reporter_id = $1', [reporter.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reported_id: sender.id, reported_username: sender.name, game_id: gameId, channel: 'game',
      message: 'you are ****', message_verified: true, reason: 'harassment', details: 'kept at it all game', status: 'open',
    });
  });

  it('will not pin a kept message on someone who did not send it', async () => {
    const reporter = await seedUser('cs_reporter2');
    const sender = await seedUser('cs_sender2');
    const bystander = await seedUser('cs_bystander');
    const gameId = await seedGame();
    const messageId = uuidv4();
    await remember(gameId, { id: messageId, channel: 'lobby', senderId: sender.id, username: sender.name, message: 'hi', at: Date.now() });
    expect((await call(reporter, 'POST', '/api/safety/reports', {
      game_id: gameId, channel: 'lobby', message_id: messageId, reported_user_id: bystander.id, reason: 'spam',
    })).statusCode).toBe(400);
  });

  it('files the reporter\'s copy, marked unverified, once the server no longer has the message', async () => {
    const reporter = await seedUser('cs_reporter3');
    const sender = await seedUser('cs_sender3');
    const gameId = await seedGame();
    expect((await call(reporter, 'POST', '/api/safety/reports', {
      game_id: gameId, channel: 'spectator', message_id: uuidv4(), reported_user_id: sender.id,
      reason: 'name', message: 'their name is the problem',
    })).statusCode).toBe(201);
    const [row] = await query('SELECT message, message_verified, reported_username FROM chat_reports WHERE reporter_id = $1', [reporter.id]);
    expect(row).toMatchObject({ message: 'their name is the problem', message_verified: false, reported_username: sender.name });
  });

  it('shows reports in Admin → Reports and closes them, for admins only', async () => {
    const admin = await seedUser('cs_admin', { admin: true });
    const reporter = await seedUser('cs_reporter4');
    const sender = await seedUser('cs_sender4');
    const gameId = await seedGame();
    const messageId = uuidv4();
    await remember(gameId, { id: messageId, channel: 'game', senderId: sender.id, username: sender.name, message: 'spam spam', at: Date.now() });
    await call(reporter, 'POST', '/api/safety/reports', {
      game_id: gameId, channel: 'game', message_id: messageId, reported_user_id: sender.id, reason: 'spam',
    });

    // Filing it told the admins.
    expect(announceMock).toHaveBeenCalled();

    expect((await call(reporter, 'GET', '/api/admin/chat-reports')).statusCode).toBe(403);
    // The badge's count: admins only, and it matches the list.
    expect((await call(reporter, 'GET', '/api/admin/chat-reports/open-count')).statusCode).toBe(403);
    const count = (await call(admin, 'GET', '/api/admin/chat-reports/open-count')).json() as { open: number };
    const list = (await call(admin, 'GET', '/api/admin/chat-reports?status=open')).json() as {
      open: number; items: Array<Record<string, unknown>>;
    };
    expect(list.open).toBeGreaterThanOrEqual(1);
    expect(count.open).toBe(list.open);
    const item = list.items.find((i) => i.reported_id === sender.id)!;
    expect(item).toMatchObject({
      reporter_username: reporter.name, reported_username: sender.name, message: 'spam spam',
      message_verified: true, reported_open_reports: 1, reported_is_banned: false,
    });

    announceMock.mockClear();
    const close = await call(admin, 'POST', `/api/admin/chat-reports/${item.report_id}`, { status: 'actioned', note: 'warned' });
    expect(close.statusCode).toBe(200);
    // Closing it told the admins too, and the count went down by one.
    expect(announceMock).toHaveBeenCalledTimes(1);
    expect(((await call(admin, 'GET', '/api/admin/chat-reports/open-count')).json() as { open: number }).open).toBe(count.open - 1);
    const [row] = await query('SELECT status, resolution_note, resolved_by FROM chat_reports WHERE report_id = $1', [item.report_id]);
    expect(row).toMatchObject({ status: 'actioned', resolution_note: 'warned', resolved_by: admin.id });
    expect((await call(admin, 'POST', `/api/admin/chat-reports/${uuidv4()}`, { status: 'dismissed' })).statusCode).toBe(404);
  });

  it('is closed to players with the switch off, but not to admins', async () => {
    const player = await seedUser('cs_off');
    const admin = await seedUser('cs_off_admin', { admin: true });
    setSafety(false);
    try {
      expect((await call(player, 'GET', '/api/safety/blocks')).statusCode).toBe(404);
      expect((await call(admin, 'GET', '/api/safety/blocks')).statusCode).toBe(200);
    } finally {
      setSafety(true);
    }
  });

  it('removes blocks with either account, and keeps a report readable after the reported account goes', async () => {
    const reporter = await seedUser('cs_keep');
    const sender = await seedUser('cs_gone');
    const gameId = await seedGame();
    await call(reporter, 'POST', '/api/safety/blocks', { user_id: sender.id });
    await call(reporter, 'POST', '/api/safety/reports', {
      game_id: gameId, channel: 'game', reported_user_id: sender.id, reason: 'hate', message: 'awful',
    });
    await query('DELETE FROM users WHERE user_id = $1', [sender.id]);
    expect(await query('SELECT 1 FROM user_blocks WHERE blocker_id = $1', [reporter.id])).toHaveLength(0);
    const [row] = await query('SELECT reported_id, reported_username, message FROM chat_reports WHERE reporter_id = $1', [reporter.id]);
    expect(row).toMatchObject({ reported_id: null, reported_username: sender.name, message: 'awful' });
  });
});
