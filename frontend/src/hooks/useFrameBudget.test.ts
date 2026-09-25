import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFrameBudget } from './useFrameBudget';
import { FRAME_BUDGET_ATTR, PHONE_FRAME_CAP_FPS, REDUCED_FRAME_CAP_FPS } from '../utils/frameBudget';
import { HEAT_COOL_DOWN_MS, type HeatLevel, type HeatSource } from '../utils/deviceHeat';

function fakeSource() {
  let emit: ((l: HeatLevel) => void) | null = null;
  let subscriptions = 0;
  const source: HeatSource = {
    subscribe(onLevel) {
      subscriptions += 1;
      emit = onLevel;
      return () => { emit = null; };
    },
  };
  return { source, report: (l: HeatLevel) => act(() => emit?.(l)), listening: () => emit !== null, subscriptions: () => subscriptions };
}

const attr = () => document.documentElement.getAttribute(FRAME_BUDGET_ATTR);

describe('useFrameBudget', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('stays off on a desktop without battery saver, and does not listen for heat', () => {
    const heat = fakeSource();
    const { result } = renderHook(() => useFrameBudget({ phoneLayout: false, batterySaver: false, heatSource: heat.source }));
    expect(result.current).toMatchObject({ active: false, tier: null, reduced: false });
    expect(attr()).toBeNull();
    expect(heat.listening()).toBe(false);
  });

  it('puts a phone on the standard tier at 30 fps', () => {
    const heat = fakeSource();
    const { result, unmount } = renderHook(() => useFrameBudget({ phoneLayout: true, batterySaver: false, heatSource: heat.source }));
    expect(result.current).toMatchObject({ active: true, tier: 'standard', fps: PHONE_FRAME_CAP_FPS, reduced: false });
    expect(attr()).toBe('standard');
    unmount();
    expect(attr()).toBeNull();
  });

  it('steps a hot phone down to the reduced tier and back up after the cool-down', () => {
    const heat = fakeSource();
    const { result, unmount } = renderHook(() => useFrameBudget({ phoneLayout: true, batterySaver: false, heatSource: heat.source }));
    heat.report('serious');
    expect(result.current).toMatchObject({ tier: 'reduced', fps: REDUCED_FRAME_CAP_FPS, reduced: true, heatSteppedDown: true });
    expect(attr()).toBe('reduced');
    heat.report('fair');
    act(() => { vi.advanceTimersByTime(HEAT_COOL_DOWN_MS); });
    expect(result.current).toMatchObject({ tier: 'standard', reduced: false, heatSteppedDown: false });
    expect(attr()).toBe('standard');
    unmount();
  });

  it('puts any device on the reduced tier with battery saver, and stops listening for heat', () => {
    const heat = fakeSource();
    const { result, rerender, unmount } = renderHook((p: { phone: boolean; saver: boolean }) =>
      useFrameBudget({ phoneLayout: p.phone, batterySaver: p.saver, heatSource: heat.source }), { initialProps: { phone: false, saver: true } });
    expect(result.current).toMatchObject({ active: true, tier: 'reduced', fps: REDUCED_FRAME_CAP_FPS, heatSteppedDown: false });
    expect(heat.listening()).toBe(false);
    rerender({ phone: true, saver: true });
    expect(result.current.tier).toBe('reduced');
    expect(heat.listening()).toBe(false);
    rerender({ phone: true, saver: false });
    expect(heat.listening()).toBe(true);
    expect(result.current.tier).toBe('standard');
    unmount();
  });

  it('runs on the standard tier where the device reports no heat at all', () => {
    const { result, unmount } = renderHook(() => useFrameBudget({ phoneLayout: true, batterySaver: false, heatSource: null }));
    expect(result.current).toMatchObject({ tier: 'standard', heatSteppedDown: false });
    unmount();
  });
});
