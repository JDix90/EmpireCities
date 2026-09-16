/**
 * Whether a request is running inside a portal's iframe, and what that means
 * for the refresh cookie. Pure functions, so the "does this change anything
 * for a direct player?" question is answerable by a unit test rather than by
 * reading the call sites.
 *
 * Background: a cookie is only sent inside a third-party iframe when it
 * carries `SameSite=None; Secure`. But None also gives up the CSRF protection
 * `Lax` provides, so it is decided per request instead of by a global setting
 * — only genuinely embedded requests get the relaxed cookie, and direct
 * traffic keeps whatever `SameSite` the deployment configured.
 */

export type SameSite = 'strict' | 'lax' | 'none';

export interface RefreshCookieConfig {
  /** Origins permitted to embed us. Empty means embedding is off entirely. */
  embedOrigins: string[];
  /** The deployment's SameSite for ordinary, non-embedded traffic. */
  sameSite: SameSite;
  /** The deployment's Secure flag for ordinary traffic. */
  secure: boolean;
}

/**
 * Parse the EMBED_ORIGINS env value.
 *
 * Only absolute http(s) origins are kept: `Origin` is matched exactly, per
 * spec, so a bare host or a value with a trailing path would silently never
 * match and embedding would fail with nothing to point at.
 */
export function parseEmbedOriginList(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const entry of raw.split(',')) {
    const t = entry.trim();
    if (/^https?:\/\/[^/\s]+$/.test(t) && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * True only for a request whose `Origin` is one of the configured embed
 * origins. A player on the site itself sends our own origin, or none at all
 * for a top-level navigation, so this is false for every direct visit — and
 * with `embedOrigins` empty it is false for everyone.
 */
export function isEmbeddedOrigin(origin: string | undefined, embedOrigins: string[]): boolean {
  return typeof origin === 'string' && embedOrigins.includes(origin);
}

/**
 * Attributes for the refresh cookie on this request.
 *
 * Non-embedded requests get exactly the configured `sameSite`/`secure` — the
 * behaviour that predates embedding support — whether or not any embed origin
 * is configured.
 */
export function refreshCookieAttrs(
  maxAgeSeconds: number,
  origin: string | undefined,
  cfg: RefreshCookieConfig,
): { httpOnly: true; secure: boolean; sameSite: SameSite; path: string; maxAge: number } {
  const embedded = isEmbeddedOrigin(origin, cfg.embedOrigins);
  const sameSite: SameSite = embedded ? 'none' : cfg.sameSite;
  // None is only honoured over HTTPS, so it forces Secure regardless of config.
  const secure = sameSite === 'none' ? true : cfg.secure;
  return { httpOnly: true, secure, sameSite, path: '/api/auth', maxAge: maxAgeSeconds };
}

/**
 * `frame-ancestors` for the CSP. Stays `'none'` — identical to the policy
 * that predates embedding — until an origin is actually configured.
 */
export function frameAncestorsFor(embedOrigins: string[]): string[] {
  return embedOrigins.length ? ["'self'", ...embedOrigins] : ["'none'"];
}
