import { useEffect } from 'react';

/**
 * Close an overlay on Escape. `enabled` lets confirmation dialogs that must
 * not be casually dismissed (resign confirms, destructive actions) opt out.
 */
export function useEscapeClose(onClose: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, enabled]);
}
