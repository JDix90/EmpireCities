/**
 * Who the backend thinks a visitor is. In production every request arrives
 * from nginx on the Docker network, carrying the visitor's address in
 * X-Forwarded-For; `request.ip` must be that visitor, or every anonymous
 * visitor shares one rate-limit bucket.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import { PRIVATE_NETWORK_PROXIES, parseTrustProxy } from './index';
import { validateProductionEnv } from './validateEnv';
import { userOrIpKey } from '../middleware/rateLimitKey';

const NGINX = '172.18.0.5';
const VISITOR_A = '203.0.113.7';
const VISITOR_B = '198.51.100.23';

function via(proxy: string, visitor: string) {
  return { remoteAddress: proxy, headers: { 'x-forwarded-for': visitor } };
}

async function ipApp(trustProxy: ReturnType<typeof parseTrustProxy> | number) {
  const app = Fastify({ trustProxy: trustProxy as never });
  app.get('/ip', async (request) => ({ ip: request.ip }));
  await app.ready();
  return app;
}

describe('parseTrustProxy', () => {
  it('trusts proxies on private networks by default', () => {
    expect(parseTrustProxy('')).toEqual([...PRIVATE_NETWORK_PROXIES]);
  });

  it('reads an old hop count as the default, since Fastify 5 would trust no proxy', () => {
    expect(parseTrustProxy('1')).toEqual([...PRIVATE_NETWORK_PROXIES]);
    expect(parseTrustProxy(' 2 ')).toEqual([...PRIVATE_NETWORK_PROXIES]);
  });

  it('passes true, false and proxy addresses through', () => {
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('FALSE')).toBe(false);
    expect(parseTrustProxy('10.1.2.3, 10.9.0.0/16')).toBe('10.1.2.3, 10.9.0.0/16');
  });
});

describe('request.ip under the default', () => {
  it('is the visitor nginx reports', async () => {
    const app = await ipApp(parseTrustProxy(''));
    const res = await app.inject({ method: 'GET', url: '/ip', ...via(NGINX, VISITOR_A) });
    expect(res.json()).toEqual({ ip: VISITOR_A });
    await app.close();
  });

  it('ignores the header from a client that is not on a private network', async () => {
    const app = await ipApp(parseTrustProxy(''));
    const res = await app.inject({ method: 'GET', url: '/ip', ...via(VISITOR_B, VISITOR_A) });
    expect(res.json()).toEqual({ ip: VISITOR_B });
    await app.close();
  });

  it('would be nginx for everyone under a hop count, which is why the default is not one', async () => {
    const app = await ipApp(1);
    const res = await app.inject({ method: 'GET', url: '/ip', ...via(NGINX, VISITOR_A) });
    expect(res.json()).toEqual({ ip: NGINX });
    await app.close();
  });
});

describe('the rate limiter behind nginx', () => {
  async function limitedApp() {
    const app = Fastify({ trustProxy: parseTrustProxy('') });
    await app.register(fastifyRateLimit, { max: 1, timeWindow: '1 minute', keyGenerator: userOrIpKey });
    app.get('/ping', async () => ({ ok: true }));
    await app.ready();
    return app;
  }

  it('gives each visitor their own allowance', async () => {
    const app = await limitedApp();
    const first = await app.inject({ method: 'GET', url: '/ping', ...via(NGINX, VISITOR_A) });
    const other = await app.inject({ method: 'GET', url: '/ping', ...via(NGINX, VISITOR_B) });
    const again = await app.inject({ method: 'GET', url: '/ping', ...via(NGINX, VISITOR_A) });
    expect([first.statusCode, other.statusCode, again.statusCode]).toEqual([200, 200, 429]);
    await app.close();
  });
});

describe('validateProductionEnv on TRUST_PROXY', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('warns that a hop count is no longer honoured', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_ACCESS_SECRET', 'a'.repeat(64));
    vi.stubEnv('JWT_REFRESH_SECRET', 'b'.repeat(64));
    vi.stubEnv('POSTGRES_PASSWORD', 'strong-pg-password');
    vi.stubEnv('REDIS_PASSWORD', 'strong-redis-password');
    vi.stubEnv('FRONTEND_URL', 'https://borderfall.gg');
    vi.stubEnv('CORS_ORIGINS', undefined);
    vi.stubEnv('TRUST_PROXY', '1');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => validateProductionEnv()).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('hop count'));
  });
});
