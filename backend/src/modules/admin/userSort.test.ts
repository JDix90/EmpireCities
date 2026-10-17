/**
 * Sorting the admin user list.
 *
 * The ORDER BY clause cannot be parameterized, so the sort column comes from a
 * whitelist and the request's own string never reaches the SQL. These tests pin
 * that, and pin the two ordering choices that make the sort useful: NULLS LAST
 * in both directions (a nullable `last_login_at` would otherwise open ascending
 * on a page of accounts nobody has ever signed into) and a `user_id` tiebreak
 * so equal timestamps keep a stable order between requests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const queryMock = vi.hoisted(() => vi.fn());
const queryOneMock = vi.hoisted(() => vi.fn());
vi.mock('../../db/postgres', () => ({
  query: (...a: unknown[]) => queryMock(...a),
  queryOne: (...a: unknown[]) => queryOneMock(...a),
  withTransaction: async (fn: (c: unknown) => Promise<unknown>) => fn({ query: async () => ({ rows: [] }) }),
  pgPool: { query: (...a: unknown[]) => queryMock(...a) },
}));
vi.mock('../../middleware/authenticate', () => ({
  authenticate: async (req: { userId?: string; isAdmin?: boolean }) => {
    req.userId = 'admin-1';
    req.isAdmin = true;
  },
}));
vi.mock('../../middleware/requireAdmin', () => ({ requireAdmin: async () => {} }));
// The admin module pulls in adminConfig, which opens a Redis client on import.
// Nothing under test reads it, and a live connection attempt just adds a
// connect-refused stall to every run.
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

async function buildApp(): Promise<FastifyInstance> {
  const { adminRoutes } = await import('./admin.routes');
  const app = Fastify();
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.ready();
  return app;
}

/** The SELECT the /users handler runs (other queries may precede it). */
function usersSql(): string {
  const call = queryMock.mock.calls.find(([sql]) => /FROM users u/.test(String(sql)));
  return String(call?.[0] ?? '');
}

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue([]);
  queryOneMock.mockReset();
  queryOneMock.mockResolvedValue(null);
});

describe('GET /admin/users ordering', () => {
  it('defaults to newest accounts first, as before', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/admin/users' });
      expect(res.statusCode).toBe(200);
      expect(usersSql()).toMatch(/ORDER BY u\.created_at DESC NULLS LAST, u\.user_id ASC/);
    } finally {
      await app.close();
    }
  });

  it('sorts by last login in either direction', async () => {
    const app = await buildApp();
    try {
      await app.inject({ method: 'GET', url: '/api/admin/users?sort=last_login_at&order=desc' });
      expect(usersSql()).toMatch(/ORDER BY u\.last_login_at DESC NULLS LAST/);

      queryMock.mockClear();
      await app.inject({ method: 'GET', url: '/api/admin/users?sort=last_login_at&order=asc' });
      // Ascending still buries the never-signed-in: they are not what this sort is for.
      expect(usersSql()).toMatch(/ORDER BY u\.last_login_at ASC NULLS LAST/);
    } finally {
      await app.close();
    }
  });

  it('rejects a column outside the whitelist instead of interpolating it', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/admin/users?sort=${encodeURIComponent('u.email; DROP TABLE users;--')}`,
      });
      expect(res.statusCode).toBe(400);
      expect(usersSql()).toBe('');
    } finally {
      await app.close();
    }
  });

  it('ignores an unknown order and falls back to descending', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/admin/users?order=sideways' });
      // The enum rejects it rather than silently ordering by something arbitrary.
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('still applies the search filter and limit alongside the sort', async () => {
    const app = await buildApp();
    try {
      await app.inject({ method: 'GET', url: '/api/admin/users?search=ada&sort=last_login_at&limit=10' });
      const call = queryMock.mock.calls.find(([sql]) => /FROM users u/.test(String(sql)));
      expect(String(call?.[0])).toMatch(/ILIKE \$1/);
      expect(call?.[1]).toEqual(['%ada%', 10, 0]);
    } finally {
      await app.close();
    }
  });
});

describe('GET /admin/users pages', () => {
  it('returns a page of accounts and how many match in all', async () => {
    const app = await buildApp();
    try {
      queryMock.mockResolvedValueOnce([{ user_id: 'u51', username: 'fifty_one' }]);
      queryOneMock.mockResolvedValueOnce({ total: 120 });
      const res = await app.inject({ method: 'GET', url: '/api/admin/users?search=ada&limit=50&offset=50' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ users: [{ user_id: 'u51', username: 'fifty_one' }], total: 120 });
      expect(usersSql()).toMatch(/LIMIT \$2 OFFSET \$3/);
      const call = queryMock.mock.calls.find(([sql]) => /FROM users u/.test(String(sql)));
      expect(call?.[1]).toEqual(['%ada%', 50, 50]);
      // The count applies the same search, and nothing else.
      const [countSql, countParams] = queryOneMock.mock.calls[0] ?? [];
      expect(String(countSql)).toMatch(/COUNT\(\*\)::int AS total FROM users u WHERE .*ILIKE \$1/);
      expect(countParams).toEqual(['%ada%']);
    } finally {
      await app.close();
    }
  });

  it('starts at the first account, and refuses a negative offset', async () => {
    const app = await buildApp();
    try {
      const first = await app.inject({ method: 'GET', url: '/api/admin/users' });
      expect(first.json()).toEqual({ users: [], total: 0 });
      const call = queryMock.mock.calls.find(([sql]) => /FROM users u/.test(String(sql)));
      expect(call?.[1]).toEqual(['%%', 25, 0]);
      const bad = await app.inject({ method: 'GET', url: '/api/admin/users?offset=-1' });
      expect(bad.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
