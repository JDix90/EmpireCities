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
 *
 * Once a reload onto the new build has started, a load that fails or comes
 * back empty waits for the reload instead of throwing. The page keeps running
 * until the browser navigates, and in that window Vite resolves an import
 * whose `vite:preloadError` was cancelled (main.tsx cancels it as it reloads)
 * to `undefined`: React then read `.default` off nothing, which Sentry
 * reported as "undefined is not an object (evaluating 'e._result.default')"
 * on Safari, and the error screen could flash before the new build loaded.
 */
const RELOADED_KEY = 'ec_chunk_reloaded';

/** A reload onto the new build has been started in this page. */
let reloadStarted = false;

/** True once this page has started reloading onto the new build (it has not navigated yet). */
export function reloadingForNewBuild(): boolean {
  return reloadStarted;
}

/** Tests only: forget a reload started by an earlier test. */
export function resetChunkReloadStateForTests(): void {
  reloadStarted = false;
}

/** Never settles: the reload under way replaces the page. */
const waitForReload = <T,>(): Promise<T> => new Promise<T>(() => {});

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
  reloadStarted = true;
  window.location.reload();
  return true;
}

// The same constraint as React.lazy's own, so components that take props (the
// globe) fit as well as the routes, which take none.
export function lazyWithChunkRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): ReturnType<typeof lazy<T>> {
  return lazy(async () => {
    let mod: { default: T } | undefined;
    try {
      mod = await factory();
    } catch (err1) {
      // The page is already on its way to the new build: whatever failed
      // (a missing chunk, or a named-export factory reading an empty module)
      // will load there.
      if (reloadingForNewBuild()) return waitForReload<{ default: T }>();
      if (!isChunkLoadError(err1)) throw err1;
      await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        mod = await factory();
      } catch (err2) {
        if (reloadingForNewBuild()) return waitForReload<{ default: T }>();
        if (!isChunkLoadError(err2)) throw err2;
        if (reloadForNewBuild()) return waitForReload<{ default: T }>();
        throw err2;
      }
    }
    // Vite's answer to a cancelled vite:preloadError: an empty module. Only
    // while reloading; anywhere else an empty module is a real bug and React
    // reports it as before.
    if (mod == null && reloadingForNewBuild()) return waitForReload<{ default: T }>();
    return mod as { default: T };
  });
}
