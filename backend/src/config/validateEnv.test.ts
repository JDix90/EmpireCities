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
  process.env.FRONTEND_URL = 'https://app.example.com';
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
