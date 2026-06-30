import { useEffect, useRef, useState } from 'react';

/** True while the document is visible (foreground tab, screen on). */
export function isDocumentVisible(): boolean {
  if (typeof document === 'undefined') return true;
  return document.visibilityState !== 'hidden';
}

/**
 * Track page visibility via the Page Visibility API.
 *
 * Backgrounded tabs and locked screens otherwise keep WebGL/Canvas render loops
 * running at full speed — a major source of mobile battery drain and overheating.
 * Components use this to pause their renderers (e.g. globe `pauseAnimation()`,
 * PixiJS ticker `.stop()`) while hidden and resume when the page returns.
 */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(isDocumentVisible);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = () => setVisible(isDocumentVisible());
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  return visible;
}

/**
 * Imperative variant: invokes `onChange(visible)` on every visibility
 * transition without triggering a React re-render. Suited to render-loop control
 * where re-rendering the host component on every tab switch is undesirable.
 */
export function usePageVisibilityEffect(onChange: (visible: boolean) => void): void {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handler = () => cbRef.current(isDocumentVisible());
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);
}
