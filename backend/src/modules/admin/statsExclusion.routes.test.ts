/**
 * Admin and test accounts stay out of the admin stats
 * (services/statsExclusion.ts): Users → "Mark test" sets the column, and every
 * stats query carries the filter, so a new query that forgets it fails here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { countedGameSql, excludedUserSql } from '../../services/statsExclusion';

const queryMock = vi.hoisted(() => vi.fn());
const queryOneMock = vi.hoisted(() => vi.fn());

vi.mock('../../db/postgres', () => ({
  query: (...a: unknown[]) => queryMock(...a),
  queryOne: (...a: unknown[]) => queryOneMock(...a),
  withTransaction: async (fn: (c: unknown) => Promise<unknown>) => fn({ query: async () => ({ rows: [] }) }),
  pgPool: { query: (...a: unknown[]) => queryMock(...a) },
}));
vi.mock('../../middleware/authenticate', () => ({
  authenticate: async (req: { userId?: string; isAdmin?: boolean; headers: Record<string, unknown> }) => {
    req.userId = 'admin-1';
    req.isAdmin = req.headers['x-test-admin'] === '1';
  },
}));
vi.mock('../../middleware/requireAdmin', () => ({
  requireAdmin: async (
    req: { isAdmin?: boolean },
    reply: { status: (c: number) => { send: (b: unknown) => unknown } },
  ) => {
    if (!req.isAdmin) return reply.status(403).send({ error: 'Admin access required' });
  },
}));
vi.mock('../../db/redis', () => {
  const client = {
    duplicate: () => client,
    on: () => client,
    subscribe: async () => {},
    publish: async () => 0,
    get: async () => null,
    set: async () => 'OK',
    quit: async () => 'OK',
  };
  return { redis: client, default: client };
});
// Loaded by the admin routes for bans; stubbed so the app builds without Redis.
vi.mock('../../services/bans', () => ({ endSessionsForBannedUser: async () => {} }));
vi.mock('../../sockets/gameSocket', () => ({ getGameIo: () => null }));

const TARGET = '11111111-2222-4333-8444-555555555555';
const ADMIN = { 'x-test-admin': '1' };

async function buildApp(): Promise<FastifyInstance> {
  const { adminRoutes } = await import('./admin.routes');
  const app = Fastify();
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.ready();
  return app;
}

/** Every SQL string the route sent, from both query helpers. */
function sqlSent(): string[] {
  return [...queryMock.mock.calls, ...queryOneMock.mock.calls].map(([sql]) => String(sql));
}

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue([]);
  queryOneMock.mockReset();
  queryOneMock.mockResolvedValue({ c: '0', total_games: '1', enabled_count: '0', avg_sec: null });
});

describe('POST /api/admin/actions/set-test-account', () => {
  it('marks an account as a test account and records it in the audit log', async () => {
    queryOneMock.mockResolvedValueOnce({ user_id: TARGET });
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/actions/set-test-account',
        headers: ADMIN,
        payload: { user_id: TARGET, test: true },
      });
      expect(res.statusCode).toBe(200);
      expect(queryOneMock).toHaveBeenCalledWith(expect.stringMatching(/UPDATE users SET exclude_from_stats = \$2/), [TARGET, true]);
      expect(queryMock.mock.calls.some(([sql, params]) =>
        /INSERT INTO admin_audit_log/.test(String(sql)) && (params as unknown[]).includes('user_marked_test'))).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('unmarks one too', async () => {
    queryOneMock.mockResolvedValueOnce({ user_id: TARGET });
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/actions/set-test-account',
        headers: ADMIN,
        payload: { user_id: TARGET, test: false },
      });
      expect(res.statusCode).toBe(200);
      expect(queryOneMock).toHaveBeenCalledWith(expect.any(String), [TARGET, false]);
      expect(queryMock.mock.calls.some(([, params]) => (params as unknown[] | undefined)?.includes('user_unmarked_test'))).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('answers 404 for an unknown account and 400 for a malformed request', async () => {
    queryOneMock.mockResolvedValueOnce(null);
    const app = await buildApp();
    try {
      const missing = await app.inject({
        method: 'POST', url: '/api/admin/actions/set-test-account', headers: ADMIN, payload: { user_id: TARGET, test: true },
      });
      expect(missing.statusCode).toBe(404);
      const malformed = await app.inject({
        method: 'POST', url: '/api/admin/actions/set-test-account', headers: ADMIN, payload: { user_id: TARGET },
      });
      expect(malformed.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('is admin-only', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST', url: '/api/admin/actions/set-test-account', payload: { user_id: TARGET, test: true },
      });
      expect(res.statusCode).toBe(403);
      expect(queryOneMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

describe('every stats query leaves out admin and test accounts', () => {
  const COUNTED = countedGameSql('g');
  const EXCLUDED = excludedUserSql('u');

  it.each([
    '/api/admin/metrics/overview',
    '/api/admin/metrics/timeseries',
    '/api/admin/metrics/factions',
    '/api/admin/metrics/eras',
    '/api/admin/metrics/maps',
    '/api/admin/metrics/duration',
    '/api/admin/metrics/settings-toggles',
  ])('%s filters every games query', async (url) => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url, headers: ADMIN });
      expect(res.statusCode).toBe(200);
      const gameQueries = sqlSent().filter((sql) => /FROM games g\b/.test(sql) || /JOIN games g\b/.test(sql));
      expect(gameQueries.length).toBeGreaterThan(0);
      for (const sql of gameQueries) expect(sql).toContain(COUNTED);
    } finally {
      await app.close();
    }
  });

  it('the overview counts only accounts that are not left out', async () => {
    const app = await buildApp();
    try {
      await app.inject({ method: 'GET', url: '/api/admin/metrics/overview', headers: ADMIN });
      const usersCount = sqlSent().find((sql) => /FROM users u\b/.test(sql));
      expect(usersCount).toContain(`NOT ${EXCLUDED}`);
    } finally {
      await app.close();
    }
  });

  it('the ranked distribution leaves out their ratings', async () => {
    const app = await buildApp();
    try {
      await app.inject({ method: 'GET', url: '/api/admin/metrics/ranked-distribution', headers: ADMIN });
      const ratings = sqlSent().find((sql) => /FROM user_ratings/.test(sql));
      expect(ratings).toContain(`NOT ${EXCLUDED}`);
    } finally {
      await app.close();
    }
  });
});
