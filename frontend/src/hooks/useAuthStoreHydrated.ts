import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore';

/**
 * True once the persisted auth slice has been read from storage.
 * Without this, the first paint can look "logged out" and protected routes may redirect to
 * `/login` before rehydration completes — a common cause of "refresh kicked me out".
 */
export function useAuthStoreHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => useAuthStore.persist.hasHydrated());

  useEffect(() => {
    if (useAuthStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    const unsub = useAuthStore.persist.onFinishHydration(() => setHydrated(true));
    return unsub;
  }, []);

  return hydrated;
}
