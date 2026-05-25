import { useRef, useCallback, type CSSProperties, type TouchEvent as ReactTouchEvent } from 'react';

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
 *
 * Note on `touch-action`:
 *   React 18 attaches touch listeners as *passive* by default, so calling
 *   `e.preventDefault()` inside onTouchMove is a no-op (and logs a warning).
 *   We disable native scrolling on the drag handle via CSS `touch-action: none`
 *   instead. This is the modern, lint-clean fix — `touch-action: pan-y`
 *   alone wasn't enough because the user dragging the sheet down still
 *   scrolled the underlying page in iOS Safari.
 */
export function useSwipeToDismiss({ onDismiss, threshold = 80 }: SwipeToDismissOptions) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const currentY = useRef(0);
  const tracking = useRef(false);

  const onTouchStart = useCallback((e: ReactTouchEvent) => {
    startY.current = e.touches[0].clientY;
    currentY.current = startY.current;
    tracking.current = true;
    if (sheetRef.current) sheetRef.current.style.transition = 'none';
  }, []);

  const onTouchMove = useCallback((e: ReactTouchEvent) => {
    if (!tracking.current) return;
    currentY.current = e.touches[0].clientY;
    const dy = Math.max(0, currentY.current - startY.current);
    if (sheetRef.current) sheetRef.current.style.transform = `translateY(${dy}px)`;
  }, []);

  const onTouchEnd = useCallback(() => {
    tracking.current = false;
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

  // If the user's finger leaves the handle (scrolled off, multi-touch
  // interrupted) reset state so the sheet snaps back instead of getting
  // stuck halfway down.
  const onTouchCancel = useCallback(() => {
    tracking.current = false;
    if (sheetRef.current) {
      sheetRef.current.style.transition = 'transform 0.2s ease-out';
      sheetRef.current.style.transform = 'translateY(0)';
    }
  }, []);

  const handleStyle: CSSProperties = {
    touchAction: 'none',
    // Reinforce against text-selection on long drag, which on Android picks
    // a word and shows the selection handle on top of our sheet.
    WebkitUserSelect: 'none',
    userSelect: 'none',
  };

  const handleProps = {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
    style: handleStyle,
  };

  return { sheetRef, handleProps };
}
