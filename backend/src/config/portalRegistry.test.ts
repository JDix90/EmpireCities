/**
 * Drift test for the portal registry.
 *
 * `docker/portals.json` is the one list of portals that may embed the game.
 * Three artifacts derive from it — nginx's `frame-ancestors`, the client's
 * per-portal policy, and the documented EMBED_ORIGINS value — and a portal
 * present in one but not another fails silently: the frame renders, the game
 * plays, and every reload starts a fresh anonymous session. This test turns
 * that silence into a red build.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  loadRegistry,
  allOrigins,
  embedOriginsValue,
  nginxBlock,
  currentNginxBlock,
  generatedTs,
  envExampleLine,
  NGINX_CONF_PATH,
  GENERATED_TS_PATH,
  ENV_EXAMPLE_PATH,
} from '../../scripts/syncPortals';
import { parseEmbedOriginList } from '../modules/auth/embedContext';

const reg = loadRegistry();
const STALE = 'stale — run: pnpm -C backend exec tsx scripts/syncPortals.ts';

describe('docker/portals.json', () => {
  it('has unique ids and at least one origin per portal', () => {
    const ids = reg.portals.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of reg.portals) {
      expect(p.origins.length, p.id).toBeGreaterThan(0);
      expect(typeof p.ownAuthUi, p.id).toBe('boolean');
    }
  });

  it('lists only origins the cookie allowlist would accept', () => {
    // The same parser guards EMBED_ORIGINS at boot. An origin it drops — a
    // path, a bare host, a TLD wildcard — would appear in the CSP and never
    // match a cookie, which is exactly the silent failure this exists to catch.
    for (const o of allOrigins(reg)) expect(parseEmbedOriginList(o), o).toEqual([o]);
  });

  it('lists only origins nginx can carry inside a quoted header value', () => {
    for (const o of allOrigins(reg)) expect(o, o).not.toMatch(/["';\s]/);
  });

  it('still names the portals that were live before the registry existed', () => {
    expect(allOrigins(reg)).toEqual(
      expect.arrayContaining(['https://itch.io', 'https://*.itch.zone', 'https://*.crazygames.com', 'capacitor://app.crazygames.com']),
    );
  });
});

describe('generated artifacts are current', () => {
  it('nginx frame-ancestors block matches the registry', () => {
    const conf = readFileSync(NGINX_CONF_PATH, 'utf8');
    const current = currentNginxBlock(conf);
    expect(current, 'portal markers missing from nginx.prod.conf — run the sync once').toBeDefined();
    const indent = current!.slice(0, current!.indexOf('#'));
    expect(current, STALE).toBe(nginxBlock(reg, indent));
  });

  it('nginx carries exactly one frame-ancestors policy', () => {
    // A second, older add_header left behind would make browsers enforce the
    // INTERSECTION of the two — narrowing the allowlist to whatever the stale
    // line happened to contain.
    const conf = readFileSync(NGINX_CONF_PATH, 'utf8');
    const policies = conf.split('\n').filter((l) => /^\s*add_header\b.*frame-ancestors/.test(l));
    expect(policies).toHaveLength(1);
  });

  it('frontend portals.generated.ts matches the registry', () => {
    expect(readFileSync(GENERATED_TS_PATH, 'utf8'), STALE).toBe(generatedTs(reg));
  });

  it('.env.production.example sample matches the registry', () => {
    const line = readFileSync(ENV_EXAMPLE_PATH, 'utf8').match(/^# EMBED_ORIGINS=.*$/m)?.[0];
    expect(line, STALE).toBe(envExampleLine(reg));
  });
});

describe('the EMBED_ORIGINS value', () => {
  it('round-trips through the backend parser with nothing dropped', () => {
    expect(parseEmbedOriginList(embedOriginsValue(reg))).toEqual(allOrigins(reg));
  });
});
