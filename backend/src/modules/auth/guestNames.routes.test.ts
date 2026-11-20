/**
 * POST /api/auth/guest names the new guest like "SwiftFalcon_48213". A taken
 * name retries with a fresh draw.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const queryMock = vi.hoisted(() => vi.fn());
vi.mock('../../db/postgres', () => ({
  query: (...a: unknown[]) => queryMock(...a),
  queryOne: async (...a: unknown[]) => ((await queryMock(...a)) as unknown[])[0] ?? null,
  withTransaction: async (fn: (client: { query: typeof queryMock }) => Promise<unknown>) => fn({ query: queryMock }),
  pgPool: { query: (...a: unknown[]) => queryMock(...a) },
}));
vi.mock('../../services/notificationService', () => ({
  sendTransactionalEmailToAddress: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../services/analyticsEvents', () => ({ recordServerEvent: vi.fn() }));

async function buildApp(): Promise<FastifyInstance> {
  const { default: fastifyCookie } = await import('@fastify/cookie');
  const { config } = await import('../../config');
  const { authRoutes } = await import('./auth.routes');
  const app = Fastify();
  await app.register(fastifyCookie, { secret: config.jwt.refreshSecret });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.ready();
  return app;
}

/** The usernames the route tried to insert, in order. */
const tried = () =>
  queryMock.mock.calls.filter(([sql]) => /INSERT INTO users/.test(String(sql))).map(([, params]) => (params as string[])[1]);

async function newGuest(takenFirst = 0): Promise<string> {
  let refusals = takenFirst;
  queryMock.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/INSERT INTO users/.test(sql)) return refusals-- > 0 ? [] : [{ user_id: params[0] }];
    return [];
  });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'POST', url: '/api/auth/guest', payload: {} });
    expect(res.statusCode).toBe(200);
    return res.json().user.username as string;
  } finally {
    await app.close();
  }
}

describe('guest names', () => {
  let adminConfig: typeof import('../../services/adminConfig');
  beforeEach(async () => {
    queryMock.mockReset();
    adminConfig = await import('../../services/adminConfig');
  });
  afterEach(() => adminConfig.resetAdminConfigCacheForTests());

  it('names a new guest like SwiftFalcon_48213', async () => {
    expect(await newGuest()).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+_\d{5}$/);
  });

  it('draws a fresh name when one is taken', async () => {
    const name = await newGuest(1);
    const attempts = tried();
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toBe(name);
    expect(attempts[0]).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+_\d{5}$/);
  });
});
