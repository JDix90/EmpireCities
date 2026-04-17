import { useEffect, useState } from 'react';
import { isMobileViewport } from '../utils/device';

export function useIsLandscape() {
  const [isLandscape, setIsLandscape] = useState(false);

  useEffect(() => {
    const check = () => {
      setIsLandscape(isMobileViewport() && window.innerWidth > window.innerHeight);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  return isLandscape;
}
