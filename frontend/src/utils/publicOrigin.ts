import { Capacitor } from '@capacitor/core';

/**
 * The website's origin, for a link that leaves the game: an invite, a shared
 * replay, a referral link, a map's page.
 *
 * On the website that is simply where the page is. In the native app the page
 * is served from inside the app (`capacitor://localhost` on iOS), and a link
 * built from that opens nothing for the friend it is sent to. There the
 * origin is the public site the app was built against: `VITE_PUBLIC_SITE_URL`
 * when set, else the origin of `VITE_API_URL`, which a native build must set
 * and which is the same host as the site unless the API is deployed apart.
 */
export function resolvePublicSiteOrigin(input: {
  native: boolean;
  pageOrigin: string;
  publicSiteUrl?: string;
  apiUrl?: string;
}): string {
  if (!input.native) return input.pageOrigin;
  for (const candidate of [input.publicSiteUrl, input.apiUrl]) {
    const text = candidate?.trim();
    if (!text) continue;
    try {
      const url = new URL(text);
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.origin;
    } catch {
      /* not an absolute URL: try the next */
    }
  }
  // A native build with neither is misconfigured (scripts/check-native-env.mjs
  // refuses to make one); the page origin is all that is left.
  return input.pageOrigin;
}

export function publicSiteOrigin(): string {
  let native = false;
  try {
    native = Capacitor.isNativePlatform();
  } catch {
    /* not in the shell */
  }
  return resolvePublicSiteOrigin({
    native,
    pageOrigin: typeof window === 'undefined' ? '' : window.location.origin,
    publicSiteUrl: import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined,
    apiUrl: import.meta.env.VITE_API_URL as string | undefined,
  });
}
