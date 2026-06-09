import {
  useRef,
  useCallback,
  type CSSProperties,
  type TouchEvent as ReactTouchEvent,
} from 'react';

export type SheetSnap = 'peek' | 'half' | 'full';

const SNAP_ORDER: SheetSnap[] = ['peek', 'half', 'full'];

export function getNextSnap(current: SheetSnap): SheetSnap {
  const idx = SNAP_ORDER.indexOf(current);
  return idx < SNAP_ORDER.length - 1 ? SNAP_ORDER[idx + 1]! : current;
}

export function getPrevSnap(current: SheetSnap): SheetSnap {
  const idx = SNAP_ORDER.indexOf(current);
  return idx > 0 ? SNAP_ORDER[idx - 1]! : current;
}

/** Resolve snap (or dismiss) from a downward-positive drag delta on release. */
export function resolveSnapFromDrag(
  startSnap: SheetSnap,
  deltaY: number,
  options?: { dismissThreshold?: number; snapThreshold?: number },
): SheetSnap | 'dismiss' {
  const dismissThreshold = options?.dismissThreshold ?? 80;
  const snapThreshold = options?.snapThreshold ?? 50;

  if (deltaY >= dismissThreshold && startSnap === 'peek') {
    return 'dismiss';
  }
  if (deltaY >= snapThreshold) {
    if (startSnap === 'full') return 'half';
    if (startSnap === 'half') return 'peek';
    return 'dismiss';
  }
  if (deltaY <= -snapThreshold) {
    return getNextSnap(startSnap);
  }
  return startSnap;
}

interface UseBottomSheetSnapOptions {
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  onDismiss: () => void;
  dismissThreshold?: number;
  snapThreshold?: number;
}

export function useBottomSheetSnap({
  snap,
  onSnapChange,
  onDismiss,
  dismissThreshold = 80,
  snapThreshold = 50,
}: UseBottomSheetSnapOptions) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const currentY = useRef(0);
  const tracking = useRef(false);
  const startSnap = useRef<SheetSnap>(snap);

  const onTouchStart = useCallback((e: ReactTouchEvent) => {
    startY.current = e.touches[0].clientY;
    currentY.current = startY.current;
    tracking.current = true;
    startSnap.current = snap;
    if (sheetRef.current) sheetRef.current.style.transition = 'none';
  }, [snap]);

  const onTouchMove = useCallback((e: ReactTouchEvent) => {
    if (!tracking.current) return;
    currentY.current = e.touches[0].clientY;
    const dy = currentY.current - startY.current;
    if (sheetRef.current) {
      sheetRef.current.style.transform = dy > 0 ? `translateY(${dy}px)` : `translateY(${dy * 0.35}px)`;
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    tracking.current = false;
    const dy = currentY.current - startY.current;
    const resolved = resolveSnapFromDrag(startSnap.current, dy, { dismissThreshold, snapThreshold });

    if (sheetRef.current) {
      sheetRef.current.style.transition = 'transform 0.2s ease-out';
      sheetRef.current.style.transform = 'translateY(0)';
    }

    if (resolved === 'dismiss') {
      if (sheetRef.current) {
        sheetRef.current.style.transform = 'translateY(100%)';
      }
      setTimeout(onDismiss, 200);
      return;
    }
    if (resolved !== startSnap.current) {
      onSnapChange(resolved);
    }
  }, [onDismiss, onSnapChange, dismissThreshold, snapThreshold]);

  const onTouchCancel = useCallback(() => {
    tracking.current = false;
    if (sheetRef.current) {
      sheetRef.current.style.transition = 'transform 0.2s ease-out';
      sheetRef.current.style.transform = 'translateY(0)';
    }
  }, []);

  const expandSnap = useCallback(() => {
    onSnapChange(getNextSnap(snap));
  }, [onSnapChange, snap]);

  const handleStyle: CSSProperties = {
    touchAction: 'none',
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

  const snapClassName = `mobile-sheet-${snap}`;

  return { sheetRef, handleProps, expandSnap, snapClassName };
}
