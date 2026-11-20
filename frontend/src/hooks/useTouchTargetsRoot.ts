import { useEffect } from 'react';

/**
 * Marks the document with `data-touch-targets`, which turns on index.css's
 * `.tap-target` and `.tap-min` on touch screens. Small game controls carry
 * those classes; without the mark they are inert.
 */
export function useTouchTargetsRoot(): void {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.touchTargets = 'on';
    return () => {
      delete root.dataset.touchTargets;
    };
  }, []);
}
