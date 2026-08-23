import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateProductionEnv } from './validateEnv';

const KEYS = [
  'NODE_ENV',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'POSTGRES_PASSWORD',
  'REDIS_PASSWORD',
  'FRONTEND_URL',
  'CORS_ORIGINS',
] as const;

let saved: Record<string, string | undefined>;

/** A production env where every secret is present and non-default. */
function setValidProd(): void {
  process.env.NODE_ENV = 'production';
  process.env.JWT_ACCESS_SECRET = 'a'.repeat(64);
  process.env.JWT_REFRESH_SECRET = 'b'.repeat(64);
  process.env.POSTGRES_PASSWORD = 'strong-pg-password';
  process.env.REDIS_PASSWORD = 'strong-redis-password';
  // NOT an example.com origin: those are RFC 2606 documentation domains and
  // validateProductionEnv now rejects them as unreplaced template values.
  process.env.FRONTEND_URL = 'https://borderfall.gg';
  delete process.env.CORS_ORIGINS;
}

beforeEach(() => {
  saved = {};
  for (const k of KEYS) saved[k] = process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

describe('validateProductionEnv', () => {
  it('no-ops outside production even with everything missing', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.REDIS_PASSWORD;
    expect(() => validateProductionEnv()).not.toThrow();
  });

  it('passes with a fully valid production env', () => {
    setValidProd();
    expect(() => validateProductionEnv()).not.toThrow();
  });

  it('throws when a JWT secret is missing', () => {
    setValidProd();
    delete process.env.JWT_ACCESS_SECRET;
    expect(() => validateProductionEnv()).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('throws on the default dev JWT secret', () => {
    setValidProd();
    process.env.JWT_ACCESS_SECRET = 'dev_access_secret_change_in_production';
    expect(() => validateProductionEnv()).toThrow(/dev JWT secrets/);
  });

  it('throws on the docker-compose placeholder JWT access secret', () => {
    setValidProd();
    process.env.JWT_ACCESS_SECRET = 'change_me_in_production_jwt_access';
    expect(() => validateProductionEnv()).toThrow(/placeholder\/dev JWT secrets/);
  });

  it('throws on the docker-compose placeholder JWT refresh secret', () => {
    setValidProd();
    process.env.JWT_REFRESH_SECRET = 'change_me_in_production_jwt_refresh';
    expect(() => validateProductionEnv()).toThrow(/placeholder\/dev JWT secrets/);
  });

  it('throws when REDIS_PASSWORD is missing (config would fall back to the docker default)', () => {
    setValidProd();
    delete process.env.REDIS_PASSWORD;
    expect(() => validateProductionEnv()).toThrow(/REDIS_PASSWORD/);
  });

  it('throws on the default redis password', () => {
    setValidProd();
    process.env.REDIS_PASSWORD = 'chronoredis';
    expect(() => validateProductionEnv()).toThrow(/REDIS_PASSWORD/);
  });

  it('throws when POSTGRES_PASSWORD is the docker default', () => {
    setValidProd();
    process.env.POSTGRES_PASSWORD = 'chronopass';
    expect(() => validateProductionEnv()).toThrow(/POSTGRES_PASSWORD/);
  });

  it('throws when POSTGRES_PASSWORD is missing', () => {
    setValidProd();
    delete process.env.POSTGRES_PASSWORD;
    expect(() => validateProductionEnv()).toThrow(/POSTGRES_PASSWORD/);
  });

  it('still rejects loopback CORS origins in production', () => {
    setValidProd();
    process.env.FRONTEND_URL = 'http://localhost:5173';
    expect(() => validateProductionEnv()).toThrow(/CORS/i);
  });

  it('warns (does not throw) on a short JWT secret', () => {
    setValidProd();
    process.env.JWT_ACCESS_SECRET = 'short';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => validateProductionEnv()).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('JWT_ACCESS_SECRET'));
  });
});

describe('validateProductionEnv — placeholder origins', () => {
  /**
   * Regression test for a real outage tail: production ran for weeks with
   * FRONTEND_URL=https://play.example.com straight out of
   * .env.production.example. It survived the existing dev/loopback check
   * because example.com is a syntactically valid public origin, and the site
   * *looked* fine — nginx serves the API same-origin, so CORS never engaged.
   * What it silently broke was every consumer of FRONTEND_URL that isn't
   * same-origin: Socket.IO origins, password-reset links, invite links and OG
   * share URLs.
   */
  it('rejects the example.com placeholder from .env.production.example', () => {
    setValidProd();
    process.env.FRONTEND_URL = 'https://play.example.com';
    expect(() => validateProductionEnv()).toThrow(/placeholder origins/i);
  });

  it('rejects bare example.com and other reserved doc TLDs', () => {
    for (const origin of ['https://example.com', 'http://example.org', 'https://www.example.net']) {
      setValidProd();
      process.env.FRONTEND_URL = origin;
      expect(() => validateProductionEnv(), origin).toThrow(/placeholder origins/i);
    }
  });

  it('rejects your-domain and replace_me templates', () => {
    for (const origin of ['https://your-domain.com', 'https://app.your.domain.io', 'https://replace_me']) {
      setValidProd();
      process.env.FRONTEND_URL = origin;
      expect(() => validateProductionEnv(), origin).toThrow(/placeholder origins/i);
    }
  });

  it('catches a placeholder hiding in CORS_ORIGINS behind a real FRONTEND_URL', () => {
    setValidProd();
    process.env.FRONTEND_URL = 'https://borderfall.gg';
    process.env.CORS_ORIGINS = 'https://cdn.borderfall.gg,https://staging.example.com';
    expect(() => validateProductionEnv()).toThrow(/staging\.example\.com/);
  });

  it('accepts real public origins', () => {
    for (const origin of ['https://borderfall.gg', 'https://play.borderfall.gg', 'https://exampleton.io']) {
      setValidProd();
      process.env.FRONTEND_URL = origin;
      expect(() => validateProductionEnv(), origin).not.toThrow();
    }
  });
});
