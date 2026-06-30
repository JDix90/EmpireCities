import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { isDocumentVisible, usePageVisible, usePageVisibilityEffect } from './usePageVisible';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  act(() => setVisibility('visible'));
});

describe('isDocumentVisible', () => {
  it('reflects document.visibilityState', () => {
    setVisibility('visible');
    expect(isDocumentVisible()).toBe(true);
    setVisibility('hidden');
    expect(isDocumentVisible()).toBe(false);
  });
});

describe('usePageVisible', () => {
  it('updates when the page is hidden and shown', () => {
    setVisibility('visible');
    const { result } = renderHook(() => usePageVisible());
    expect(result.current).toBe(true);
    act(() => setVisibility('hidden'));
    expect(result.current).toBe(false);
    act(() => setVisibility('visible'));
    expect(result.current).toBe(true);
  });
});

describe('usePageVisibilityEffect', () => {
  it('invokes the callback on each transition without re-rendering', () => {
    const cb = vi.fn();
    renderHook(() => usePageVisibilityEffect(cb));
    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    expect(cb).toHaveBeenCalledWith(false);
    expect(cb).toHaveBeenCalledWith(true);
  });
});
