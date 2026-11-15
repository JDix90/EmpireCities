/**
 * What a native (Capacitor) build needs from its environment, as a pure check
 * so it can be tested (src/test/nativeBuildEnv.test.ts). The CLI is
 * scripts/check-native-env.mjs.
 *
 * The website is served from the same host as its API, so it builds with no
 * server address and calls `/api`. The native app is served from inside the
 * app (`capacitor://localhost`), where `/api` is nothing: without an absolute
 * VITE_API_URL and VITE_SOCKET_URL the app starts and can reach no server,
 * and nothing says why. iOS also refuses plain http (App Transport Security).
 */

const SERVER_VARS = ['VITE_API_URL', 'VITE_SOCKET_URL'];

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function checkNativeBuildEnv(env) {
  const errors = [];
  const warnings = [];
  const allowHttp = env.NATIVE_ALLOW_HTTP === '1';

  const parsed = {};
  for (const name of [...SERVER_VARS, 'VITE_PUBLIC_SITE_URL']) {
    const raw = (env[name] ?? '').trim();
    const required = SERVER_VARS.includes(name);
    if (!raw) {
      if (required) {
        errors.push(`${name} is not set. A native build needs the server's full address, e.g. ${name}=https://your-domain.example`);
      }
      continue;
    }
    let url;
    try {
      url = new URL(raw);
    } catch {
      errors.push(`${name}="${raw}" is not an absolute URL. Use the full address, e.g. https://your-domain.example`);
      continue;
    }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && allowHttp)) {
      errors.push(
        url.protocol === 'http:'
          ? `${name}="${raw}" is http. iOS refuses plain http; use https (or NATIVE_ALLOW_HTTP=1 for a local test build only).`
          : `${name}="${raw}" must be an https:// address.`,
      );
      continue;
    }
    if (url.pathname !== '/' || url.search || url.hash) {
      errors.push(`${name}="${raw}" must be an origin only (no path, query or #): the app adds /api and /socket.io itself.`);
      continue;
    }
    if (url.username || url.password) {
      errors.push(`${name} must not contain credentials.`);
      continue;
    }
    parsed[name] = url;
  }

  for (const name of Object.keys(parsed)) {
    const host = parsed[name].hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') {
      warnings.push(`${name} points at ${host}: on a phone that is the phone itself, not your computer.`);
    }
  }
  if (allowHttp) {
    warnings.push('NATIVE_ALLOW_HTTP=1: this build may use plain http. Never submit it to a store.');
  }
  const api = parsed.VITE_API_URL;
  const socket = parsed.VITE_SOCKET_URL;
  if (api && socket && api.origin !== socket.origin) {
    warnings.push(`VITE_API_URL (${api.origin}) and VITE_SOCKET_URL (${socket.origin}) differ. That is fine only if the API and sockets really are on different hosts.`);
  }
  if (api && !parsed.VITE_PUBLIC_SITE_URL && !env.VITE_PUBLIC_SITE_URL) {
    warnings.push(`Shared links (invites, replays) will point at ${api.origin}. Set VITE_PUBLIC_SITE_URL if the website is on a different host from the API.`);
  }
  return { errors, warnings };
}

/**
 * The built index.html a native build must ship: the bare app shell. The web
 * build's last step (scripts/prerender-marketing.mjs) writes the landing
 * page's text into `#root` for search engines; in the app that text would
 * show at every launch until the game had loaded.
 *
 * @param {string} indexHtml
 * @returns {string[]} problems, empty when the shell is clean
 */
export function checkNativeDist(indexHtml) {
  const problems = [];
  if (/data-prerendered="true"/.test(indexHtml)) {
    problems.push('dist/index.html contains the prerendered landing page. Build with `pnpm run build:native`, not `pnpm run build`.');
  } else if (!indexHtml.includes('<div id="root"></div>')) {
    problems.push('dist/index.html has no empty <div id="root"></div>: it is not a clean app shell.');
  }
  return problems;
}
