import { useEffect } from 'react';
import { useTouchTargetsEnabled } from '../store/featureFlagsStore';

/**
 * `touch_targets_enabled`: marks the document with `data-touch-targets`, which
 * turns on index.css's `.tap-target` and `.tap-min` on touch screens. Small
 * game controls carry those classes either way; without the mark they are inert.
 */
export function useTouchTargetsRoot(): void {
  const enabled = useTouchTargetsEnabled();
  useEffect(() => {
    const root = document.documentElement;
    if (!enabled) return;
    root.dataset.touchTargets = 'on';
    return () => {
      delete root.dataset.touchTargets;
    };
  }, [enabled]);
}
