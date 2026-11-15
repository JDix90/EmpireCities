import { describe, it, expect, afterEach, vi } from 'vitest';
import { isNativeAppOrigin, refreshTokenFromBody } from './nativeSession';
import { parseNativeAppOrigins } from '../../config';
import { validateProductionEnv } from '../../config/validateEnv';

const APP = 'capacitor://localhost';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('isNativeAppOrigin', () => {
  it('is true only for an origin the server names', () => {
    expect(isNativeAppOrigin(APP, [APP])).toBe(true);
    expect(isNativeAppOrigin('https://borderfall.gg', [APP])).toBe(false);
    expect(isNativeAppOrigin('capacitor://localhost.evil.test', [APP])).toBe(false);
    expect(isNativeAppOrigin('capacitor://app.crazygames.com', [APP])).toBe(false);
  });

  it('is false with no origin, and always false while no origin is named', () => {
    expect(isNativeAppOrigin(undefined, [APP])).toBe(false);
    expect(isNativeAppOrigin('', [APP])).toBe(false);
    expect(isNativeAppOrigin(['capacitor://localhost'], [APP])).toBe(false);
    expect(isNativeAppOrigin(APP, [])).toBe(false);
  });
});

describe('refreshTokenFromBody', () => {
  it('reads a token and nothing else', () => {
    expect(refreshTokenFromBody({ refreshToken: 'abc.def.ghi' })).toBe('abc.def.ghi');
    expect(refreshTokenFromBody({})).toBeUndefined();
    expect(refreshTokenFromBody(undefined)).toBeUndefined();
    expect(refreshTokenFromBody('abc')).toBeUndefined();
    expect(refreshTokenFromBody({ refreshToken: '' })).toBeUndefined();
    expect(refreshTokenFromBody({ refreshToken: 12 })).toBeUndefined();
    expect(refreshTokenFromBody({ refreshToken: 'x'.repeat(2049) })).toBeUndefined();
  });
});

describe('NATIVE_APP_ORIGINS', () => {
  it('is empty in production unless set, so the body path is off', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NATIVE_APP_ORIGINS', undefined);
    expect(parseNativeAppOrigins()).toEqual([]);
  });

  it('names the iOS app once set', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NATIVE_APP_ORIGINS', ` ${APP} , ${APP}`);
    expect(parseNativeAppOrigins()).toEqual([APP]);
  });

  it('allows the iOS app on the development server without being told, and can be switched off there', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NATIVE_APP_ORIGINS', undefined);
    expect(parseNativeAppOrigins()).toEqual([APP]);
    vi.stubEnv('NATIVE_APP_ORIGINS', '');
    expect(parseNativeAppOrigins()).toEqual([]);
  });

  // A web origin here would give that website's pages their refresh tokens in
  // a response body, where script can read them.
  it('never accepts a web origin', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NATIVE_APP_ORIGINS', `https://borderfall.gg,${APP},http://localhost:5173,HTTPS://evil.test`);
    expect(parseNativeAppOrigins()).toEqual([APP]);
  });

  it('stops a production server from starting with a web origin in it', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_ACCESS_SECRET', 'a'.repeat(64));
    vi.stubEnv('JWT_REFRESH_SECRET', 'b'.repeat(64));
    vi.stubEnv('POSTGRES_PASSWORD', 'strong-pg-password');
    vi.stubEnv('REDIS_PASSWORD', 'strong-redis-password');
    vi.stubEnv('FRONTEND_URL', 'https://borderfall.gg');
    vi.stubEnv('CORS_ORIGINS', APP);
    vi.stubEnv('NATIVE_APP_ORIGINS', APP);
    expect(() => validateProductionEnv()).not.toThrow();
    vi.stubEnv('NATIVE_APP_ORIGINS', `${APP},https://borderfall.gg`);
    expect(() => validateProductionEnv()).toThrow(/NATIVE_APP_ORIGINS must name only the native app/);
  });

  it('warns when the app origin is not allowed by CORS, since the app could read nothing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_ACCESS_SECRET', 'a'.repeat(64));
    vi.stubEnv('JWT_REFRESH_SECRET', 'b'.repeat(64));
    vi.stubEnv('POSTGRES_PASSWORD', 'strong-pg-password');
    vi.stubEnv('REDIS_PASSWORD', 'strong-redis-password');
    vi.stubEnv('FRONTEND_URL', 'https://borderfall.gg');
    vi.stubEnv('CORS_ORIGINS', undefined);
    vi.stubEnv('NATIVE_APP_ORIGINS', APP);
    expect(() => validateProductionEnv()).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('CORS_ORIGINS does not'));
  });
});
