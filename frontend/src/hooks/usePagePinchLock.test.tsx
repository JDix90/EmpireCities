/**
 * On the game, replay and spectator screens, a pinch that started off the map
 * zoomed the whole page in Safari on iOS. At its normal size the page now
 * refuses Safari's pinch; zoomed in already, it can still be pinched back out.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePagePinchLock } from './usePagePinchLock';

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';

function pinch(type: 'gesturestart' | 'gesturechange' = 'gesturestart'): boolean {
  const e = new Event(type, { cancelable: true });
  document.dispatchEvent(e);
  return e.defaultPrevented;
}

function setZoom(scale: number) {
  Object.defineProperty(window, 'visualViewport', { value: { scale }, configurable: true });
}

describe('usePagePinchLock', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setZoom(1);
  });

  it("stops Safari's page pinch on an iPhone at the normal size", () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE_UA);
    setZoom(1);
    const { unmount } = renderHook(() => usePagePinchLock());
    expect(pinch('gesturestart')).toBe(true);
    expect(pinch('gesturechange')).toBe(true);
    unmount();
    expect(pinch()).toBe(false);
  });

  it('lets a page that is already zoomed in be pinched back out', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE_UA);
    setZoom(1.14);
    const { unmount } = renderHook(() => usePagePinchLock());
    expect(pinch('gesturestart')).toBe(false);
    expect(pinch('gesturechange')).toBe(false);
    // Back at its normal size, the pinch stops there.
    setZoom(1);
    expect(pinch('gesturechange')).toBe(true);
    unmount();
  });

  it('does nothing off iOS', () => {
    setZoom(1);
    const { unmount } = renderHook(() => usePagePinchLock());
    expect(pinch()).toBe(false);
    unmount();
  });
});
