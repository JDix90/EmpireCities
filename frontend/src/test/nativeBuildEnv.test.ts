/**
 * The guard `pnpm run build:native` runs (scripts/check-native-env.mjs): a
 * native build is refused without the server's full https address, and a
 * build that carries the website's prerendered landing page is refused too.
 */
import { describe, it, expect } from 'vitest';
import { checkNativeBuildEnv, checkNativeDist } from '../../scripts/nativeBuildEnv.mjs';

const GOOD = { VITE_API_URL: 'https://borderfall.gg', VITE_SOCKET_URL: 'https://borderfall.gg' };

describe('checkNativeBuildEnv', () => {
  it('accepts the server origin on https', () => {
    expect(checkNativeBuildEnv(GOOD).errors).toEqual([]);
    expect(checkNativeBuildEnv({ VITE_API_URL: 'https://borderfall.gg/', VITE_SOCKET_URL: ' https://borderfall.gg ' }).errors).toEqual([]);
  });

  it('refuses a build with no server address: the website\'s relative /api is nothing inside the app', () => {
    const { errors } = checkNativeBuildEnv({});
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('VITE_API_URL is not set');
    expect(errors[1]).toContain('VITE_SOCKET_URL is not set');
    expect(checkNativeBuildEnv({ VITE_API_URL: 'https://borderfall.gg' }).errors).toHaveLength(1);
  });

  it('refuses a relative or malformed address', () => {
    expect(checkNativeBuildEnv({ ...GOOD, VITE_API_URL: '/api' }).errors[0]).toContain('not an absolute URL');
    expect(checkNativeBuildEnv({ ...GOOD, VITE_API_URL: 'borderfall.gg' }).errors[0]).toContain('not an absolute URL');
  });

  it('refuses plain http, which iOS will not load, unless a local test build asks for it', () => {
    const http = { VITE_API_URL: 'http://192.168.1.20:3001', VITE_SOCKET_URL: 'http://192.168.1.20:3001' };
    expect(checkNativeBuildEnv(http).errors).toHaveLength(2);
    expect(checkNativeBuildEnv(http).errors[0]).toContain('iOS refuses plain http');
    const allowed = checkNativeBuildEnv({ ...http, NATIVE_ALLOW_HTTP: '1' });
    expect(allowed.errors).toEqual([]);
    expect(allowed.warnings.join(' ')).toContain('Never submit it to a store');
    expect(checkNativeBuildEnv({ ...GOOD, VITE_API_URL: 'ftp://borderfall.gg' }).errors[0]).toContain('must be an https:// address');
  });

  it('refuses a path, a query or credentials: the app adds /api itself', () => {
    expect(checkNativeBuildEnv({ ...GOOD, VITE_API_URL: 'https://borderfall.gg/api' }).errors[0]).toContain('origin only');
    expect(checkNativeBuildEnv({ ...GOOD, VITE_SOCKET_URL: 'https://borderfall.gg/?x=1' }).errors[0]).toContain('origin only');
    expect(checkNativeBuildEnv({ ...GOOD, VITE_API_URL: 'https://user:pw@borderfall.gg' }).errors[0]).toContain('credentials');
  });

  it('checks VITE_PUBLIC_SITE_URL the same way when it is set, and does not require it', () => {
    expect(checkNativeBuildEnv({ ...GOOD, VITE_PUBLIC_SITE_URL: 'https://www.borderfall.gg' }).errors).toEqual([]);
    expect(checkNativeBuildEnv({ ...GOOD, VITE_PUBLIC_SITE_URL: 'borderfall.gg' }).errors[0]).toContain('VITE_PUBLIC_SITE_URL');
    expect(checkNativeBuildEnv(GOOD).warnings.join(' ')).toContain('Shared links (invites, replays) will point at https://borderfall.gg');
  });

  it('warns about localhost, and about the API and sockets on different hosts', () => {
    const local = checkNativeBuildEnv({ VITE_API_URL: 'https://localhost:3001', VITE_SOCKET_URL: 'https://localhost:3001' });
    expect(local.errors).toEqual([]);
    expect(local.warnings.join(' ')).toContain('on a phone that is the phone itself');
    const split = checkNativeBuildEnv({ VITE_API_URL: 'https://api.example.com', VITE_SOCKET_URL: 'https://ws.example.com' });
    expect(split.warnings.join(' ')).toContain('differ');
  });
});

describe('checkNativeDist', () => {
  it('accepts the bare app shell', () => {
    expect(checkNativeDist('<html><body><div id="root"></div><script src="/assets/x.js"></script></body></html>')).toEqual([]);
  });

  it('refuses a web build, whose index.html carries the landing page for search engines', () => {
    const web = '<html><body><div id="root"><main class="bf-prerender" data-prerendered="true"><h1>Borderfall</h1></main></div></body></html>';
    expect(checkNativeDist(web)[0]).toContain('prerendered landing page');
  });

  it('refuses anything else that is not a clean shell', () => {
    expect(checkNativeDist('<html><body><div id="root"><p>hi</p></div></body></html>')[0]).toContain('not a clean app shell');
  });
});
