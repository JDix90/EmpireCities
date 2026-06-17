/**
 * Fail fast in production when secrets are missing or left at dev defaults.
 */
const DEV_ACCESS = 'dev_access_secret_change_in_production';
const DEV_REFRESH = 'dev_refresh_secret_change_in_production';
// Docker-compose dev defaults. `config/index.ts` falls back to these same
// values when the env var is unset, so an UNSET infra password is exactly as
// dangerous as one explicitly set to the default — both resolve to a
// publicly-known credential. We therefore treat missing and default alike.
const DEV_POSTGRES = 'chronopass';
const DEV_REDIS = 'chronoredis';
// Recommended minimum entropy for the HMAC signing secrets.
const MIN_SECRET_LENGTH = 32;

export function validateProductionEnv(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const missing: string[] = [];
  if (!process.env.JWT_ACCESS_SECRET?.trim()) missing.push('JWT_ACCESS_SECRET');
  if (!process.env.JWT_REFRESH_SECRET?.trim()) missing.push('JWT_REFRESH_SECRET');

  if (missing.length > 0) {
    throw new Error(
      `[config] Production requires: ${missing.join(', ')}. Set strong secrets in the environment.`,
    );
  }

  if (
    process.env.JWT_ACCESS_SECRET === DEV_ACCESS ||
    process.env.JWT_REFRESH_SECRET === DEV_REFRESH
  ) {
    throw new Error(
      '[config] Production cannot use default dev JWT secrets. Set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET.',
    );
  }

  // Defense-in-depth: weak HMAC secrets are brute-forceable. Warn (don't hard
  // fail, to avoid surprising an existing deploy) when below the recommended
  // entropy — `openssl rand -hex 32` produces a 64-char value.
  for (const name of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
    const val = process.env[name]?.trim() ?? '';
    if (val.length < MIN_SECRET_LENGTH) {
      console.warn(
        `[config] Warning: ${name} is shorter than ${MIN_SECRET_LENGTH} characters. ` +
          'Use at least 32 bytes of entropy (e.g. `openssl rand -hex 32`).',
      );
    }
  }

  // Infra credentials must be present AND non-default in production. These
  // datastores hold game state, the Socket.IO backplane, sessions, and password
  // hashes; a missing/default credential on a reachable Redis or Postgres is a
  // full compromise. Previously only POSTGRES_PASSWORD was checked, and only as
  // a warning, while REDIS_PASSWORD was not checked at all.
  const insecureInfra: string[] = [];
  const pgPassword = process.env.POSTGRES_PASSWORD?.trim();
  if (!pgPassword || pgPassword === DEV_POSTGRES) insecureInfra.push('POSTGRES_PASSWORD');
  const redisPassword = process.env.REDIS_PASSWORD?.trim();
  if (!redisPassword || redisPassword === DEV_REDIS) insecureInfra.push('REDIS_PASSWORD');

  if (insecureInfra.length > 0) {
    throw new Error(
      `[config] Production requires non-default secrets for: ${insecureInfra.join(', ')}. ` +
        'A missing value falls back to the docker-compose default (a publicly-known ' +
        'credential), so set strong unique values in the environment.',
    );
  }

  // Postgres TLS nudge (warn, don't fail — a same-host deploy is legitimately
  // unencrypted). If the DB is remote (non-loopback host) and PG_SSL isn't on,
  // credentials + query data cross the network in cleartext.
  const pgHost = (process.env.POSTGRES_HOST || 'localhost').trim();
  const pgIsLoopback = ['localhost', '127.0.0.1', '::1', ''].includes(pgHost);
  if (!pgIsLoopback && (process.env.PG_SSL || '').toLowerCase() !== 'true') {
    console.warn(
      `[config] Warning: POSTGRES_HOST=${pgHost} is remote but PG_SSL is not enabled. ` +
        'DB credentials and data will travel unencrypted. Set PG_SSL=true.',
    );
  }

  // CORS hardening: in production we must not echo dev/loopback origins back
  // to clients. Allowing http://localhost:* in prod CORS would let any local
  // attacker on the same machine drive authenticated cross-origin requests
  // against this server. We also forbid the `*` wildcard which would defeat
  // the cookie/CORS isolation entirely.
  const rawExtraOrigins = process.env.CORS_ORIGINS ?? '';
  const extraOrigins = rawExtraOrigins
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const origins = [
    process.env.FRONTEND_URL?.trim() || '',
    ...extraOrigins,
  ].filter((origin, index, list) => origin.length > 0 && list.indexOf(origin) === index);

  const FORBIDDEN_HOST_PATTERNS: RegExp[] = [
    /^https?:\/\/localhost(:\d+)?$/i,
    /^https?:\/\/127\.0\.0\.1(:\d+)?$/i,
    /^https?:\/\/0\.0\.0\.0(:\d+)?$/i,
    /^https?:\/\/\[?::1\]?(:\d+)?$/i,
  ];

  const offenders: string[] = [];
  for (const origin of origins) {
    if (origin === '*') {
      offenders.push(origin);
      continue;
    }
    if (FORBIDDEN_HOST_PATTERNS.some((re) => re.test(origin))) {
      offenders.push(origin);
    }
  }

  if (offenders.length > 0) {
    throw new Error(
      `[config] Production CORS allowlist contains dev/wildcard origins which are not safe in production: ${offenders.join(
        ', ',
      )}. Set FRONTEND_URL and CORS_ORIGINS to real public origins (e.g. https://app.example.com).`,
    );
  }

  // Require an explicit allowlist in production. FRONTEND_URL is the primary
  // same-origin deploy value; CORS_ORIGINS is only for additional origins.
  if (origins.length === 0) {
    throw new Error(
      '[config] Production requires FRONTEND_URL or CORS_ORIGINS to be set to at least one public origin.',
    );
  }
}
