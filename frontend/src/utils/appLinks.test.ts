/**
 * Universal links. The file the website serves to iOS, the entitlement that
 * names the site, the nginx location that serves the file, and the code that
 * routes an opened link all have to agree, and none of them can be checked by
 * a compiler. This is where they are checked against each other.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { APP_LINK_PATHS, appLinkPatterns, resolveAppLink } from './appLinks';

const SITE = 'https://borderfall.gg';
const read = (p: string) => readFileSync(resolve(__dirname, '..', '..', p), 'utf8');

describe('resolveAppLink', () => {
  it('routes the links the app is for', () => {
    expect(resolveAppLink(`${SITE}/sign-in-link?token=abc%2Bdef`, SITE)).toBe('/sign-in-link?token=abc%2Bdef');
    expect(resolveAppLink(`${SITE}/reset-password?token=t`, SITE)).toBe('/reset-password?token=t');
    expect(resolveAppLink(`${SITE}/join/ABC123`, SITE)).toBe('/join/ABC123');
    expect(resolveAppLink(`${SITE}/replay/7f3c?source=share`, SITE)).toBe('/replay/7f3c?source=share');
    expect(resolveAppLink(`${SITE}/game/7f3c#chat`, SITE)).toBe('/game/7f3c#chat');
  });

  it('ignores every other page of the site: those stay in Safari', () => {
    for (const path of ['/', '/lobby', '/answers/is-borderfall-free', '/eras/ww2', '/admin', '/settings', '/join/', '/game', '/sign-in-link/extra', '/joined/x']) {
      expect(resolveAppLink(`${SITE}${path}`, SITE), path).toBeNull();
    }
  });

  // What arrives here comes from outside the app: an email, a message, another app.
  it('follows nothing that is not the website itself, on https', () => {
    expect(resolveAppLink('https://evil.test/sign-in-link?token=abc', SITE)).toBeNull();
    expect(resolveAppLink('https://borderfall.gg.evil.test/join/ABC', SITE)).toBeNull();
    expect(resolveAppLink('https://www.borderfall.gg/join/ABC', SITE)).toBeNull();
    expect(resolveAppLink('http://borderfall.gg/join/ABC', SITE)).toBeNull();
    expect(resolveAppLink('capacitor://localhost/join/ABC', SITE)).toBeNull();
    expect(resolveAppLink('javascript:alert(1)', SITE)).toBeNull();
    expect(resolveAppLink('/join/ABC', SITE)).toBeNull();
    expect(resolveAppLink('', SITE)).toBeNull();
    expect(resolveAppLink(`${SITE}/join/ABC`, 'not a url')).toBeNull();
  });

  it('cannot be walked out of its path', () => {
    // The URL parser resolves the dots before the path is looked at.
    expect(resolveAppLink(`${SITE}/join/../admin`, SITE)).toBeNull();
    expect(resolveAppLink(`${SITE}/replay/%2e%2e/admin`, SITE)).toBeNull();
  });
});

describe('the association file the website serves', () => {
  const file = JSON.parse(read('public/.well-known/apple-app-site-association')) as {
    applinks: { details: Array<{ appIDs: string[]; components: Array<{ '/': string }> }> };
  };
  const detail = file.applinks.details[0];

  it('is valid JSON naming this app', () => {
    expect(file.applinks.details).toHaveLength(1);
    expect(detail.appIDs).toHaveLength(1);
    // <Team ID>.<bundle ID>. A Team ID is ten capitals and digits; the
    // placeholder this file shipped with (REPLACE_WITH_APPLE_TEAM_ID) is not one.
    expect(detail.appIDs[0]).toMatch(/^[A-Z0-9]{10}\.com\.borderfall\.app$/);
  });

  it('claims exactly the paths the app routes, no more and no fewer', () => {
    expect(detail.components.map((c) => c['/']).sort()).toEqual(appLinkPatterns().sort());
  });

  it('claims no marketing page and nothing broad', () => {
    for (const { path } of APP_LINK_PATHS) {
      expect(path).not.toBe('/');
      expect(path).not.toMatch(/^\/(answers|eras|game-maps|about|daily)/);
    }
    expect(JSON.stringify(detail.components)).not.toContain('"/*"');
  });
});

describe('the rest of the chain', () => {
  it('nginx serves the file as JSON from an exact location, and a missing file is a 404, not index.html', () => {
    const conf = read('../docker/nginx.prod.conf');
    const start = conf.indexOf('location = /.well-known/apple-app-site-association {');
    expect(start).toBeGreaterThan(-1);
    const block = conf.slice(start, conf.indexOf('}', conf.indexOf('try_files', start)) + 1);
    expect(block).toContain('default_type application/json;');
    expect(block).toContain('try_files $uri =404;');
    // An add_header in a location drops the server-level CSP.
    expect(block).not.toContain('add_header');
  });

  it('the app is entitled to the same site the links are on', () => {
    const entitlements = read('ios/App/App/App.entitlements');
    expect(entitlements).toContain('<key>com.apple.developer.associated-domains</key>');
    expect(entitlements).toContain(`<string>applinks:${new URL(SITE).host}</string>`);
    const project = read('ios/App/App.xcodeproj/project.pbxproj');
    expect(project.match(/CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/g)).toHaveLength(2);
  });
});
