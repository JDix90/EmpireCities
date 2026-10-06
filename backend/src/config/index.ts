import dotenv from 'dotenv';
dotenv.config();

import { parseEmbedOriginList } from '../modules/auth/embedContext';

function parseCorsOrigins(): string[] {
  const extra = process.env.CORS_ORIGINS;
  const primary = process.env.FRONTEND_URL || 'http://localhost:5173';
  const list = [primary];
  if (extra) {
    for (const o of extra.split(',')) {
      const t = o.trim();
      if (t && !list.includes(t)) list.push(t);
    }
  }
  // Capacitor / Ionic WebView defaults (add your production app URL via CORS_ORIGINS)
  const devExtras = ['capacitor://localhost', 'ionic://localhost', 'http://localhost'];
  if ((process.env.NODE_ENV || 'development') === 'development') {
    for (const o of devExtras) {
      if (!list.includes(o)) list.push(o);
    }
    // Vite may fall back to 5174+ when 5173 is in use; allow all common local dev ports
    for (const port of [5173, 5174, 5175, 5176, 5177]) {
      const o = `http://localhost:${port}`;
      if (!list.includes(o)) list.push(o);
    }
  }
  return list;
}

function parseRefreshCookieSameSite(): 'strict' | 'lax' | 'none' {
  const v = (process.env.REFRESH_COOKIE_SAME_SITE || '').toLowerCase();
  if (v === 'strict' || v === 'lax' || v === 'none') return v;
  return process.env.NODE_ENV === 'production' ? 'lax' : 'strict';
}

function parseBooleanEnv(v: string | undefined): boolean | null {
  if (v == null || v.trim() === '') return null;
  const n = v.trim().toLowerCase();
  if (n === '1' || n === 'true' || n === 'yes' || n === 'on') return true;
  if (n === '0' || n === 'false' || n === 'no' || n === 'off') return false;
  return null;
}

/**
 * The private address ranges. A proxy here is trusted to report the visitor's
 * address: in production that is our nginx on the Docker network, the only
 * thing that can reach the backend, which publishes no port of its own.
 */
export const PRIVATE_NETWORK_PROXIES: readonly string[] = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7'];

/**
 * Fastify `trustProxy`: which proxies' `X-Forwarded-For` decides `request.ip`,
 * which the HTTP rate limiter keys anonymous traffic by
 * (`middleware/rateLimitKey.ts`). `true` trusts EVERY hop, so Fastify takes the
 * leftmost (client-controlled) entry and a spoofed header hands an attacker a
 * fresh limiter bucket per request. The default trusts proxies on private
 * networks, which makes `request.ip` the real visitor as long as the edge sets
 * X-Forwarded-For to `$remote_addr` (see docker/nginx.prod.conf).
 *
 * A proxy is trusted by its address, never by a hop count. Fastify 5 reads a
 * number as "trust no proxy", since a count cannot check who sent the header;
 * every visitor would then look like nginx and share one limiter bucket.
 *
 * `TRUST_PROXY` overrides it for other topologies. Production's compose file
 * does not pass it, so production runs on the default.
 *   - a CSV of IPs/CIDRs → trust exactly those proxy addresses
 *   - "true"/"false" → trust all / none (avoid "true" in production)
 *   - a number, the old hop count → the default, with a warning (validateEnv.ts)
 */
export function parseTrustProxy(raw: string = process.env.TRUST_PROXY ?? ''): boolean | string | string[] {
  const value = raw.trim();
  if (value === '' || /^\d+$/.test(value)) return [...PRIVATE_NETWORK_PROXIES];
  const lower = value.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  return value; // comma-separated IPs/CIDRs, passed through to proxy-addr
}

function parseRefreshCookieSecure(): boolean {
  const explicit = parseBooleanEnv(process.env.REFRESH_COOKIE_SECURE);
  if (explicit != null) return explicit;

  // Auto-detect from public app URL scheme.
  try {
    const protocol = new URL(process.env.FRONTEND_URL || 'http://localhost:5173').protocol;
    return protocol === 'https:';
  } catch {
    return process.env.NODE_ENV === 'production';
  }
}

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3001', 10),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  corsOrigins: parseCorsOrigins(),
  // Portals allowed to iframe us. Empty by default, and that default is
  // load-bearing: it keeps `frame-ancestors 'none'` and leaves every refresh
  // cookie on the SameSite below. See modules/auth/embedContext.ts.
  embedOrigins: parseEmbedOriginList(process.env.EMBED_ORIGINS),
  refreshCookieSameSite: parseRefreshCookieSameSite(),
  refreshCookieSecure: parseRefreshCookieSecure(),
  trustProxy: parseTrustProxy(),

  postgres: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    user: process.env.POSTGRES_USER || 'chronouser',
    password: process.env.POSTGRES_PASSWORD || 'chronopass',
    database: process.env.POSTGRES_DB || 'borderfall',
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || 'chronoredis',
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev_access_secret_change_in_production',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret_change_in_production',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '1h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'noreply@borderfall.com',
  },

  email: {
    // 'resend_api' sends over HTTPS (port 443) via the Resend API — avoids
    // blocked outbound SMTP ports on cloud hosts. Anything else (or unset)
    // falls back to SMTP via the smtp.* config above.
    provider: process.env.EMAIL_PROVIDER || 'smtp',
    // Reuses SMTP_PASS (your Resend API key) so no extra env var is required,
    // but RESEND_API_KEY takes precedence if set explicitly.
    resendApiKey: process.env.RESEND_API_KEY || process.env.SMTP_PASS || '',
  },

  push: {
    fcmServiceAccountPath: process.env.FCM_SERVICE_ACCOUNT_PATH || '',
  },

  sentryDsn: process.env.SENTRY_DSN || '',
};
