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
