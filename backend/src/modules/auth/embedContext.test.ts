import { describe, it, expect } from 'vitest';
import {
  parseEmbedOriginList,
  isEmbeddedOrigin,
  refreshCookieAttrs,
  frameAncestorsFor,
  resolveEmbedderOrigin,
  type RefreshCookieConfig,
} from './embedContext';

/** What production looks like today: embedding off, Lax cookie, Secure on. */
const PROD_TODAY: RefreshCookieConfig = { embedOrigins: [], sameSite: 'lax', secure: true };
const PORTAL = 'https://html.itch.zone';
const OURS = 'https://borderfall.gg';

describe('parseEmbedOriginList', () => {
  it('is empty when the env var is unset or blank', () => {
    expect(parseEmbedOriginList(undefined)).toEqual([]);
    expect(parseEmbedOriginList('')).toEqual([]);
    expect(parseEmbedOriginList('   ')).toEqual([]);
  });

  it('parses, trims and de-duplicates a comma list', () => {
    expect(parseEmbedOriginList(` ${PORTAL} , https://crazygames.com,${PORTAL} `))
      .toEqual([PORTAL, 'https://crazygames.com']);
  });

  it('keeps a native app scheme — dropping it is an invisible failure', () => {
    // CrazyGames' iOS app embeds games from `capacitor://app.crazygames.com`:
    // iOS reserves `https` for the network and will not let a WebView serve
    // local content over it. This used to be filtered out by an http(s)-only
    // check, and a dropped entry has nothing to point at — the app's players
    // just never receive the embedded cookie.
    expect(parseEmbedOriginList('capacitor://app.crazygames.com'))
      .toEqual(['capacitor://app.crazygames.com']);
    expect(parseEmbedOriginList('https://www.crazygames.com,capacitor://app.crazygames.com'))
      .toEqual(['https://www.crazygames.com', 'capacitor://app.crazygames.com']);
  });

  it('drops anything that could never match an Origin header', () => {
    // Origin is compared exactly, per spec — these would fail silently.
    // The SHAPE is what is checked; the scheme is not second-guessed, because
    // this list is operator config and portals keep inventing schemes.
    expect(parseEmbedOriginList('itch.zone')).toEqual([]);              // no scheme
    expect(parseEmbedOriginList('https://itch.zone/embed')).toEqual([]); // has a path
    expect(parseEmbedOriginList('https://itch.zone/')).toEqual([]);      // trailing slash
    expect(parseEmbedOriginList('https://itch zone')).toEqual([]);       // whitespace
    expect(parseEmbedOriginList('://itch.zone')).toEqual([]);            // no scheme name
    expect(parseEmbedOriginList('https://a b.com')).toEqual([]);         // whitespace
  });
});

describe('isEmbeddedOrigin', () => {
  it('is false for everyone while no embed origin is configured', () => {
    for (const o of [PORTAL, OURS, undefined]) {
      expect(isEmbeddedOrigin(o, [])).toBe(false);
    }
  });

  it('matches only an exact configured origin', () => {
    expect(isEmbeddedOrigin(PORTAL, [PORTAL])).toBe(true);
    expect(isEmbeddedOrigin(OURS, [PORTAL])).toBe(false);
    expect(isEmbeddedOrigin(undefined, [PORTAL])).toBe(false);
    expect(isEmbeddedOrigin('https://html.itch.zone.evil.test', [PORTAL])).toBe(false);
  });
});

describe('refreshCookieAttrs', () => {
  // The whole point of the feature: direct players must be untouched.
  it('NO-OP: with embedding off, every request gets the pre-existing cookie', () => {
    for (const origin of [undefined, OURS, PORTAL]) {
      expect(refreshCookieAttrs(60, origin, PROD_TODAY)).toEqual({
        httpOnly: true, secure: true, sameSite: 'lax', path: '/api/auth', maxAge: 60,
      });
    }
  });

  it('leaves direct players on Lax even once a portal is configured', () => {
    const cfg: RefreshCookieConfig = { ...PROD_TODAY, embedOrigins: [PORTAL] };
    // Top-level navigation sends no Origin; a same-site fetch sends ours.
    expect(refreshCookieAttrs(60, undefined, cfg).sameSite).toBe('lax');
    expect(refreshCookieAttrs(60, OURS, cfg).sameSite).toBe('lax');
  });

  it('relaxes to None only for a request from the configured portal', () => {
    const cfg: RefreshCookieConfig = { ...PROD_TODAY, embedOrigins: [PORTAL] };
    expect(refreshCookieAttrs(60, PORTAL, cfg)).toEqual({
      httpOnly: true, secure: true, sameSite: 'none', path: '/api/auth', maxAge: 60,
    });
  });

  it('forces Secure with None even where the deployment has it off', () => {
    // SameSite=None is ignored over plain HTTP, so the cookie would vanish.
    const cfg: RefreshCookieConfig = { embedOrigins: [PORTAL], sameSite: 'lax', secure: false };
    expect(refreshCookieAttrs(60, PORTAL, cfg).secure).toBe(true);
    // ...and does not quietly turn Secure on for anyone else.
    expect(refreshCookieAttrs(60, OURS, cfg).secure).toBe(false);
  });

  it('keeps httpOnly and the /api/auth path in every case', () => {
    const cfg: RefreshCookieConfig = { ...PROD_TODAY, embedOrigins: [PORTAL] };
    for (const origin of [undefined, OURS, PORTAL]) {
      const a = refreshCookieAttrs(60, origin, cfg);
      expect(a.httpOnly).toBe(true);
      expect(a.path).toBe('/api/auth');
    }
  });
});

describe('frameAncestorsFor', () => {
  it("NO-OP: stays 'none' while nothing is configured", () => {
    expect(frameAncestorsFor([])).toEqual(["'none'"]);
  });

  it('allows self plus the configured portals once set', () => {
    expect(frameAncestorsFor([PORTAL, 'https://crazygames.com']))
      .toEqual(["'self'", PORTAL, 'https://crazygames.com']);
  });
});

/**
 * The gap this closes, proven in a browser before it was written: two real
 * cross-site TLS origins, a portal framing us, the REAL refreshCookieAttrs on
 * the server. `Origin` came back as our own origin and `Sec-Fetch-Site` as
 * `same-origin`, the cookie stayed on Lax, and the browser then withheld it —
 * because SameSite is judged against the top-level site. Handing the function
 * the portal origin flipped it to None and the cookie arrived.
 */
describe('resolveEmbedderOrigin', () => {
  const PORTALS = [PORTAL, 'capacitor://app.crazygames.com'];

  it('NO-OP: finds nobody while no portal is configured', () => {
    expect(resolveEmbedderOrigin(PORTAL, PORTAL, [])).toBeUndefined();
    expect(resolveEmbedderOrigin(OURS, OURS, [])).toBeUndefined();
  });

  it('trusts a browser-set Origin that is itself a configured portal', () => {
    // The cross-origin case: a portal-hosted build calling our API.
    expect(resolveEmbedderOrigin(PORTAL, undefined, PORTALS)).toBe(PORTAL);
  });

  it('falls back to the declared header when the browser tells us nothing', () => {
    // THE CASE THAT WAS BROKEN: framed document, so Origin is our own.
    expect(resolveEmbedderOrigin(OURS, PORTAL, PORTALS)).toBe(PORTAL);
    expect(resolveEmbedderOrigin(undefined, PORTAL, PORTALS)).toBe(PORTAL);
  });

  it('accepts a native app scheme, which is where this bites hardest', () => {
    expect(resolveEmbedderOrigin(OURS, 'capacitor://app.crazygames.com', PORTALS))
      .toBe('capacitor://app.crazygames.com');
  });

  it('never lets a client invent an embedder', () => {
    // The allowlist stays the only authority — claiming an unlisted origin
    // gets exactly nothing, which is what keeps this a hint and not a key.
    expect(resolveEmbedderOrigin(OURS, 'https://evil.example', PORTALS)).toBeUndefined();
    expect(resolveEmbedderOrigin('https://evil.example', 'https://evil.example', PORTALS))
      .toBeUndefined();
  });

  it('ignores a header sent more than once rather than guessing', () => {
    expect(resolveEmbedderOrigin(OURS, [PORTAL, 'https://evil.example'], PORTALS))
      .toBeUndefined();
  });

  it('leaves a direct player alone even with portals configured', () => {
    const attrs = refreshCookieAttrs(60, resolveEmbedderOrigin(OURS, undefined, PORTALS), {
      embedOrigins: PORTALS, sameSite: 'lax', secure: true,
    });
    expect(attrs.sameSite).toBe('lax');
  });

  it('end to end: a framed request now gets the cookie that survives framing', () => {
    const attrs = refreshCookieAttrs(60, resolveEmbedderOrigin(OURS, PORTAL, PORTALS), {
      embedOrigins: PORTALS, sameSite: 'lax', secure: true,
    });
    expect(attrs.sameSite).toBe('none');
    expect(attrs.secure).toBe(true);
  });
});
