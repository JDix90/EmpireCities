/**
 * Sessions for the native app (iOS), which cannot use the refresh cookie.
 *
 * A browser keeps its session in an httpOnly cookie on /api/auth that the
 * page's JavaScript can never read. The app's page is served from inside the
 * app (`capacitor://localhost`) and calls this server across sites, and the
 * web view does not send that cookie back: the app was signed out every time
 * it was closed, and a guest lost their account.
 *
 * So for the app, and only for the app, the refresh token travels in the
 * request and response BODY, and the app keeps it in the device keychain
 * (frontend/src/services/nativeSession.ts).
 *
 * What keeps this from weakening the website:
 *
 *  - Which path a request takes is decided by its `Origin` header against
 *    NATIVE_APP_ORIGINS, and by nothing the client chooses. A browser sets
 *    `Origin` itself and no script can change it, so a page on the website,
 *    even one running injected script, cannot ask for a token in a body: it
 *    is always answered with the cookie, exactly as before. A client that is
 *    not a browser can send any `Origin` it likes, but it has no player's
 *    cookie to trade in.
 *  - NATIVE_APP_ORIGINS refuses http(s) origins (config/index.ts), so a
 *    mistake there cannot switch a website over to body tokens.
 *  - Every refresh token says which kind it is, inside its signature
 *    (`client: 'native'`). A token issued in a cookie is refused in a body and
 *    one issued in a body is refused in a cookie, so neither path can be used
 *    to launder a token from the other.
 */

/** The claim a native refresh token carries. A web token carries none. */
export const NATIVE_CLIENT = 'native' as const;

/** Whether this request comes from the native app: its browser-set Origin is one we name. */
export function isNativeAppOrigin(origin: unknown, nativeAppOrigins: readonly string[]): boolean {
  return typeof origin === 'string' && origin.length > 0 && nativeAppOrigins.includes(origin);
}

/**
 * The refresh token the app sent in its request body, or undefined. Bounded:
 * a signed token is a few hundred characters, and nothing longer is one.
 */
export function refreshTokenFromBody(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const token = (body as { refreshToken?: unknown }).refreshToken;
  return typeof token === 'string' && token.length > 0 && token.length <= 2048 ? token : undefined;
}
