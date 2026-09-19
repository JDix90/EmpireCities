/**
 * The client half of the embedded-cookie fix. Proven in a browser first: with
 * borderfall.gg framed by a cross-site portal, its own API calls carry
 * `Origin: https://borderfall.gg` and `Sec-Fetch-Site: same-origin`, so the
 * server saw nothing to identify the portal and wrote a `Lax` cookie the
 * browser then withheld. This is what supplies the missing fact.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  detectEmbedderOrigin,
  EMBEDDER_HEADER,
  detectPortal,
  ownAuthUiAllowed,
} from './embedContext';
import { PORTALS } from './portals.generated';

const realTop = window.top;

function framedBy(opts: { ancestors?: string[]; referrer?: string }) {
  // window.top !== window.self is what "we are in a frame" means.
  Object.defineProperty(window, 'top', { value: {} as Window, configurable: true });
  if (opts.ancestors) {
    Object.defineProperty(window.location, 'ancestorOrigins', {
      value: Object.assign([...opts.ancestors], { item: (i: number) => opts.ancestors![i] }),
      configurable: true,
    });
  }
  if (opts.referrer !== undefined) {
    vi.spyOn(document, 'referrer', 'get').mockReturnValue(opts.referrer);
  }
}

afterEach(() => {
  Object.defineProperty(window, 'top', { value: realTop, configurable: true });
  Reflect.deleteProperty(window.location as object, 'ancestorOrigins');
  vi.restoreAllMocks();
});

describe('detectEmbedderOrigin', () => {
  it('finds nobody for a direct player, so they send no extra header', () => {
    // window.top === window.self in a normal tab.
    expect(detectEmbedderOrigin()).toBeUndefined();
  });

  it('reports the TOP-LEVEL origin, not the immediate parent', () => {
    // itch nests us: itch.io > itch.zone player > us. CrazyGames' apps nest us
    // too. SameSite is judged against the top of that chain, so that is the
    // origin worth naming. ancestorOrigins is ordered nearest-first.
    framedBy({ ancestors: ['https://html-classic.itch.zone', 'https://itch.io'] });
    expect(detectEmbedderOrigin()).toBe('https://itch.io');
  });

  it('falls back to the referrer origin where ancestorOrigins is missing', () => {
    // Firefox does not implement ancestorOrigins.
    framedBy({ referrer: 'https://www.crazygames.com/game/borderfall?x=1' });
    expect(detectEmbedderOrigin()).toBe('https://www.crazygames.com');
  });

  it('gives up quietly rather than throwing the API client over', () => {
    framedBy({ referrer: '' });
    expect(detectEmbedderOrigin()).toBeUndefined();

    framedBy({ ancestors: ['null'], referrer: 'not a url' });
    expect(detectEmbedderOrigin()).toBeUndefined();
  });

  it('uses the header name the server reads', () => {
    // A rename on one side and not the other fails silently, which is exactly
    // the class of bug this whole change exists to fix.
    expect(EMBEDDER_HEADER).toBe('x-bf-embedder');
  });
});

/**
 * The wiring, not just the helper. A detector that works while nothing sends
 * its result is the same silent failure this change exists to fix, so both
 * axios instances are checked against the header the server actually reads.
 */
describe('the header actually reaches the API clients', () => {
  async function importFramedClients() {
    Object.defineProperty(window, 'top', { value: {} as Window, configurable: true });
    Object.defineProperty(window.location, 'ancestorOrigins', {
      value: Object.assign(['https://itch.io'], { item: (i: number) => ['https://itch.io'][i] }),
      configurable: true,
    });
    vi.resetModules();
    const axios = (await import('axios')).default;
    const createSpy = vi.spyOn(axios, 'create');
    const { api } = await import('../services/api');
    await import('../store/authStore');
    return { api, createSpy };
  }

  it('sets it on `api` when framed', async () => {
    const { api } = await importFramedClients();
    expect((api.defaults.headers as Record<string, unknown>)[EMBEDDER_HEADER])
      .toBe('https://itch.io');
  });

  it('sets it on the raw client too — that is the one that writes the cookie', async () => {
    // authStore's `rawHttp` bypasses the interceptors and calls /auth/guest and
    // /auth/refresh. If it alone missed the header, the cookie would be written
    // with Lax and silently dropped inside every frame.
    const { createSpy } = await importFramedClients();
    const withHeader = createSpy.mock.calls.filter(([cfg]) =>
      (cfg?.headers as Record<string, unknown> | undefined)?.[EMBEDDER_HEADER] === 'https://itch.io');
    expect(withHeader.length).toBeGreaterThanOrEqual(1);
  });

  it('a direct player sends no such header at all', async () => {
    vi.resetModules();
    Reflect.deleteProperty(window.location as object, 'ancestorOrigins');
    Object.defineProperty(window, 'top', { value: window.self, configurable: true });
    const { api } = await import('../services/api');
    expect((api.defaults.headers as Record<string, unknown>)[EMBEDDER_HEADER]).toBeUndefined();
  });
});

describe('detectPortal', () => {
  it('identifies CrazyGames on any of its registered domains', () => {
    for (const origin of [
      'https://www.crazygames.com',
      'https://crazygames.com',
      'https://games.crazygames.com',
      'https://a.b.crazygames.com',
      'https://www.crazygames.fr',
      'https://www.crazygames.com.br',
      'https://www.crazygames.co.kr',
      'capacitor://app.crazygames.com',
    ]) {
      expect(detectPortal(origin)?.id, origin).toBe('crazygames');
    }
  });

  it('identifies itch.io by its project page and by its player subdomain', () => {
    expect(detectPortal('https://itch.io')?.id).toBe('itch');
    expect(detectPortal('https://someone.itch.io')?.id).toBe('itch');
    expect(detectPortal('https://html-classic.itch.zone')?.id).toBe('itch');
  });

  it('rejects a lookalike or someone else\'s subdomain', () => {
    // Suffix compared WITH its leading dot — the same rule as the backend.
    for (const origin of [
      'https://evilcrazygames.com',
      'https://crazygames.com.evil.test',
      'https://notcrazygames.io',
      'https://itch.io.evil.test',
    ]) {
      expect(detectPortal(origin), origin).toBeUndefined();
    }
  });

  it('rejects a downgraded scheme and an added port', () => {
    expect(detectPortal('http://www.crazygames.com')).toBeUndefined();
    expect(detectPortal('https://www.crazygames.com:8443')).toBeUndefined();
  });

  it('is undefined when not embedded, or for an unparseable origin', () => {
    expect(detectPortal(undefined)).toBeUndefined();
    expect(detectPortal('')).toBeUndefined();
    expect(detectPortal('not a url')).toBeUndefined();
  });

  it('reads the same registry the CSP and the cookie allowlist are generated from', () => {
    expect(PORTALS.map((p) => p.id)).toEqual(expect.arrayContaining(['itch', 'crazygames']));
  });
});

describe('ownAuthUiAllowed', () => {
  it('allows our own auth UI when nothing is framing us', () => {
    // EMBEDDER_ORIGIN is undefined under jsdom (no ancestors): the direct-player case.
    expect(ownAuthUiAllowed()).toBe(true);
    expect(ownAuthUiAllowed(undefined)).toBe(true);
  });

  it('forbids it inside CrazyGames, per their Basic requirements', () => {
    expect(ownAuthUiAllowed('https://www.crazygames.com')).toBe(false);
    expect(ownAuthUiAllowed('capacitor://app.crazygames.com')).toBe(false);
  });

  it('allows it inside itch.io, which has no such rule', () => {
    expect(ownAuthUiAllowed('https://someone.itch.io')).toBe(true);
  });

  it('allows it for an unknown framer, which could not have passed frame-ancestors anyway', () => {
    expect(ownAuthUiAllowed('https://evilcrazygames.com')).toBe(true);
  });
});
