/**
 * Admin → ban signs the account out everywhere: after setting `is_banned`, the
 * route revokes its refresh tokens and drops its live sockets
 * (services/bans.ts), so a banned player cannot keep playing on an open session.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const queryMock = vi.hoisted(() => vi.fn());
const endSessionsMock = vi.hoisted(() => vi.fn());
const fakeIo = vi.hoisted(() => ({ marker: 'io' }));

vi.mock('../../db/postgres', () => ({
  query: (...a: unknown[]) => queryMock(...a),
  queryOne: async () => null,
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
vi.mock('../../services/bans', () => ({
  endSessionsForBannedUser: (...a: unknown[]) => endSessionsMock(...a),
}));
vi.mock('../../sockets/gameSocket', () => ({
  getGameIo: () => fakeIo,
}));

const TARGET = '11111111-2222-4333-8444-555555555555';
const ADMIN = { 'x-test-admin': '1' };

async function buildApp(): Promise<FastifyInstance> {
  const { adminRoutes } = await import('./admin.routes');
  const app = Fastify();
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.ready();
  return app;
}

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue([]);
  endSessionsMock.mockReset();
  endSessionsMock.mockResolvedValue(undefined);
});

describe('POST /api/admin/actions/ban', () => {
  it('bans the account and ends its sessions', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'POST', url: '/api/admin/actions/ban', headers: ADMIN, payload: { user_id: TARGET } });
      expect(res.statusCode).toBe(200);
      expect(queryMock.mock.calls.some(([sql, params]) =>
        /UPDATE users SET is_banned = TRUE/.test(String(sql)) && (params as unknown[])[0] === TARGET)).toBe(true);
      expect(endSessionsMock).toHaveBeenCalledWith(TARGET, fakeIo);
    } finally {
      await app.close();
    }
  });

  it('does nothing for a non-admin', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'POST', url: '/api/admin/actions/ban', payload: { user_id: TARGET } });
      expect(res.statusCode).toBe(403);
      expect(endSessionsMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
