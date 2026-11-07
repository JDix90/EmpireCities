/**
 * Central lazy-load entry points for the 3D globe stack (react-globe.gl + three.js).
 * Import this module from route shells only — never from landing/lobby pages.
 *
 * Chunks loaded on first call:
 *   - GlobeMap / GalaxyStrategicView / GalaxySplitView component code
 *   - globe-runtime, three-vendor, geo-vendor (via Vite manualChunks)
 *
 * Each goes through lazyWithChunkRetry: a tab opened before a deploy asks for
 * the previous build's globe chunk on entering a game, which the deploy
 * deleted, and it retries and then reloads onto the new build instead of
 * failing the map ("Failed to fetch dynamically imported module").
 */
import { lazyWithChunkRetry } from './lazyWithChunkRetry';

export const GlobeMapLazy = lazyWithChunkRetry(() => import('../components/game/GlobeMap'));
export const GalaxyStrategicViewLazy = lazyWithChunkRetry(() => import('../components/game/GalaxyStrategicView'));
export const GalaxySplitViewLazy = lazyWithChunkRetry(() => import('../components/game/GalaxySplitView'));
/**
 * The globe without its 2D fallback, for Split's globe panes: the view checks
 * WebGL once for all of them and falls back to its own flat panes.
 */
export const GlobeMapCoreLazy = lazyWithChunkRetry(() =>
  import('../components/game/GlobeMap').then((m) => ({ default: m.GlobeMapCore })),
);
export const GlobeMapEditorLazy = lazyWithChunkRetry(() => import('../components/editor/GlobeMapEditor'));

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

/**
 * Prefetch editor globe stack (map editor route only). A prefetch that fails
 * (a stale tab after a deploy) is dropped: the editor's own lazy load retries
 * and recovers, and an uncaught rejection here was a Sentry error by itself.
 */
export function preloadGlobeEditorChunk(): void {
  import('../components/editor/GlobeMapEditor').catch(() => {});
}
