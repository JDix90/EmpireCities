import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';

export function useKeyboardVisible() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      let showHandle: { remove: () => void } | null = null;
      let hideHandle: { remove: () => void } | null = null;
      let cancelled = false;

      import('@capacitor/keyboard').then(({ Keyboard }) => {
        if (cancelled) return;
        Keyboard.addListener('keyboardWillShow', () => setVisible(true)).then((h) => { showHandle = h; });
        Keyboard.addListener('keyboardWillHide', () => setVisible(false)).then((h) => { hideHandle = h; });
      });
      return () => {
        cancelled = true;
        showHandle?.remove();
        hideHandle?.remove();
      };
    } else {
      // Web fallback: detect virtual keyboard via visualViewport
      const vv = window.visualViewport;
      if (!vv) return;
      const check = () => {
        setVisible(vv.height < window.innerHeight * 0.75);
      };
      vv.addEventListener('resize', check);
      return () => vv.removeEventListener('resize', check);
    }
  }, []);

  return visible;
}
