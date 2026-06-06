/**
 * Central lazy-load entry points for the 3D globe stack (react-globe.gl + three.js).
 * Import this module from route shells only — never from landing/lobby pages.
 *
 * Chunks loaded on first call:
 *   - GlobeMap / GalaxyStrategicView component code
 *   - globe-runtime, three-vendor, geo-vendor (via Vite manualChunks)
 */
import { lazy } from 'react';

export const GlobeMapLazy = lazy(() => import('../components/game/GlobeMap'));
export const GalaxyStrategicViewLazy = lazy(() => import('../components/game/GalaxyStrategicView'));
export const GlobeMapEditorLazy = lazy(() => import('../components/editor/GlobeMapEditor'));

let preloadPromise: Promise<unknown> | null = null;

/** Fire-and-forget prefetch — safe to call on globe toggle hover/focus. */
export function preloadGlobeChunks(): void {
  if (preloadPromise) return;
  preloadPromise = Promise.all([
    import('../components/game/GlobeMap'),
    import('../components/game/GalaxyStrategicView'),
  ]).catch(() => {
    preloadPromise = null;
  });
}

/** Prefetch editor globe stack (map editor route only). */
export function preloadGlobeEditorChunk(): void {
  void import('../components/editor/GlobeMapEditor');
}
