/**
 * Links that open the native app instead of Safari (iOS universal links).
 *
 * Three things have to agree on which links those are, and this is the one
 * list they are checked against (utils/appLinks.test.ts):
 *
 *  - `public/.well-known/apple-app-site-association`, which the website serves
 *    and iOS reads to learn which of the site's paths belong to the app;
 *  - the Associated Domains entitlement (ios/App/App/App.entitlements), which
 *    names the site;
 *  - `resolveAppLink` below, which turns the link iOS hands the app into a
 *    route inside it.
 *
 * Only pages that are for a signed-in player's own use are here. The
 * marketing pages stay in Safari, where they belong.
 */
export const APP_LINK_PATHS: ReadonlyArray<{ path: string; prefix: boolean }> = [
  { path: '/sign-in-link', prefix: false },
  { path: '/reset-password', prefix: false },
  { path: '/join/', prefix: true },
  { path: '/replay/', prefix: true },
  { path: '/game/', prefix: true },
];

/** The same list as the association file writes it: `/join/*` for a prefix. */
export function appLinkPatterns(): string[] {
  return APP_LINK_PATHS.map((p) => (p.prefix ? `${p.path}*` : p.path));
}

function isAppLinkPath(pathname: string): boolean {
  return APP_LINK_PATHS.some((p) =>
    p.prefix ? pathname.startsWith(p.path) && pathname.length > p.path.length : pathname === p.path);
}

/**
 * The route inside the app for a link iOS opened it with, or null to ignore
 * the link. A link is followed only when it is https, on the website's own
 * origin, and one of the paths above: what arrives here comes from outside the
 * app (an email, a message, another app), so nothing else is trusted to move
 * the player around.
 */
export function resolveAppLink(rawUrl: string, siteOrigin: string): string | null {
  let url: URL;
  let site: URL;
  try {
    url = new URL(rawUrl);
    site = new URL(siteOrigin);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.origin !== site.origin) return null;
  if (!isAppLinkPath(url.pathname)) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
