import { useRef, useCallback, useState } from 'react';
import { isMobileViewport } from '../utils/device';

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void> | void;
  threshold?: number;
}

export function usePullToRefresh({ onRefresh, threshold = 80 }: UsePullToRefreshOptions) {
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const startY = useRef(0);
  const pulling = useRef(false);
  const pullDistanceRef = useRef(0);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isMobileViewport()) return;
    const el = e.currentTarget as HTMLElement;
    if (el.scrollTop <= 0) {
      startY.current = e.touches[0].clientY;
      pulling.current = true;
    }
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!pulling.current) return;
    const dy = Math.max(0, e.touches[0].clientY - startY.current);
    const clamped = Math.min(dy, threshold * 1.5);
    pullDistanceRef.current = clamped;
    setPullDistance(clamped);
  }, [threshold]);

  const onTouchEnd = useCallback(async () => {
    if (!pulling.current) return;
    pulling.current = false;
    if (pullDistanceRef.current >= threshold) {
      setRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
      }
    }
    pullDistanceRef.current = 0;
    setPullDistance(0);
  }, [threshold, onRefresh]);

  return {
    refreshing,
    pullDistance,
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
  };
}
