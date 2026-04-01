/** Touch-first devices (phones, tablets). */
export function isCoarsePointer(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

export function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 768px)').matches;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
