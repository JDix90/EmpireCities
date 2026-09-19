/**
 * Who, if anyone, is framing us — and telling the server so.
 *
 * When a portal frames borderfall.gg directly (itch today, CrazyGames as an
 * iframe submission), the framed document is still borderfall.gg. Its API
 * calls are therefore same-origin and carry `Origin: https://borderfall.gg`;
 * the portal's origin appears in no header the browser sets, and
 * `Sec-Fetch-Site` reads `same-origin`. The server had no way to know it was
 * embedded, so the refresh cookie stayed on `SameSite=Lax` — which the browser
 * then withheld, because it judges SameSite against the TOP-LEVEL site. Every
 * load inside the embed began a fresh anonymous session.
 *
 * So the client declares it. The value is only ever a hint: the server accepts
 * it solely when it already appears in EMBED_ORIGINS, so this can name a
 * configured portal but never invent one.
 */

import { PORTALS, type Portal } from './portals.generated';

export type { Portal };

/** Must match EMBEDDER_HEADER in backend/src/modules/auth/embedContext.ts. */
export const EMBEDDER_HEADER = 'x-bf-embedder';

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/**
 * The TOP-LEVEL origin when we are framed, else undefined.
 *
 * Top-level rather than immediate parent because that is what decides whether
 * a cookie counts as cross-site. `ancestorOrigins` is ordered nearest-first, so
 * the last entry is the top window; it is unavailable in Firefox, where the
 * referrer is the closest thing on offer. Every access is guarded: reading
 * across a cross-origin boundary can throw, and a detection helper that throws
 * would take the whole API client down with it.
 */
export function detectEmbedderOrigin(): string | undefined {
  try {
    if (typeof window === 'undefined' || window.top === window.self) return undefined;
    const ancestors = window.location.ancestorOrigins;
    if (ancestors && ancestors.length > 0) {
      const top = ancestors[ancestors.length - 1];
      if (top && top !== 'null') return top;
    }
    return document.referrer ? originOf(document.referrer) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Computed once per page load: the ancestor chain cannot change without a
 * navigation, and this rides on every request.
 */
export const EMBEDDER_ORIGIN = detectEmbedderOrigin();

/** Spreadable header bag — empty when not embedded, so direct players send nothing. */
export function embedderHeaders(): Record<string, string> {
  return EMBEDDER_ORIGIN ? { [EMBEDDER_HEADER]: EMBEDDER_ORIGIN } : {};
}

/**
 * Whether OUR OWN login/registration UI may be shown in this document.
 *
 * Some portals forbid it. CrazyGames' account-integration requirements state
 * the experience they guarantee their users — "No additional login flows
 * in-game are needed", and guests must not "use different login methods than
 * 'Login with CrazyGames'" — and their QA checklist lists "No external login
 * options" under BASIC requirements. An email/password Sign In is exactly such
 * an option.
 *
 * Which portals forbid it is data, not code: `ownAuthUi` in
 * docker/portals.json, carried into PORTALS by the sync script. Inside such a
 * frame the app is guest-only — the auth CTAs are hidden and /login, /register
 * and /upgrade redirect away. Nothing changes for a direct player, or for a
 * portal without the rule (itch.io), where a player with an account can still
 * sign in.
 *
 * Presentation, not authorization: it hides a flow a portal disallows. The
 * server still decides what any request is actually permitted to do.
 */
export function ownAuthUiAllowed(origin: string | undefined = EMBEDDER_ORIGIN): boolean {
  return detectPortal(origin)?.ownAuthUi ?? true;
}

/**
 * The registry entry for whoever is framing us, or undefined when nobody is —
 * or when the framer is not a known portal, which for policy purposes is the
 * same thing: an unknown framer could not have passed `frame-ancestors`.
 *
 * Matching mirrors the backend allowlist exactly (`isEmbeddedOrigin` in
 * backend/src/modules/auth/embedContext.ts): an entry matches its own origin
 * verbatim, and a `scheme://*.suffix` entry matches any subdomain of that
 * suffix — compared WITH the leading dot, so `evil.crazygames.com` is in and
 * `evilcrazygames.com` and `crazygames.com.evil.test` are out. Scheme and port
 * are part of the comparison. The same list feeds the CSP and the cookie
 * allowlist, so the three cannot disagree about who a portal is.
 */
export function detectPortal(origin: string | undefined = EMBEDDER_ORIGIN): Portal | undefined {
  if (!origin) return undefined;
  return PORTALS.find((p) => p.origins.some((pattern) => originMatches(origin, pattern)));
}

function originMatches(origin: string, pattern: string): boolean {
  if (origin === pattern) return true;
  const marker = pattern.indexOf('://*.');
  if (marker === -1) return false;
  const prefix = `${pattern.slice(0, marker)}://`;
  if (!origin.startsWith(prefix)) return false;
  const suffix = pattern.slice(marker + '://*.'.length);
  const authority = origin.slice(prefix.length);
  return authority.length > suffix.length + 1 && authority.endsWith(`.${suffix}`);
}
