import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { isNativeApp } from '../../utils/nativeApp';
import { resolveAppLink } from '../../utils/appLinks';
import { publicSiteOrigin } from '../../utils/publicOrigin';

/**
 * In the native app, follows a link that opened the app (utils/appLinks.ts):
 * an emailed sign-in link, an invite, a shared replay. iOS hands the app the
 * whole URL; this goes to the matching route inside the app.
 *
 * Two ways a link arrives: the app was already running (`appUrlOpen`), or the
 * link started it (`getLaunchUrl`). On a cold start both can report the same
 * URL, and a sign-in link is good once, so a URL is followed once.
 *
 * Renders nothing, and does nothing at all on the website.
 */
export default function AppLinkHandler() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!isNativeApp()) return;
    let cancelled = false;
    let lastUrl: string | null = null;
    let remove: (() => void) | undefined;

    const follow = (url: string | undefined | null) => {
      if (cancelled || !url || url === lastUrl) return;
      lastUrl = url;
      const path = resolveAppLink(url, publicSiteOrigin());
      if (path) navigate(path);
    };

    void import('@capacitor/app')
      .then(async ({ App }) => {
        const handle = await App.addListener('appUrlOpen', (event) => follow(event?.url));
        if (cancelled) {
          void handle.remove();
          return;
        }
        remove = () => void handle.remove();
        const launch = await App.getLaunchUrl();
        follow(launch?.url);
      })
      .catch(() => {
        /* no App plugin in this build: links simply open nothing */
      });

    return () => {
      cancelled = true;
      remove?.();
    };
  }, [navigate]);
  return null;
}
