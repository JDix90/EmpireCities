import { lazy, type ComponentType } from 'react';

/**
 * Drop-in replacement for `React.lazy` that recovers from `ChunkLoadError`.
 *
 * When the server ships a new build (new hashed chunk filenames) and a user's
 * existing tab tries to route to a page whose chunk has been deleted, React's
 * default behavior is to surface the failure to the nearest error boundary
 * with a blank or "Something went wrong" message — terrible UX for a launch
 * where deploys are frequent.
 *
 * The wrapper retries the dynamic import once after a short delay (covers
 * transient network blips) and, if the second attempt still fails with the
 * webpack/vite `ChunkLoadError` signature, force-reloads the page so the user
 * picks up the new asset manifest. We use a session-scoped guard so we never
 * reload more than once in a row — that prevents an infinite loop on a truly
 * broken deploy.
 */
const RELOADED_KEY = 'ec_chunk_reloaded';

function isChunkLoadError(err: unknown): boolean {
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

export function lazyWithChunkRetry<T extends ComponentType<unknown>>(
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
        try {
          if (typeof window !== 'undefined' && !sessionStorage.getItem(RELOADED_KEY)) {
            sessionStorage.setItem(RELOADED_KEY, '1');
            window.location.reload();
            return new Promise(() => {}) as Promise<{ default: T }>;
          }
        } catch {
          /* sessionStorage may be unavailable (privacy mode); fall through */
        }
        throw err2;
      }
    }
  });
}
