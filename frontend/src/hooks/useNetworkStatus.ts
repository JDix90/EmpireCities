import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      Network.getStatus().then((s) => setIsOnline(s.connected));
      const handle = Network.addListener('networkStatusChange', (s) => {
        setIsOnline(s.connected);
      });
      return () => { handle.then((h) => h.remove()); };
    } else {
      const update = () => setIsOnline(navigator.onLine);
      update();
      window.addEventListener('online', update);
      window.addEventListener('offline', update);
      return () => {
        window.removeEventListener('online', update);
        window.removeEventListener('offline', update);
      };
    }
  }, []);

  return isOnline;
}
