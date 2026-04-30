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

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const GLOBE_SPIN_KEY = 'cc-globe-spin';

export function getGlobeSpinPreference(): boolean {
  if (typeof window === 'undefined') return false;
  // Always off when the OS has requested reduced motion.
  if (prefersReducedMotion()) return false;
  // Also default to off on mobile to conserve battery and avoid disorientation.
  if (isMobileViewport() || isCoarsePointer()) {
    return localStorage.getItem(GLOBE_SPIN_KEY) === 'true';
  }
  return localStorage.getItem(GLOBE_SPIN_KEY) !== 'false';
}

export function persistGlobeSpinPreference(enabled: boolean): void {
  try {
    localStorage.setItem(GLOBE_SPIN_KEY, String(enabled));
  } catch { /* ignore */ }
}

const LITE_MODE_KEY = 'cc-lite-mode';

/** Lite mode: disables heavy animations/globe for low-end devices. */
export function isLiteMode(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(LITE_MODE_KEY) === 'true';
}

export function persistLiteMode(enabled: boolean): void {
  try {
    localStorage.setItem(LITE_MODE_KEY, String(enabled));
  } catch { /* ignore */ }
}

const MAP_VIEW_KEY = 'cc-preferred-map-view';

export function getInitialMapView(): '2d' | 'globe' {
  if (typeof window === 'undefined') return 'globe';
  const saved = localStorage.getItem(MAP_VIEW_KEY);
  if (saved === '2d' || saved === 'globe') return saved;
  if (isMobileViewport() || isCoarsePointer()) return '2d';
  return 'globe';
}

export function persistMapView(mode: '2d' | 'globe'): void {
  try {
    localStorage.setItem(MAP_VIEW_KEY, mode);
  } catch {
    /* ignore */
  }
}
