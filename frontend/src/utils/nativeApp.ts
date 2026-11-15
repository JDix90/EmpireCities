import { Capacitor } from '@capacitor/core';

/**
 * The native app: the same bundle inside the Capacitor shell (iOS, Android).
 *
 * Everything here is about the app being an app and not the website in a
 * frame: it opens on play rather than the landing page, it has no pages that
 * exist for search engines, and a link to another site opens in a sheet over
 * the game instead of replacing it. Presentation only, like
 * utils/embedContext.ts: the server decides what any request may do.
 *
 * Every helper is a no-op in a browser, so the website does not change.
 */

/** Inside the Capacitor shell. False in every browser, a Home Screen web app included. */
export function isNativeApp(): boolean {
  // A detection helper that throws would take routing down with it.
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * Where a guest's account lives, for copy that says so: "this browser" on the
 * website, "this device" in the app, where the player never saw a browser.
 */
export function thisBrowserOrDevice(): 'this browser' | 'this device' {
  return isNativeApp() ? 'this device' : 'this browser';
}

/** The same with its preposition: saved "in this browser", saved "on this device". */
export function inThisBrowserOrOnThisDevice(): 'in this browser' | 'on this device' {
  return isNativeApp() ? 'on this device' : 'in this browser';
}

/** What a click on a link should do inside the native app. */
export type NativeLinkAction =
  /** Leave it to the router or the web view: an in-app link, `mailto:`, `tel:`, a download. */
  | { kind: 'default' }
  /** One of our own pages that asked for a new tab. The app has no tabs: go there in place. */
  | { kind: 'in_app'; path: string }
  /** Another site: open it in the in-app browser sheet. */
  | { kind: 'external'; url: string };

/**
 * Sort a link by where it leads. `appOrigin` is the origin the app itself is
 * served from (`capacitor://localhost` on iOS), which is what makes a link
 * "ours". Anything that cannot be parsed is left alone.
 */
export function nativeLinkAction(href: string, target: string | null, appOrigin: string): NativeLinkAction {
  let url: URL;
  try {
    url = new URL(href, appOrigin);
  } catch {
    return { kind: 'default' };
  }
  // `capacitor:` is not a scheme URL gives an origin to, so compare the pieces.
  const sameOrigin = `${url.protocol}//${url.host}` === appOrigin;
  if (sameOrigin) {
    return target === '_blank'
      ? { kind: 'in_app', path: `${url.pathname}${url.search}${url.hash}` }
      : { kind: 'default' };
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return { kind: 'external', url: url.toString() };
  }
  return { kind: 'default' };
}

/**
 * Open another site. In the app it comes up as a sheet over the game
 * (SFSafariViewController on iOS), and closing it lands back where the player
 * was; left to itself the web view hands the link to Safari and the player
 * leaves the app. On the website this is the new tab it always was.
 *
 * Only http(s): this is for pages, and never a way to run a `javascript:` URL.
 */
export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return;
  if (isNativeApp()) {
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url });
      return;
    } catch {
      /* the plugin is missing from this build: fall through to the web view's own handling */
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
