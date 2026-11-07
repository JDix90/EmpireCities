import { lazy, type ComponentType } from 'react';

/**
 * Drop-in replacement for `React.lazy` that recovers from `ChunkLoadError`.
 *
 * When the server ships a new build (new hashed chunk filenames) and a user's
 * existing tab tries to load a chunk the deploy deleted, React's default
 * behavior is to surface the failure to the nearest error boundary with a
 * blank or "Something went wrong" message — terrible UX for a game that
 * deploys often. In Sentry it reads "Failed to fetch dynamically imported
 * module", and it lands on deploy days.
 *
 * The wrapper retries the dynamic import once after a short delay (covers
 * transient network blips) and, if the second attempt still fails with the
 * webpack/vite `ChunkLoadError` signature, reloads the page so the user picks
 * up the new asset manifest (`reloadForNewBuild`).
 *
 * Every lazily loaded component goes through it: the routes (App.tsx), the
 * globe stack (globeLoader.ts) and the chat's emoji picker.
 */
const RELOADED_KEY = 'ec_chunk_reloaded';

/**
 * No second reload within this long of the last one. A deploy that is itself
 * broken would otherwise reload forever; a tab left open across two deploys
 * still recovers from the second. (The guard used to be once per session,
 * which left that tab stuck.)
 */
export const CHUNK_RELOAD_COOLDOWN_MS = 60_000;

export function isChunkLoadError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name;
  const message = (err as { message?: string }).message ?? '';
  return (
    name === 'ChunkLoadError' ||
    /Loading chunk [\w-]+ failed/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message)
  );
}

/**
 * Reload the page onto the current build, unless this tab already did so in
 * the last minute. True when the reload was started. Also used for Vite's
 * `vite:preloadError` (main.tsx).
 */
export function reloadForNewBuild(now: number = Date.now()): boolean {
  try {
    if (typeof window === 'undefined') return false;
    // A value from before the cooldown ('1') reads as long ago, so it allows one.
    const last = Number(sessionStorage.getItem(RELOADED_KEY));
    if (last > 0 && now - last < CHUNK_RELOAD_COOLDOWN_MS) return false;
    sessionStorage.setItem(RELOADED_KEY, String(now));
  } catch {
    /* sessionStorage may be unavailable (privacy mode): no reload without a guard */
    return false;
  }
  window.location.reload();
  return true;
}

// The same constraint as React.lazy's own, so components that take props (the
// globe) fit as well as the routes, which take none.
export function lazyWithChunkRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): ReturnType<typeof lazy<T>> {
  return lazy(async () => {
    try {
      return await factory();
    } catch (err1) {
      if (!isChunkLoadError(err1)) throw err1;
      await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        return await factory();
      } catch (err2) {
        if (!isChunkLoadError(err2)) throw err2;
        if (reloadForNewBuild()) return new Promise(() => {}) as Promise<{ default: T }>;
        throw err2;
      }
    }
  });
}
