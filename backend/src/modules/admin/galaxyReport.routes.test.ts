/**
 * The Galactic Age report's admin gate. The route must sit behind
 * `preHandler: [authenticate, requireAdmin]` — enforced here by a requireAdmin mock
 * that rejects unless the request carries the admin header, so a route registered
 * without the guard would answer 200 to a plain request and fail the test. Its
 * filters reach the SQL as parameters, never as text.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const queryMock = vi.hoisted(() => vi.fn());
vi.mock('../../db/postgres', () => ({
  query: (...a: unknown[]) => queryMock(...a),
  queryOne: async () => null,
  withTransaction: async (fn: (c: unknown) => Promise<unknown>) => fn({ query: async () => ({ rows: [] }) }),
  pgPool: { query: (...a: unknown[]) => queryMock(...a) },
}));
vi.mock('../../middleware/authenticate', () => ({
  authenticate: async (req: { userId?: string; isAdmin?: boolean; headers: Record<string, unknown> }) => {
    req.userId = 'user-1';
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

import { resetAdminConfigCacheForTests } from '../../services/adminConfig';

async function buildApp(): Promise<FastifyInstance> {
  const { adminRoutes } = await import('./admin.routes');
  const app = Fastify();
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.ready();
  return app;
}

const ADMIN = { 'x-test-admin': '1' };

/** The parameters the report's first query (its games) was sent with. */
function gamesQueryParams(): unknown[] | undefined {
  const call = queryMock.mock.calls.find(([sql]) => /FROM galaxy_game_results r\s+JOIN games/.test(String(sql)));
  return call?.[1] as unknown[] | undefined;
}

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue([]);
});

afterEach(() => {
  resetAdminConfigCacheForTests();
});

describe('GET /api/admin/metrics/galaxy', () => {
  it('refuses a non-admin', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/metrics/galaxy' });
    expect(res.statusCode).toBe(403);
    expect(gamesQueryParams()).toBeUndefined();
    await app.close();
  });

  it('answers an admin, reading all time by default', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/metrics/galaxy', headers: ADMIN });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      total_games: 0, truncated: false, unrecorded_games: 0, games: [],
      filters: { days: null, seats: null, mode: null, relations: null },
      analytics: { games: 0 },
    });
    expect(gamesQueryParams()?.slice(0, 4)).toEqual([null, null, null, null]);
    await app.close();
  });

  it('passes its filters to the SQL as parameters', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/metrics/galaxy?days=30&seats=5&mode=partial_schism&relations=allied',
      headers: ADMIN,
    });
    expect(res.statusCode).toBe(200);
    expect(gamesQueryParams()?.slice(0, 4)).toEqual([30, 5, 'partial_schism', 'allied']);
    await app.close();
  });

  it('reads days=0 as all time', async () => {
    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/api/admin/metrics/galaxy?days=0', headers: ADMIN });
    expect(gamesQueryParams()?.[0]).toBeNull();
    await app.close();
  });

  it.each([
    'seats=9', 'seats=1', 'days=-1', 'mode=classic', "mode=schism'--", 'relations=peace',
  ])('refuses %s', async (qs) => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/api/admin/metrics/galaxy?${qs}`, headers: ADMIN });
    expect(res.statusCode).toBe(400);
    expect(gamesQueryParams()).toBeUndefined();
    await app.close();
  });
});

describe('POST /api/admin/actions/galaxy-backfill', () => {
  const backfillQueried = () =>
    queryMock.mock.calls.some(([sql]) => /ORDER BY g\.ended_at ASC NULLS LAST/.test(String(sql)));

  it('refuses a non-admin', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/admin/actions/galaxy-backfill' });
    expect(res.statusCode).toBe(403);
    expect(backfillQueried()).toBe(false);
    await app.close();
  });

  it('runs for an admin, answers what it did, and writes the audit log', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/admin/actions/galaxy-backfill', headers: ADMIN });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      checked: 0, recorded: 0, more: false,
      skipped: { no_saved_board: 0, not_finished: 0, no_winner: 0, not_recorded: 0 },
    });
    expect(backfillQueried()).toBe(true);
    const audit = queryMock.mock.calls.find(([sql]) => /INSERT INTO admin_audit_log/.test(String(sql)));
    expect(audit?.[1]).toEqual(['user-1', 'galaxy_results_backfilled', expect.stringContaining('"recorded":0')]);
    await app.close();
  });
});
