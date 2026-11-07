/**
 * POST /api/auth/guest no longer pays for a bcrypt hash per guest. A guest has
 * no password and nothing checks the hash its row is created with, so every
 * guest shares one made once per process (guestPassword.ts). The per-guest
 * hash was most of the route's time: p95 673 ms in production, on the first
 * request of every Play Free Now.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';

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

/** The password hashes the route stored, one per guest created. */
const storedHashes = () =>
  queryMock.mock.calls.filter(([sql]) => /INSERT INTO users/.test(String(sql))).map(([, params]) => (params as string[])[3]);

describe('creating a guest', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockImplementation(async (sql: string, params: unknown[] = []) =>
      (/INSERT INTO users/.test(sql) ? [{ user_id: params[0] }] : []));
  });

  it('hashes once per process, not once per guest', async () => {
    const hash = vi.spyOn(bcrypt, 'hash');
    const app = await buildApp();
    try {
      for (let i = 0; i < 3; i += 1) {
        expect((await app.inject({ method: 'POST', url: '/api/auth/guest', payload: {} })).statusCode).toBe(200);
      }
    } finally {
      await app.close();
    }
    expect(hash.mock.calls.length).toBeLessThanOrEqual(1);
    const stored = storedHashes();
    expect(stored).toHaveLength(3);
    expect(new Set(stored).size).toBe(1);
    // A real bcrypt hash at the account cost, of a secret nobody holds.
    expect(stored[0]).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(await bcrypt.compare('', stored[0]!)).toBe(false);
    hash.mockRestore();
  });

  it('retries a hash that failed rather than keeping the failure', async () => {
    vi.resetModules();
    const bcryptMod = (await import('bcryptjs')).default;
    const hash = vi.spyOn(bcryptMod, 'hash')
      .mockImplementationOnce(() => Promise.reject(new Error('no entropy')) as never);
    const { guestPasswordHash } = await import('./guestPassword');
    await expect(guestPasswordHash()).rejects.toThrow('no entropy');
    await expect(guestPasswordHash()).resolves.toMatch(/^\$2[aby]\$/);
    expect(hash).toHaveBeenCalledTimes(2);
    hash.mockRestore();
  });
});
