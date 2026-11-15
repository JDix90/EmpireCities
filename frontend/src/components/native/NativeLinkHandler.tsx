import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { isNativeApp, nativeLinkAction, openExternal } from '../../utils/nativeApp';

/** The origin the app is served from. `capacitor://localhost` has no `location.origin` worth trusting. */
function appOrigin(): string {
  return `${window.location.protocol}//${window.location.host}`;
}

/**
 * In the native app, decides where a tapped link goes (utils/nativeApp.ts
 * `nativeLinkAction`): another site opens in the in-app browser sheet, and one
 * of our own pages that asked for a new tab opens in place, since the app has
 * no tabs. One listener on the document covers every `<a>` there is or will
 * be, so no link has to remember to ask.
 *
 * Renders nothing, and does nothing at all on the website.
 */
export default function NativeLinkHandler() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!isNativeApp()) return;
    const onClick = (event: MouseEvent) => {
      // Not ours to redirect: already handled, or not a plain tap.
      if (event.defaultPrevented || event.button !== 0) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.hasAttribute('download')) return;
      const action = nativeLinkAction(anchor.getAttribute('href') ?? '', anchor.getAttribute('target'), appOrigin());
      if (action.kind === 'default') return;
      event.preventDefault();
      if (action.kind === 'external') void openExternal(action.url);
      else navigate(action.path);
    };
    // Bubble phase, so a link's own onClick (closing a menu, say) runs first.
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [navigate]);
  return null;
}
