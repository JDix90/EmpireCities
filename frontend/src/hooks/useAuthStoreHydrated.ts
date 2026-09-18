import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore';

/**
 * True once the persisted auth slice has been read from storage.
 * Without this, the first paint can look "logged out" and protected routes may redirect to
 * `/login` before rehydration completes — a common cause of "refresh kicked me out".
 *
 * `store.persist` can be absent: zustand omits the whole API when the persist
 * middleware has no usable storage backend. `safeLocalStorage` keeps that from
 * happening, but treat it as optional anyway — nothing will ever hydrate in
 * that state, so the honest answer is "hydrated", not a splash screen forever
 * and certainly not the `undefined.hasHydrated()` crash this once threw, which
 * blanked the app before first paint in a storage-denied iframe.
 */
export function useAuthStoreHydrated(): boolean {
  const persistApi = useAuthStore.persist as typeof useAuthStore.persist | undefined;
  const [hydrated, setHydrated] = useState(() => persistApi?.hasHydrated() ?? true);

  useEffect(() => {
    if (!persistApi || persistApi.hasHydrated()) {
      setHydrated(true);
      return;
    }
    const unsub = persistApi.onFinishHydration(() => setHydrated(true));
    return unsub;
  }, [persistApi]);

  return hydrated;
}
