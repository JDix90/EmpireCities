/**
 * Regression test for the shared rate-limit-counter bug.
 *
 * @fastify/rate-limit's Redis store keys counters as `nameSpace + key`, and
 * every registration defaults to the SAME nameSpace ('fastify-rate-limit-').
 * Our global (max 100), /api/auth (max 30) and /api/admin (max 30) limiters
 * all share one Redis client and key by user id, so before the fix they all
 * incremented ONE counter per user — ordinary lobby traffic filled the admin
 * scope's max=30 and the admin dashboard 429'd on its very first request.
 *
 * This test mirrors the registration shape in src/index.ts (a global limiter
 * plus a scoped limiter with a lower max) and proves the scoped limiter is
 * unaffected by traffic outside its scope. Requires Redis: REDIS_TEST=1.
 */

import { describe, it, expect, afterAll } from 'vitest';
import Fastify from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import Redis from 'ioredis';

const REDIS_ENABLED = process.env.REDIS_TEST === '1';
const d = REDIS_ENABLED ? describe : describe.skip;

d('rate-limit namespaces (Redis)', () => {
  const redis = REDIS_ENABLED
    ? new Redis({ port: Number(process.env.REDIS_PORT ?? 6379), connectTimeout: 500, maxRetriesPerRequest: 1 })
    : null;

  afterAll(async () => {
    await redis?.quit();
  });

  async function buildApp(nameSpaces: { global?: string; admin?: string }) {
    const app = Fastify();
    const keyGenerator = () => 'u:test-user';
    await app.register(fastifyRateLimit, {
      max: 100,
      timeWindow: '1 minute',
      redis: redis!,
      keyGenerator,
      ...(nameSpaces.global ? { nameSpace: nameSpaces.global } : {}),
    });
    app.get('/api/other', async () => ({ ok: true }));
    await app.register(
      async (scope) => {
        await scope.register(fastifyRateLimit, {
          max: 30,
          timeWindow: '1 minute',
          redis: redis!,
          keyGenerator,
          ...(nameSpaces.admin ? { nameSpace: nameSpaces.admin } : {}),
        });
        scope.get('/', async () => ({ ok: true }));
      },
      { prefix: '/api/admin' },
    );
    return app;
  }

  async function flushTestKeys(prefixes: string[]) {
    for (const prefix of [...prefixes, 'fastify-rate-limit-']) {
      const keys = await redis!.keys(`${prefix}u:test-user*`);
      if (keys.length) await redis!.del(...keys);
    }
  }

  it('reproduces the bug: with the default shared nameSpace, outside traffic exhausts the admin scope', async () => {
    await flushTestKeys([]);
    const app = await buildApp({});
    // 30 requests elsewhere in the app fill the shared counter…
    for (let i = 0; i < 30; i++) {
      const res = await app.inject({ method: 'GET', url: '/api/other' });
      expect(res.statusCode).toBe(200);
    }
    // …so the FIRST admin request is already over the scope's max=30.
    const adminRes = await app.inject({ method: 'GET', url: '/api/admin/' });
    expect(adminRes.statusCode).toBe(429);
    await app.close();
  });

  it('fix: with distinct nameSpaces, the admin scope has its own counter', async () => {
    await flushTestKeys(['rltest-global-', 'rltest-admin-']);
    const app = await buildApp({ global: 'rltest-global-', admin: 'rltest-admin-' });
    for (let i = 0; i < 30; i++) {
      const res = await app.inject({ method: 'GET', url: '/api/other' });
      expect(res.statusCode).toBe(200);
    }
    const adminRes = await app.inject({ method: 'GET', url: '/api/admin/' });
    expect(adminRes.statusCode).toBe(200);
    // And the admin scope still enforces its own max=30 independently.
    for (let i = 0; i < 29; i++) {
      const res = await app.inject({ method: 'GET', url: '/api/admin/' });
      expect(res.statusCode).toBe(200);
    }
    const overLimit = await app.inject({ method: 'GET', url: '/api/admin/' });
    expect(overLimit.statusCode).toBe(429);
    await app.close();
    await flushTestKeys(['rltest-global-', 'rltest-admin-']);
  });

});

// Always-on static guard (no Redis needed): if someone adds a limiter without
// a nameSpace, the Redis counters silently collide again.
describe('rate-limit namespaces (static)', () => {
  it('src/index.ts gives every limiter registration a distinct nameSpace', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    const registrations = src.match(/register\(fastifyRateLimit/g) ?? [];
    const nameSpaces = src.match(/nameSpace: '([^']+)'/g) ?? [];
    expect(registrations.length).toBeGreaterThan(0);
    expect(nameSpaces.length).toBe(registrations.length);
    expect(new Set(nameSpaces).size).toBe(nameSpaces.length);
  });
});
