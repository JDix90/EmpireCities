import { useEffect } from 'react';
import { isAppleTouchDevice, pageZoom } from '../utils/iosZoom';

/**
 * On a full-screen board (game, replay, spectator), a pinch that starts on
 * the top bar, a panel or the bottom bar rather than the map zoomed the whole
 * page in Safari on iOS: only the map's canvas takes pinches for itself. The
 * page then slid sideways and its bottom bar went under Safari's toolbar.
 *
 * This stops Safari's page pinch while the page is at its normal size. A page
 * already zoomed in (from another screen, or before this shipped) can still be
 * pinched back out, and stops at its normal size, so nobody is left stuck
 * zoomed in. The map's own pinch-to-zoom is touch events on its canvas, which
 * Safari's gesture events do not affect.
 */
export function usePagePinchLock(enabled = true): void {
  useEffect(() => {
    if (!enabled || !isAppleTouchDevice()) return;
    const stop = (e: Event) => {
      if (pageZoom() <= 1.01) e.preventDefault();
    };
    // WebKit-only events: Safari's own pinch of the page.
    document.addEventListener('gesturestart', stop, { passive: false });
    document.addEventListener('gesturechange', stop, { passive: false });
    return () => {
      document.removeEventListener('gesturestart', stop);
      document.removeEventListener('gesturechange', stop);
    };
  }, [enabled]);
}
