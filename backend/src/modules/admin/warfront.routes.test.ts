/**
 * The Warfront admin gate. Every Warfront route must sit behind
 * `preHandler: [authenticate, requireAdmin]` — enforced here by a requireAdmin mock
 * that rejects unless the request carries the admin header, so a route registered
 * without the guard would answer 200 to a plain request and fail the test. The
 * `warfront_enabled` flag is proven to gate the functional endpoint on top.
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
import { resetWarfrontTerrainCacheForTests } from './warfrontStatus';

async function buildApp(): Promise<FastifyInstance> {
  const { adminRoutes } = await import('./admin.routes');
  const app = Fastify();
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.ready();
  return app;
}

const ADMIN = { 'x-test-admin': '1' };

/**
 * Registering adminRoutes refreshes the admin-config cache from the database, so an
 * override has to arrive the way it does in production: as the admin_config row.
 */
function flagOverrideInDb(flags: Record<string, boolean>): void {
  queryMock.mockImplementation(async (sql: unknown) =>
    /FROM admin_config/.test(String(sql)) ? [{ config_key: 'feature_flags', value: flags }] : [],
  );
}

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue([]);
  resetWarfrontTerrainCacheForTests();
});

afterEach(() => {
  resetAdminConfigCacheForTests();
});

describe('Warfront admin gate', () => {
  it('refuses /warfront/status and /warfront/terrain to a non-admin, flag or no flag', async () => {
    flagOverrideInDb({ warfront_enabled: true });
    const app = await buildApp();
    try {
      for (const url of ['/api/admin/warfront/status', '/api/admin/warfront/terrain']) {
        const res = await app.inject({ method: 'GET', url });
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'Admin access required' });
      }
    } finally {
      await app.close();
    }
  });

  it('reports the flag off and the committed asset to an admin, without serving the asset', async () => {
    const app = await buildApp();
    try {
      const status = await app.inject({ method: 'GET', url: '/api/admin/warfront/status', headers: ADMIN });
      expect(status.statusCode).toBe(200);
      const body = status.json();
      expect(body.enabled).toBe(false);
      expect(body.flag).toBe('warfront_enabled');
      expect(body.terrain_error).toBeNull();
      expect(body.terrain).toMatchObject({ id: 'western_twenty', map_id: 'community_roman_empire_117', provinces: 20, lanes: 14 });
      expect(body.terrain.cells).toBe(body.terrain.width * body.terrain.height);
      expect(body.terrain.checksum).toMatch(/^[0-9a-f]{16}$/);

      const terrain = await app.inject({ method: 'GET', url: '/api/admin/warfront/terrain', headers: ADMIN });
      expect(terrain.statusCode).toBe(404);
      expect(terrain.json()).toEqual({ error: 'Warfront is not enabled' });
    } finally {
      await app.close();
    }
  });

  it('serves the asset to an admin once the flag override is on', async () => {
    flagOverrideInDb({ warfront_enabled: true });
    const app = await buildApp();
    try {
      const status = await app.inject({ method: 'GET', url: '/api/admin/warfront/status', headers: ADMIN });
      expect(status.json().enabled).toBe(true);
      const terrain = await app.inject({ method: 'GET', url: '/api/admin/warfront/terrain', headers: ADMIN });
      expect(terrain.statusCode).toBe(200);
      expect(terrain.headers['content-type']).toMatch(/application\/json/);
      const asset = terrain.json();
      expect(asset.format).toBe('warfront-terrain');
      expect(asset.rows).toHaveLength(asset.height);
      expect(asset.checksum).toBe(status.json().terrain.checksum);
    } finally {
      await app.close();
    }
  });
});
