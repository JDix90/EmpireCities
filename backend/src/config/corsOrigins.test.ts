/**
 * Who may call the API across origins. The iOS app's page is served from
 * inside the app at capacitor://localhost, so every request it makes is
 * cross-origin: the development server allows that origin on its own, and a
 * production server allows it only when CORS_ORIGINS says so. The same list
 * feeds Socket.IO (sockets/gameSocket.ts).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import { parseCorsOrigins } from './index';

const APP = 'capacitor://localhost';

afterEach(() => {
  vi.unstubAllEnvs();
});

function production(corsOrigins?: string) {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('FRONTEND_URL', 'https://borderfall.gg');
  vi.stubEnv('CORS_ORIGINS', corsOrigins);
}

/** The CORS registration in index.ts, over a list from parseCorsOrigins. */
async function serverAllowing(origins: string[]) {
  const app = Fastify();
  await app.register(fastifyCors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (origins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.get('/api/feature-flags', async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe('parseCorsOrigins', () => {
  it('allows the native app origins on the development server without being told', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('CORS_ORIGINS', undefined);
    expect(parseCorsOrigins()).toContain(APP);
  });

  it('allows only the website in production unless CORS_ORIGINS adds more', () => {
    production();
    expect(parseCorsOrigins()).toEqual(['https://borderfall.gg']);
  });

  it('allows the iOS app in production once CORS_ORIGINS lists it', () => {
    production(` ${APP} `);
    expect(parseCorsOrigins()).toEqual(['https://borderfall.gg', APP]);
    production(`https://staging.borderfall.gg,${APP}`);
    expect(parseCorsOrigins()).toEqual(['https://borderfall.gg', 'https://staging.borderfall.gg', APP]);
  });
});

describe('a production server and the iOS app', () => {
  it('gives the app no CORS headers until its origin is listed, so the web view blocks every response', async () => {
    production();
    const app = await serverAllowing(parseCorsOrigins());
    const res = await app.inject({ method: 'GET', url: '/api/feature-flags', headers: { origin: APP } });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });

  it('answers the app, with credentials allowed, once CORS_ORIGINS lists it', async () => {
    production(APP);
    const app = await serverAllowing(parseCorsOrigins());
    const res = await app.inject({ method: 'GET', url: '/api/feature-flags', headers: { origin: APP } });
    expect(res.headers['access-control-allow-origin']).toBe(APP);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    // The website is unaffected either way.
    const web = await app.inject({ method: 'GET', url: '/api/feature-flags', headers: { origin: 'https://borderfall.gg' } });
    expect(web.headers['access-control-allow-origin']).toBe('https://borderfall.gg');
    await app.close();
  });
});
