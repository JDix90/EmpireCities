/**
 * Regression test for the "Redis blip = every endpoint 500s" outage.
 *
 * @fastify/rate-limit defaults to `skipOnError: false`, which RETHROWS any
 * counter-store error out of the rate-limit hook. Our global limiter is a
 * global onRequest hook backed by Redis, so a Redis that refuses writes turned
 * the entire API — /api/auth/login, /api/auth/guest, even /health — into a
 * blanket 500 "Internal server error".
 *
 * The trigger does not require Redis to be *down*: a Redis at `maxmemory` with
 * `noeviction`, or one gone read-only after a failed AOF/BGSAVE (MISCONF),
 * still answers PING with PONG while rejecting every INCR with an -OOM error.
 *
 * These tests use a stub store that always errors, so they need no Redis.
 */

import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';

/**
 * Minimal @fastify/rate-limit store that fails every increment the way a
 * write-rejecting Redis does. Mirrors the plugin's callback store contract.
 */
function makeFailingStore(message: string) {
  class FailingStore {
    incr(_key: string, cb: (err: Error | null, res?: unknown) => void): void {
      cb(new Error(message));
    }
    child(): FailingStore {
      return this;
    }
  }
  return FailingStore;
}

const OOM = "OOM command not allowed when used memory > 'maxmemory'.";

async function buildApp(skipOnError: boolean) {
  const app = Fastify();
  await app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute',
    store: makeFailingStore(OOM),
    keyGenerator: () => 'k:test',
    skipOnError,
  });
  app.get('/health', async () => ({ status: 'ok' }));
  app.post('/api/auth/guest', async () => ({ guest: true }));
  return app;
}

describe('rate-limit store outage', () => {
  it('reproduces the outage: with skipOnError false, a write-rejecting store 500s every route', async () => {
    const app = await buildApp(false);

    const guest = await app.inject({ method: 'POST', url: '/api/auth/guest' });
    expect(guest.statusCode).toBe(500);

    // The blast radius is the whole API, not just auth — including the
    // liveness endpoint, which is what made this look like a total outage.
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(500);

    await app.close();
  });

  it('fix: with skipOnError true, requests are served while the store is unavailable', async () => {
    const app = await buildApp(true);

    const guest = await app.inject({ method: 'POST', url: '/api/auth/guest' });
    expect(guest.statusCode).toBe(200);
    expect(guest.json()).toEqual({ guest: true });

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);

    await app.close();
  });
});

// Always-on static guard: a limiter registered without skipOnError reintroduces
// the outage, and it only shows up when Redis is already having a bad day.
describe('rate-limit store outage (static)', () => {
  it('src/index.ts sets skipOnError on every limiter registration', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    const registrations = src.match(/register\(fastifyRateLimit/g) ?? [];
    const skips = src.match(/skipOnError: true/g) ?? [];
    expect(registrations.length).toBeGreaterThan(0);
    expect(skips.length).toBe(registrations.length);
  });
});
