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

/**
 * The IMMEDIATE parent's origin, or undefined when nobody is framing us.
 *
 * Deliberately different from `EMBEDDER_ORIGIN` above, which is the TOP-LEVEL
 * origin because that is what decides whether a cookie counts as cross-site.
 * The launcher shell is not the top: on itch the top is `<user>.itch.io` while
 * the shell runs in `html-classic.itch.zone`, and on Newgrounds the top is
 * `www.newgrounds.com` while the shell is served from `uploads.ungrounded.net`.
 * A handshake aimed at the top window would never reach the page listening for
 * it. `ancestorOrigins` is ordered nearest-first, so entry 0 is the parent;
 * `document.referrer` on a framed document is the embedding page, which is the
 * same thing where the header survives (our shells set
 * `referrerpolicy="origin-when-cross-origin"` precisely so it does).
 */
export function detectParentOrigin(): string | undefined {
  try {
    if (typeof window === 'undefined' || window.parent === window.self) return undefined;
    const ancestors = window.location.ancestorOrigins;
    if (ancestors && ancestors.length > 0) {
      const parent = ancestors[0];
      if (parent && parent !== 'null') return parent;
    }
    return document.referrer ? originOf(document.referrer) : undefined;
  } catch {
    return undefined;
  }
}

/** The handshake payload. Versioned so a shell can refuse a shape it does not know. */
export interface EmbedReadyMessage {
  readonly source: 'borderfall';
  readonly type: 'embed-ready';
  readonly version: 1;
}

/**
 * Re-announce, because the listener may not exist yet. The shell attaches its
 * handler in a script at the end of its own body, and we cannot observe when
 * that happened. A single post that lands one tick early is lost in silence
 * and the shell then shows an error over a game that is running fine — which
 * is the exact failure this handshake exists to remove, reintroduced by a race.
 * Three attempts over two seconds costs nothing and removes the question.
 */
const READY_RETRY_DELAYS_MS = [0, 500, 2000];

/**
 * Tell the page framing us that the app really booted.
 *
 * Why this exists: from a parent page you CANNOT distinguish a loaded
 * cross-origin frame from a browser error page. Reading
 * `contentWindow.location.href` throws `SecurityError` for both, so a shell
 * that infers success from a thrown read calls a blocked frame "playing" and
 * hides its own fallback. Measured against production: a frame refused by
 * `frame-ancestors` fails with ERR_BLOCKED_BY_RESPONSE, lands on
 * `chrome-error://chromewebdata/`, and the read throws. On Newgrounds that
 * showed visitors Chrome's "refused to connect" page instead of a working
 * "play in a new tab" button.
 *
 * Inference cannot be fixed from the parent side, so the child asserts
 * instead. A message that arrives is proof the bundle ran; nothing else can
 * send it.
 *
 * Targeting: the parent's own origin when we know it, rather than `'*'`.
 * Reaching `'*'` would be safe in practice — the payload carries no secret,
 * and anyone framing us has already satisfied `frame-ancestors` — but naming
 * the origin costs nothing and keeps the message off any other document.
 * When the origin cannot be determined we do fall back to `'*'`, because the
 * alternative is staying silent and letting the shell display a false error.
 */
export function notifyEmbedderReady(): void {
  if (typeof window === 'undefined' || window.parent === window.self) return;
  const message: EmbedReadyMessage = { source: 'borderfall', type: 'embed-ready', version: 1 };
  const target = detectParentOrigin() ?? '*';
  const post = () => {
    try {
      window.parent.postMessage(message, target);
    } catch {
      /* a parent that has gone away is not our problem to report */
    }
  };
  for (const delay of READY_RETRY_DELAYS_MS) {
    if (delay === 0) post();
    else window.setTimeout(post, delay);
  }
}
