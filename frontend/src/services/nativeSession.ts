import { Capacitor } from '@capacitor/core';

/**
 * Where the native app keeps its session (backend modules/auth/nativeSession.ts).
 *
 * The website's session is an httpOnly cookie the page never sees. The app's
 * web view does not send that cookie back, so the server gives the app its
 * refresh token in the response body instead, and the app keeps it here: in
 * the iOS Keychain (Android Keystore), never in localStorage.
 *
 * Two things follow from the Keychain that the cookie never had:
 *  - It outlives the web view's own storage. After a reinstall the web view
 *    remembers nobody, but the token is still here, and the app signs the
 *    player back in with it (authStore `recoverNativeSession`). For a guest
 *    that is the only way back to their account.
 *  - It is kept on this device only (`afterFirstUnlockThisDeviceOnly`): not in
 *    iCloud Keychain, and not restored onto a different device from a backup.
 *
 * Nothing here runs on the website: every function is a no-op there.
 */

const KEY = 'bf-refresh-token';

/** What the Keychain last held, so one failed read does not look like a signed-out player. */
let cached: string | null | undefined;

/** Inside the Capacitor shell, where the session is a keychain token and not a cookie. */
export function usesNativeSession(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

async function storage() {
  // On iOS the plugin's JavaScript hands every call to its native half. With
  // the native half missing from a build (a `cap sync` that was skipped), that
  // hand-off calls itself forever and the app freezes at launch, before any
  // timer can fire. So the native half is looked for first.
  if (!nativeKeychainAvailable()) throw new Error('SecureStorage native plugin is not in this build');
  return import('@aparajita/capacitor-secure-storage');
}

/** Whether the build carries the Keychain plugin's native code (the bridge lists what it has). */
export function nativeKeychainAvailable(): boolean {
  try {
    const headers = (Capacitor as { PluginHeaders?: ReadonlyArray<{ name: string }> }).PluginHeaders;
    return Array.isArray(headers) && headers.some((h) => h?.name === 'SecureStorage');
  } catch {
    return false;
  }
}

/**
 * How long a Keychain call may take. The app's first screen waits on the read
 * at launch, so a native call that never answers must fail here, as a read
 * that could not be made, and not hold the app on a blank screen.
 */
const KEYCHAIN_TIMEOUT_MS = 3000;

function withTimeout<T>(work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('keychain timed out')), KEYCHAIN_TIMEOUT_MS);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/** What the Keychain holds: a token, nothing, or it could not be read just now. */
export type HeldToken = { status: 'held'; token: string } | { status: 'none' } | { status: 'unreadable' };

/**
 * The refresh token the app holds. Never throws. `unreadable` is not `none`:
 * a Keychain that cannot be read right now may well hold a token, and a
 * caller that took it for a signed-out player would go on to delete it.
 */
export async function readNativeRefreshToken(): Promise<HeldToken> {
  if (!usesNativeSession()) return { status: 'none' };
  if (cached === undefined) {
    try {
      const value = await withTimeout(storage().then(({ SecureStorage }) => SecureStorage.get(KEY, false, false)));
      cached = typeof value === 'string' && value ? value : null;
    } catch {
      return { status: 'unreadable' };
    }
  }
  return cached ? { status: 'held', token: cached } : { status: 'none' };
}

/** The token alone, or null when there is none or it cannot be read. */
export async function loadNativeRefreshToken(): Promise<string | null> {
  const held = await readNativeRefreshToken();
  return held.status === 'held' ? held.token : null;
}

/** Keep a new refresh token. Never throws; memory still holds it if the Keychain refuses. */
export async function saveNativeRefreshToken(token: string): Promise<void> {
  if (!usesNativeSession() || !token) return;
  cached = token;
  try {
    await withTimeout(storage().then(({ SecureStorage, KeychainAccess }) =>
      SecureStorage.set(KEY, token, false, false, KeychainAccess.afterFirstUnlockThisDeviceOnly)));
  } catch {
    /* kept in memory for this run; the next refresh will try to store its token */
  }
}

/** Forget the token: signed out, or the server said the session is over. Never throws. */
export async function clearNativeRefreshToken(): Promise<void> {
  if (!usesNativeSession()) return;
  cached = null;
  try {
    await withTimeout(storage().then(({ SecureStorage }) => SecureStorage.remove(KEY, false)));
  } catch {
    /* nothing more to do */
  }
}

/** Keep the refresh token a sign-in or refresh response carries in its body. */
export async function keepNativeSessionFrom(data: unknown): Promise<void> {
  const token = (data as { refreshToken?: unknown } | null | undefined)?.refreshToken;
  if (typeof token === 'string' && token) await saveNativeRefreshToken(token);
}

/**
 * Whether a failed refresh is the server ending the APP's session. The server
 * marks every refusal on the app's path `native: true`. A 401 without it means
 * the server did not treat the request as the app's at all (it is running
 * without NATIVE_APP_ORIGINS, so it looked for a cookie): the token is not
 * dead, the server is misconfigured, and throwing the token away would sign
 * out every player for good.
 */
export function isNativeSessionRefusal(status: number | undefined, data: unknown): boolean {
  return (status === 401 || status === 403) && (data as { native?: unknown } | null | undefined)?.native === true;
}

/** Test seam: forget what was cached. */
export function resetNativeSessionForTests(): void {
  cached = undefined;
}
