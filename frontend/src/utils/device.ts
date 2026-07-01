/** Touch-first devices (phones, tablets). */
export function isCoarsePointer(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

export function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 768px)').matches;
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
