/**
 * Sessions for the native app, against Postgres and the real auth routes: the
 * app gets its refresh token in the response body and renews with it in the
 * request body, the website still gets its httpOnly cookie and nothing else,
 * and neither can use the other's path or the other's token.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/auth/nativeSession.db.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const enabled = process.env.PG_TEST === '1';
type Query = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const APP = 'capacitor://localhost';
const WEB = 'https://borderfall.gg';

describe.runIf(enabled)('native app sessions (Postgres)', { timeout: 30_000 }, () => {
  let query: Query;
  let app: FastifyInstance;
  let verifyRefreshToken: (t: string) => { sub: string; tokenId: string; client?: string } | null;
  const userIds: string[] = [];

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as { query: Query });
    const adminConfig = await import('../../services/adminConfig');
    adminConfig.setAdminConfigCacheForTests({ feature_flags: { session_refresh_grace_enabled: true } });
    const { default: fastifyCookie } = await import('@fastify/cookie');
    const { config } = await import('../../config');
    // What NATIVE_APP_ORIGINS=capacitor://localhost gives a production server.
    (config as { nativeAppOrigins: string[] }).nativeAppOrigins = [APP];
    ({ verifyRefreshToken } = await import('../../utils/jwt'));
    const { authRoutes } = await import('./auth.routes');
    app = Fastify();
    await app.register(fastifyCookie, { secret: config.jwt.refreshSecret });
    await app.register(authRoutes, { prefix: '/api/auth' });
    await app.ready();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    if (query && userIds.length) {
      await query('DELETE FROM analytics_events WHERE user_id = ANY($1)', [userIds]).catch(() => {});
      await query('DELETE FROM users WHERE user_id = ANY($1)', [userIds]).catch(() => {});
    }
  });

  type Res = Awaited<ReturnType<FastifyInstance['inject']>>;
  const cookieOf = (res: Res) => res.cookies.find((c) => c.name === 'refreshToken')?.value;

  /** A new guest, as the app or as the website makes one. */
  async function guest(origin: string | undefined): Promise<Res> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/guest',
      headers: origin ? { origin } : {},
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    userIds.push(res.json().user.user_id);
    return res;
  }

  const refresh = (opts: { origin?: string; body?: string; cookie?: string }) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: opts.origin ? { origin: opts.origin } : {},
      payload: opts.body === undefined ? {} : { refreshToken: opts.body },
      cookies: opts.cookie === undefined ? {} : { refreshToken: opts.cookie },
    });

  /** Push a token's rotation into the past, as if the reply was lost hours ago. */
  const ageRotation = (token: string) =>
    query(`UPDATE refresh_tokens SET rotated_at = NOW() - INTERVAL '3 hours' WHERE token_id = $1`, [
      verifyRefreshToken(token)!.tokenId,
    ]);

  describe('the app', () => {
    it('is given its refresh token in the body, marked as the app\'s, and no cookie', async () => {
      const res = await guest(APP);
      const token = res.json().refreshToken as string;
      expect(typeof token).toBe('string');
      expect(cookieOf(res)).toBeUndefined();
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(verifyRefreshToken(token)).toMatchObject({ sub: res.json().user.user_id, client: 'native' });
    });

    it('renews with the token in the body, and gets the next one the same way', async () => {
      const first = (await guest(APP)).json().refreshToken as string;
      const res = await refresh({ origin: APP, body: first });
      expect(res.statusCode).toBe(200);
      const next = res.json().refreshToken as string;
      expect(res.json().accessToken).toEqual(expect.any(String));
      expect(next).not.toBe(first);
      expect(verifyRefreshToken(next)?.client).toBe('native');
      expect(cookieOf(res)).toBeUndefined();
      // And again with the new one: the chain holds.
      expect((await refresh({ origin: APP, body: next })).statusCode).toBe(200);
    });

    it('keeps a guest a guest across the renewal', async () => {
      const res = await guest(APP);
      const renewed = await refresh({ origin: APP, body: res.json().refreshToken });
      const claims = JSON.parse(Buffer.from(renewed.json().accessToken.split('.')[1], 'base64url').toString());
      expect(claims).toMatchObject({ sub: res.json().user.user_id, guest: true });
    });

    it('is refused without a token, with a made-up one, and with only a cookie', async () => {
      const token = (await guest(APP)).json().refreshToken as string;
      // Each refusal on the app's path says it is one (`native: true`): that
      // is what tells the app its session is really over.
      const none = await refresh({ origin: APP });
      expect(none.json()).toEqual({ error: 'No refresh token', native: true });
      expect((await refresh({ origin: APP })).statusCode).toBe(401);
      expect((await refresh({ origin: APP, body: 'not.a.token' })).statusCode).toBe(401);
      // The app's path never reads a cookie, even a good one.
      expect((await refresh({ origin: APP, cookie: token })).statusCode).toBe(401);
    });

    // A phone suspends an app mid-request. The reply to a refresh is then
    // never read, the keychain still holds the old token, and hours can pass.
    it('is not signed out by a reply it never received, however long ago', async () => {
      const held = (await guest(APP)).json().refreshToken as string;
      const lost = (await refresh({ origin: APP, body: held })).json().refreshToken as string;
      await ageRotation(held);

      const again = await refresh({ origin: APP, body: held });
      expect(again.statusCode).toBe(200);
      const received = again.json().refreshToken as string;
      // The reply that was lost is retired: one live token, not two.
      expect((await refresh({ origin: APP, body: lost })).statusCode).toBe(401);
      // Lost a second time: the held token still works.
      await ageRotation(held);
      const third = await refresh({ origin: APP, body: held });
      expect(third.statusCode).toBe(200);
      expect((await refresh({ origin: APP, body: received })).statusCode).toBe(401);
    });

    it('has its old token refused once it has used a newer one', async () => {
      const old = (await guest(APP)).json().refreshToken as string;
      const next = (await refresh({ origin: APP, body: old })).json().refreshToken as string;
      // Using `next` is the proof the app received it.
      expect((await refresh({ origin: APP, body: next })).statusCode).toBe(200);
      expect((await refresh({ origin: APP, body: old })).statusCode).toBe(401);
    });

    it('signs out by naming its token, which then stops working', async () => {
      const token = (await guest(APP)).json().refreshToken as string;
      const out = await app.inject({
        method: 'POST', url: '/api/auth/logout', headers: { origin: APP }, payload: { refreshToken: token },
      });
      expect(out.statusCode).toBe(200);
      expect((await refresh({ origin: APP, body: token })).statusCode).toBe(401);
    });

    it('gets a body token from register and from sign-in too', async () => {
      const name = `nat_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
      const credentials = { username: name, email: `${name}@test.local`, password: 'Correct-Horse-Battery-9' };
      const registered = await app.inject({
        method: 'POST', url: '/api/auth/register', headers: { origin: APP }, payload: credentials,
      });
      expect(registered.statusCode).toBe(201);
      userIds.push(registered.json().user.user_id);
      expect(verifyRefreshToken(registered.json().refreshToken)?.client).toBe('native');
      expect(cookieOf(registered)).toBeUndefined();

      const signedIn = await app.inject({
        method: 'POST', url: '/api/auth/login', headers: { origin: APP },
        payload: { email: credentials.email, password: credentials.password },
      });
      expect(signedIn.statusCode).toBe(200);
      expect(verifyRefreshToken(signedIn.json().refreshToken)?.client).toBe('native');
      expect(cookieOf(signedIn)).toBeUndefined();
    });
  });

  describe('the website is unchanged', () => {
    for (const origin of [WEB, undefined]) {
      it(`still gets an httpOnly cookie and no token in the body (Origin: ${origin ?? 'none'})`, async () => {
        const res = await guest(origin);
        expect(res.json().refreshToken).toBeUndefined();
        const cookie = res.cookies.find((c) => c.name === 'refreshToken')!;
        expect(cookie.httpOnly).toBe(true);
        expect(cookie.path).toBe('/api/auth');
        expect(verifyRefreshToken(cookie.value)?.client).toBeUndefined();

        const renewed = await refresh({ origin, cookie: cookie.value });
        expect(renewed.statusCode).toBe(200);
        expect(renewed.json()).toEqual({ accessToken: expect.any(String) });
        expect(cookieOf(renewed)).toEqual(expect.any(String));
      });
    }

    it('still loses a retry that comes after the grace window, with the refusal it always got', async () => {
      const cookie = cookieOf(await guest(WEB))!;
      expect((await refresh({ origin: WEB, cookie })).statusCode).toBe(200);
      await ageRotation(cookie);
      const refused = await refresh({ origin: WEB, cookie });
      expect(refused.statusCode).toBe(401);
      expect(refused.json()).toEqual({ error: 'Refresh token invalid or revoked' });
      expect((await refresh({ origin: WEB })).json()).toEqual({ error: 'No refresh token' });
    });
  });

  // What an injected script on the website could try, and what a stolen token
  // could be tried with.
  describe('neither can use the other\'s path', () => {
    it('never answers a web page with a token in the body, whatever it sends', async () => {
      const cookie = cookieOf(await guest(WEB))!;
      // Its own cookie's token, sent in the body as the app would: ignored, the cookie is what counts.
      const res = await refresh({ origin: WEB, cookie, body: cookie });
      expect(res.statusCode).toBe(200);
      expect(res.json().refreshToken).toBeUndefined();
      // A body with no cookie is nothing at all to the web path.
      const appToken = (await guest(APP)).json().refreshToken as string;
      expect((await refresh({ origin: WEB, body: appToken })).statusCode).toBe(401);
      expect((await refresh({ body: appToken })).statusCode).toBe(401);
    });

    it('refuses the app\'s token in a cookie', async () => {
      const appToken = (await guest(APP)).json().refreshToken as string;
      expect((await refresh({ origin: WEB, cookie: appToken })).statusCode).toBe(401);
      expect((await refresh({ cookie: appToken })).statusCode).toBe(401);
      // And the refusal did not burn it: the app can still renew.
      expect((await refresh({ origin: APP, body: appToken })).statusCode).toBe(200);
    });

    it('refuses a cookie\'s token in the app\'s body', async () => {
      const cookie = cookieOf(await guest(WEB))!;
      const res = await refresh({ origin: APP, body: cookie });
      expect(res.statusCode).toBe(401);
      expect(res.json().refreshToken).toBeUndefined();
      // The website's session is untouched by the attempt.
      expect((await refresh({ origin: WEB, cookie })).statusCode).toBe(200);
    });

    it('treats an origin it was not told about as the website', async () => {
      const res = await guest('capacitor://app.crazygames.com');
      expect(res.json().refreshToken).toBeUndefined();
      expect(cookieOf(res)).toEqual(expect.any(String));
    });
  });

  it('with no app origin configured, the app\'s origin is just another website', async () => {
    const { config } = await import('../../config');
    const held = (await guest(APP)).json().refreshToken as string;
    (config as { nativeAppOrigins: string[] }).nativeAppOrigins = [];
    try {
      const res = await guest(APP);
      expect(res.json().refreshToken).toBeUndefined();
      expect(cookieOf(res)).toEqual(expect.any(String));
      // And an app that already holds a token is refused WITHOUT `native`, so
      // it keeps the token instead of taking a misconfigured server for a
      // dead session (frontend store/authStore.ts).
      const refused = await refresh({ origin: APP, body: held });
      expect(refused.statusCode).toBe(401);
      expect(refused.json()).toEqual({ error: 'No refresh token' });
    } finally {
      (config as { nativeAppOrigins: string[] }).nativeAppOrigins = [APP];
    }
    // The setting restored, the token it held all along still works.
    expect((await refresh({ origin: APP, body: held })).statusCode).toBe(200);
  });
});
