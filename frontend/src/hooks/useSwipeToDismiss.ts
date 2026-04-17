import { useRef, useCallback, type TouchEvent as ReactTouchEvent } from 'react';

interface SwipeToDismissOptions {
  onDismiss: () => void;
  /** Minimum downward distance in px to trigger dismiss. Default 80. */
  threshold?: number;
}

/**
 * Provides touch handlers + a ref for a bottom-sheet element so that
 * swiping down on the drag-handle area dismisses it.
 *
 * Usage:
 *   const { sheetRef, handleProps } = useSwipeToDismiss({ onDismiss: onClose });
 *   <div ref={sheetRef} ...>
 *     <div {...handleProps}>{drag handle}</div>
 *   </div>
 */
export function useSwipeToDismiss({ onDismiss, threshold = 80 }: SwipeToDismissOptions) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const currentY = useRef(0);

  const onTouchStart = useCallback((e: ReactTouchEvent) => {
    startY.current = e.touches[0].clientY;
    currentY.current = startY.current;
    if (sheetRef.current) sheetRef.current.style.transition = 'none';
  }, []);

  const onTouchMove = useCallback((e: ReactTouchEvent) => {
    currentY.current = e.touches[0].clientY;
    const dy = Math.max(0, currentY.current - startY.current);
    if (sheetRef.current) sheetRef.current.style.transform = `translateY(${dy}px)`;
  }, []);

  const onTouchEnd = useCallback(() => {
    const dy = currentY.current - startY.current;
    if (sheetRef.current) {
      sheetRef.current.style.transition = 'transform 0.2s ease-out';
      if (dy >= threshold) {
        sheetRef.current.style.transform = 'translateY(100%)';
        setTimeout(onDismiss, 200);
      } else {
        sheetRef.current.style.transform = 'translateY(0)';
      }
    }
  }, [onDismiss, threshold]);

  const handleProps = {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  };

  return { sheetRef, handleProps };
}
