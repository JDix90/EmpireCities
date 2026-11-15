/**
 * The minimum native app version: an outdated app build is answered with 426
 * on every API request, and nothing else is ever turned away.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import { resetAdminConfigCacheForTests, setAdminConfigCacheForTests } from '../services/adminConfig';
import {
  APP_PLATFORM_HEADER,
  APP_VERSION_HEADER,
  rejectOutdatedApp,
  updateRequiredFor,
  versionCheckBody,
} from './minAppVersion';

const STORE = 'https://apps.apple.com/app/id0000000000';

function setMinimum(ios: string, android = '') {
  setAdminConfigCacheForTests({
    native_app: { ios_min_version: ios, ios_store_url: STORE, android_min_version: android, android_store_url: '' },
  });
}

const app = (platform: string, version?: string) => ({
  [APP_PLATFORM_HEADER]: platform,
  ...(version === undefined ? {} : { [APP_VERSION_HEADER]: version }),
});

beforeEach(() => resetAdminConfigCacheForTests());

describe('updateRequiredFor', () => {
  it('serves everyone while no minimum is set, which is the default', () => {
    expect(updateRequiredFor(app('ios', '0.0.1'))).toBeNull();
    expect(updateRequiredFor(app('android', '0.0.1'))).toBeNull();
  });

  it('refuses an iOS build older than the minimum, with the store link', () => {
    setMinimum('1.2.0');
    expect(updateRequiredFor(app('ios', '1.1.9'))).toEqual({
      error: 'This version of the app is no longer supported. Update it to keep playing.',
      code: 'UPDATE_REQUIRED',
      platform: 'ios',
      min_version: '1.2.0',
      store_url: STORE,
    });
    expect(updateRequiredFor(app('ios', '1.0'))?.code).toBe('UPDATE_REQUIRED');
  });

  it('serves the minimum itself and anything newer', () => {
    setMinimum('1.2.0');
    expect(updateRequiredFor(app('ios', '1.2.0'))).toBeNull();
    expect(updateRequiredFor(app('ios', '1.2'))).toBeNull();
    expect(updateRequiredFor(app('ios', '1.10.0'))).toBeNull();
    expect(updateRequiredFor(app('ios', '2.0.0'))).toBeNull();
  });

  it('never touches the website, which sends no app headers', () => {
    setMinimum('99.0.0', '99.0.0');
    expect(updateRequiredFor({})).toBeNull();
    expect(updateRequiredFor({ origin: 'https://borderfall.gg' })).toBeNull();
    // A version with no platform is not an app.
    expect(updateRequiredFor({ [APP_VERSION_HEADER]: '0.0.1' })).toBeNull();
    expect(updateRequiredFor(app('web', '0.0.1'))).toBeNull();
  });

  it('keeps each platform to its own minimum', () => {
    setMinimum('2.0.0', '');
    expect(updateRequiredFor(app('ios', '1.0.0'))?.platform).toBe('ios');
    expect(updateRequiredFor(app('android', '1.0.0'))).toBeNull();
    setMinimum('', '3.0.0');
    expect(updateRequiredFor(app('ios', '1.0.0'))).toBeNull();
    expect(updateRequiredFor(app('android', '1.0.0'))?.min_version).toBe('3.0.0');
    expect(updateRequiredFor(app('Android', '1.0.0'))?.platform).toBe('android');
  });

  it('serves a build whose version is missing or unreadable rather than lock it out', () => {
    setMinimum('2.0.0');
    expect(updateRequiredFor(app('ios'))).toBeNull();
    expect(updateRequiredFor(app('ios', ''))).toBeNull();
    expect(updateRequiredFor(app('ios', 'unknown'))).toBeNull();
    expect(updateRequiredFor(app('ios', '1.0.0-beta'))).toBeNull();
  });

  it('reads a stored minimum that is not a version as no minimum', () => {
    setMinimum('v2');
    expect(updateRequiredFor(app('ios', '1.0.0'))).toBeNull();
  });
});

describe('versionCheckBody', () => {
  it('tells a current app it is current, with its platform and minimum', () => {
    setMinimum('1.2.0');
    expect(versionCheckBody(app('ios', '1.2.0'))).toEqual({ update_required: false, platform: 'ios', min_version: '1.2.0' });
    expect(versionCheckBody({})).toEqual({ update_required: false, platform: 'web', min_version: '' });
  });
});

describe('the hook on a server', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = Fastify();
    // As index.ts registers them: CORS first, then the hook.
    await server.register(fastifyCors, {
      origin: (origin, cb) => cb(null, !origin || origin === 'capacitor://localhost'),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    });
    server.addHook('onRequest', rejectOutdatedApp);
    server.get('/api/app/version-check', async (req) => versionCheckBody(req.headers));
    server.post('/api/auth/guest', async () => ({ accessToken: 'made-a-guest' }));
  });

  afterEach(async () => {
    await server.close();
  });

  it('answers an outdated app with 426 on any route, readable across origins', async () => {
    setMinimum('1.2.0');
    const headers = { ...app('ios', '1.0.0'), origin: 'capacitor://localhost' };
    const check = await server.inject({ method: 'GET', url: '/api/app/version-check', headers });
    expect(check.statusCode).toBe(426);
    expect(check.json()).toMatchObject({ code: 'UPDATE_REQUIRED', min_version: '1.2.0', store_url: STORE });
    // Without these the app's JavaScript could not read the refusal at all.
    expect(check.headers['access-control-allow-origin']).toBe('capacitor://localhost');
    expect(check.headers['access-control-allow-credentials']).toBe('true');
    const guest = await server.inject({ method: 'POST', url: '/api/auth/guest', headers, payload: {} });
    expect(guest.statusCode).toBe(426);
    expect(guest.body).not.toContain('made-a-guest');
  });

  it('serves a current app and the website', async () => {
    setMinimum('1.2.0');
    const current = await server.inject({ method: 'GET', url: '/api/app/version-check', headers: app('ios', '1.2.0') });
    expect(current.statusCode).toBe(200);
    expect(current.json()).toEqual({ update_required: false, platform: 'ios', min_version: '1.2.0' });
    const web = await server.inject({ method: 'POST', url: '/api/auth/guest', payload: {} });
    expect(web.statusCode).toBe(200);
  });

  it('lets the preflight for the app headers through, and allows them', async () => {
    setMinimum('1.2.0');
    const preflight = await server.inject({
      method: 'OPTIONS',
      url: '/api/auth/guest',
      headers: {
        origin: 'capacitor://localhost',
        'access-control-request-method': 'POST',
        'access-control-request-headers': `content-type,${APP_PLATFORM_HEADER},${APP_VERSION_HEADER}`,
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(String(preflight.headers['access-control-allow-headers'])).toContain(APP_VERSION_HEADER);
    expect(String(preflight.headers['access-control-allow-headers'])).toContain(APP_PLATFORM_HEADER);
  });
});
