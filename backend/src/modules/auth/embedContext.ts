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
 *
 * A leading `*.` label is allowed, matching the shape nginx's `frame-ancestors`
 * already uses: `https://*.crazygames.com`. A portal serves its pages from more
 * subdomains than it publishes, and the set cannot be enumerated from outside —
 * enumerating CrazyGames' domains from our own CSP silently dropped
 * `www.crazygames.com`, which is the one that matters, because the CSP covers
 * it only through the wildcard. A `*` anywhere else is rejected rather than
 * treated as a literal: `https://ev*l.com` is a typo, not an origin.
 *
 * A wildcard must still name a real domain — `https://*.com` is refused,
 * because a TLD-wide wildcard hands the embedded cookie to anyone who can
 * register under it. CSP refuses the same shape.
 */
export function parseEmbedOriginList(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const entry of raw.split(',')) {
    const t = entry.trim();
    if (!/^[a-z][a-z0-9+.-]*:\/\/(\*\.)?[^*/\s]+$/i.test(t)) continue;
    const wildcardSuffix = wildcardSuffixOf(t);
    // A wildcard needs at least one dot left of the TLD: `*.crazygames.com`
    // yes, `*.com` no.
    if (wildcardSuffix !== undefined && !wildcardSuffix.includes('.')) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/** The part after `://*.` for a wildcard entry, or undefined for a literal one. */
function wildcardSuffixOf(entry: string): string | undefined {
  const marker = entry.indexOf('://*.');
  return marker === -1 ? undefined : entry.slice(marker + '://*.'.length);
}

/**
 * True only for a request whose `Origin` is one of the configured embed
 * origins. A player on the site itself sends our own origin, or none at all
 * for a top-level navigation, so this is false for every direct visit — and
 * with `embedOrigins` empty it is false for everyone.
 *
 * A `*.` entry matches any subdomain of its suffix and nothing else. The
 * comparison is on the whole authority, and the suffix is matched WITH its
 * leading dot, which is what separates `evil.crazygames.com` (a subdomain they
 * control, so in) from `evilcrazygames.com` and `crazygames.com.evil.test`
 * (different registrations, so out). The bare domain does not match its own
 * wildcard — list it too if it embeds — and neither does a different scheme or
 * a port, since both are part of the authority being compared.
 */
export function isEmbeddedOrigin(origin: string | undefined, embedOrigins: string[]): boolean {
  if (typeof origin !== 'string') return false;
  for (const entry of embedOrigins) {
    if (entry === origin) return true;
    const suffix = wildcardSuffixOf(entry);
    if (suffix === undefined) continue;
    const scheme = entry.slice(0, entry.indexOf('://*.'));
    const prefix = `${scheme}://`;
    if (!origin.startsWith(prefix)) continue;
    const authority = origin.slice(prefix.length);
    // endsWith the DOTTED suffix, and something must precede the dot.
    if (authority.length > suffix.length + 1 && authority.endsWith(`.${suffix}`)) return true;
  }
  return false;
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
): {
  httpOnly: true;
  secure: boolean;
  sameSite: SameSite;
  path: string;
  maxAge: number;
  partitioned: boolean;
} {
  const embedded = isEmbeddedOrigin(origin, cfg.embedOrigins);
  const sameSite: SameSite = embedded ? 'none' : cfg.sameSite;
  // None is only honoured over HTTPS, so it forces Secure regardless of config.
  const secure = sameSite === 'none' ? true : cfg.secure;
  /**
   * CHIPS. `SameSite=None` alone is no longer enough: Chrome's third-party
   * cookie phase-out blocks an unpartitioned cross-site cookie outright, so a
   * correctly-attributed None cookie was still dropped and the session still
   * died on reload inside the frame. Measured in Chromium under
   * `--test-third-party-cookie-phaseout`:
   *
   *   SameSite=None                 -> WAS NOT SENT
   *   SameSite=None; Partitioned    -> ARRIVED
   *
   * Partitioning keys the cookie to (top-level site, us), so a session started
   * inside a portal stays inside that portal and never mixes with a direct
   * visit. For this cookie that is the behaviour we want anyway.
   *
   * Tied to `sameSite === 'none'`, not to `embedded`, so it can only ever
   * appear on a cookie that is already cross-site. A direct player's Lax
   * cookie is untouched, and browsers that do not implement CHIPS ignore the
   * unknown attribute.
   */
  const partitioned = sameSite === 'none';
  return { httpOnly: true, secure, sameSite, path: '/api/auth', maxAge: maxAgeSeconds, partitioned };
}

/**
 * `frame-ancestors` for the CSP. Stays `'none'` — identical to the policy
 * that predates embedding — until an origin is actually configured.
 */
export function frameAncestorsFor(embedOrigins: string[]): string[] {
  return embedOrigins.length ? ["'self'", ...embedOrigins] : ["'none'"];
}
