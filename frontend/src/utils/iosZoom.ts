/**
 * Page zoom on iPhone and iPad.
 *
 * Safari on iOS zooms the page in when a text box whose text is under 16px
 * gains focus (the feedback note, the chat box, a faction picker: 14px is
 * 16/14 ≈ 1.14×), and leaves it zoomed after the keyboard closes. The page then
 * slides sideways under the player's thumb, its left edge is cut off, and its
 * bottom slides under Safari's toolbar, on every screen until they pinch back
 * out; in an app that never leaves its one document, that is the rest of the
 * session.
 *
 * `maximum-scale=1` in the viewport stops that zoom. Safari ignores it for the
 * player's own pinch since iOS 10, so zoom stays available to anyone who wants
 * it. Every other browser would honour it as a zoom lock, so only Apple's touch
 * devices get it.
 */

type NavigatorLike = Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>;

/** An iPhone, iPod or iPad, in Safari or any other iOS browser or web view. */
export function isAppleTouchDevice(nav: NavigatorLike = navigator): boolean {
  if (/iPad|iPhone|iPod/.test(nav.userAgent)) return true;
  // iPadOS asks for the desktop site by default and calls itself a Mac.
  return nav.platform === 'MacIntel' && nav.maxTouchPoints > 1;
}

/** Add `maximum-scale=1` to the viewport on iOS. Returns whether it changed anything. */
export function stopIosInputZoom(doc: Document = document, nav: NavigatorLike = navigator): boolean {
  if (!isAppleTouchDevice(nav)) return false;
  const meta = doc.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta || /maximum-scale/.test(meta.content)) return false;
  meta.content = `${meta.content}, maximum-scale=1`;
  return true;
}

/** How far the page is pinch-zoomed in; 1 when it is not. */
export function pageZoom(win: Window = window): number {
  return win.visualViewport?.scale ?? 1;
}
