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
 * Only absolute `scheme://host` origins are kept: `Origin` is matched exactly,
 * per spec, so a bare host or a value with a trailing path would silently
 * never match and embedding would fail with nothing to point at.
 *
 * The scheme is deliberately NOT restricted to http(s). A portal's native app
 * embeds us from a non-http origin — CrazyGames' iOS app is
 * `capacitor://app.crazygames.com`, because iOS reserves `https` for the
 * network and will not let a WebView serve local content over it. An
 * http(s)-only filter dropped that entry silently, and a dropped origin has no
 * error to point at: the app's players simply never get the embedded cookie.
 *
 * This is an operator-configured allowlist read from the environment, not user
 * input, so accepting any well-formed scheme costs nothing. The shape is still
 * strict — no paths, no whitespace, no bare hosts.
 */
export function parseEmbedOriginList(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const entry of raw.split(',')) {
    const t = entry.trim();
    if (/^[a-z][a-z0-9+.-]*:\/\/[^/\s]+$/i.test(t) && !out.includes(t)) out.push(t);
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
 * Header a framed client uses to declare the origin embedding it.
 *
 * Needed because the browser will not tell us. When a portal frames
 * borderfall.gg directly, the framed document IS borderfall.gg, so its API
 * calls are same-origin and carry `Origin: https://borderfall.gg` — the
 * portal's origin never appears, and `Sec-Fetch-Site` reads `same-origin`
 * too. Verified in a browser against two real cross-site TLS origins: the
 * refresh cookie stayed on `Lax` and was then withheld, because the browser
 * judges SameSite against the TOP-LEVEL site, which is the portal. Every load
 * inside the embed started a fresh anonymous session.
 */
export const EMBEDDER_HEADER = 'x-bf-embedder';

/**
 * The embedding origin for this request, or undefined when not embedded.
 *
 * Trust order, strongest first:
 *
 *   1. `Origin`, when it is itself an allowlisted portal. Browser-set and
 *      unforgeable from another site; this is the cross-origin case, e.g. a
 *      portal-hosted build calling our API.
 *   2. The declared header, when it names an allowlisted portal. This is the
 *      framed-document case above, where the browser gives us nothing to go on.
 *
 * The allowlist stays the only authority in both branches — a client can claim
 * an embedder but not invent one. Claiming a listed portal while not embedded
 * buys only a `SameSite=None` cookie for the claimant's own session, and a
 * cross-site page cannot make that claim at all: a custom header forces a CORS
 * preflight, which a non-allowlisted origin fails. Setting it from our own
 * origin requires script there, which is already a total compromise.
 *
 * An array-valued header (sent more than once) is ignored rather than merged.
 */
export function resolveEmbedderOrigin(
  origin: string | undefined,
  declared: string | string[] | undefined,
  embedOrigins: string[],
): string | undefined {
  if (isEmbeddedOrigin(origin, embedOrigins)) return origin;
  if (typeof declared === 'string' && isEmbeddedOrigin(declared, embedOrigins)) return declared;
  return undefined;
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
