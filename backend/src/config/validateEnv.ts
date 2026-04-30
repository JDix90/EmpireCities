/**
 * Fail fast in production when secrets are missing or left at dev defaults.
 */
const DEV_ACCESS = 'dev_access_secret_change_in_production';
const DEV_REFRESH = 'dev_refresh_secret_change_in_production';

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

  if (process.env.POSTGRES_PASSWORD === 'chronopass') {
    console.warn(
      '[config] Warning: POSTGRES_PASSWORD matches docker default. Use a unique password in production.',
    );
  }

  // CORS hardening: in production we must not echo dev/loopback origins back
  // to clients. Allowing http://localhost:* in prod CORS would let any local
  // attacker on the same machine drive authenticated cross-origin requests
  // against this server. We also forbid the `*` wildcard which would defeat
  // the cookie/CORS isolation entirely.
  const rawOrigins = process.env.CORS_ORIGINS ?? '';
  const origins = rawOrigins
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

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
      `[config] Production CORS_ORIGINS contains dev/wildcard origins which are not safe in production: ${offenders.join(
        ', ',
      )}. Set CORS_ORIGINS to your real public origins (e.g. https://app.example.com).`,
    );
  }

  // Require an explicit allowlist in production. Accidentally launching with
  // an empty CORS list in production is also dangerous because some libraries
  // will fall back to permissive defaults.
  if (origins.length === 0) {
    throw new Error(
      '[config] Production requires CORS_ORIGINS to be set to a non-empty, comma-separated list of public origins.',
    );
  }
}
