/** Touch-first devices (phones, tablets). */
export function isCoarsePointer(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

export function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 768px)').matches;
}

/**
 * A viewport too SHORT for a full-height overlay, whatever its width.
 *
 * Every other breakpoint in this file is width-only, which silently assumes
 * that "wide" implies "tall". Two common cases break that assumption:
 *
 *   - A game portal (itch.io, CrazyGames) frames the app in a fixed box that
 *     is desktop-wide but phone-short — 1280x720 and 960x600 are typical.
 *   - A laptop whose browser is not maximised, or a 1440x900 panel once
 *     browser chrome is subtracted (~800px of viewport).
 *
 * Both land on the desktop layout and get overlays sized for a tall window.
 * 820px is chosen to sit above a 1440x900 laptop's usable height and below a
 * 1080p desktop's, so it catches the cramped cases without touching the
 * roomy ones.
 */
export function isShortViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-height: 820px)').matches;
}

export function isLandscapeMobile(): boolean {
  if (typeof window === 'undefined') return false;
  return isMobileViewport() && window.innerWidth > window.innerHeight;
}

/**
 * Whether the game should use its MOBILE layout. Unlike the width-only
 * `isMobileViewport()`, this stays true for a phone rotated to landscape (which
 * exceeds 768px wide but stays short): a coarse-pointer device whose *shorter*
 * side is phone-sized. Tablets (short side ≥ ~540px) and desktops keep the
 * desktop layout. Used for GamePage's layout split so rotating a phone doesn't
 * drop the mobile chrome.
 */
export function isPhoneLayout(): boolean {
  if (typeof window === 'undefined') return false;
  if (isMobileViewport()) return true;
  return isCoarsePointer() && Math.min(window.innerWidth, window.innerHeight) <= 540;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
