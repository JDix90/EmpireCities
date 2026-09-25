import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const capacitor = vi.hoisted(() => ({
  native: false,
  available: false,
  state: 'nominal',
  listener: null as null | ((e: { state: string }) => void),
  removed: 0,
  reads: 0,
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => capacitor.native,
    isPluginAvailable: (name: string) => name === 'Thermal' && capacitor.available,
  },
  registerPlugin: () => ({
    getThermalState: () => { capacitor.reads += 1; return Promise.resolve({ state: capacitor.state }); },
    addListener: (_: string, fn: (e: { state: string }) => void) => {
      capacitor.listener = fn;
      return Promise.resolve({ remove: () => { capacitor.removed += 1; return Promise.resolve(); } });
    },
  }),
}));

import {
  NATIVE_HEAT_POLL_MS,
  capacitorHeatSource,
  createHeatGovernor,
  isHotLevel,
  pressureHeatSource,
  toHeatLevel,
  type HeatLevel,
} from './deviceHeat';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('heat levels', () => {
  it('treats only serious and critical as hot, and anything unknown as nominal', () => {
    expect(['nominal', 'fair', 'serious', 'critical'].map((l) => isHotLevel(l as HeatLevel))).toEqual([false, false, true, true]);
    expect(toHeatLevel('serious')).toBe('serious');
    expect(toHeatLevel('scorching')).toBe('nominal');
    expect(toHeatLevel(undefined)).toBe('nominal');
  });
});

describe('capacitorHeatSource', () => {
  beforeEach(() => {
    Object.assign(capacitor, { native: false, available: false, state: 'nominal', listener: null, removed: 0, reads: 0 });
  });

  it('is absent on the web, and in an app build without the plugin', () => {
    expect(capacitorHeatSource()).toBeNull();
    capacitor.native = true;
    expect(capacitorHeatSource()).toBeNull();
  });

  it('reads the state at once, follows change events, polls for the headroom forecast, and stops cleanly', async () => {
    vi.useFakeTimers();
    try {
      capacitor.native = true;
      capacitor.available = true;
      capacitor.state = 'fair';
      const levels: HeatLevel[] = [];
      const stop = capacitorHeatSource()!.subscribe((l) => levels.push(l));
      await vi.advanceTimersByTimeAsync(0);
      expect(levels).toEqual(['fair']);
      capacitor.listener?.({ state: 'serious' });
      expect(levels).toEqual(['fair', 'serious']);
      capacitor.state = 'critical';
      await vi.advanceTimersByTimeAsync(NATIVE_HEAT_POLL_MS);
      expect(levels).toEqual(['fair', 'serious', 'critical']);
      stop();
      expect(capacitor.removed).toBe(1);
      const reads = capacitor.reads;
      await vi.advanceTimersByTimeAsync(NATIVE_HEAT_POLL_MS * 2);
      expect(capacitor.reads).toBe(reads);
      capacitor.listener?.({ state: 'nominal' });
      expect(levels).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('pressureHeatSource', () => {
  it('is absent where the browser has no Compute Pressure API', () => {
    expect(pressureHeatSource({} as Window & typeof globalThis)).toBeNull();
  });

  it('reports the latest cpu pressure state and disconnects on stop', async () => {
    let cb: ((records: Array<{ state: string }>) => void) | null = null;
    const observe = vi.fn().mockResolvedValue(undefined);
    const disconnect = vi.fn();
    class FakePressureObserver {
      constructor(callback: (records: Array<{ state: string }>) => void) { cb = callback; }
      observe = observe;
      disconnect = disconnect;
    }
    const win = { PressureObserver: FakePressureObserver } as unknown as Window & typeof globalThis;
    const levels: HeatLevel[] = [];
    const stop = pressureHeatSource(win)!.subscribe((l) => levels.push(l));
    expect(observe).toHaveBeenCalledWith('cpu', { sampleInterval: 2000 });
    cb!([{ state: 'nominal' }, { state: 'serious' }]);
    expect(levels).toEqual(['serious']);
    stop();
    expect(disconnect).toHaveBeenCalled();
    await flush();
  });

  it('stays silent when the browser refuses to observe', async () => {
    class Refusing {
      observe() { return Promise.reject(new Error('NotAllowedError')); }
      disconnect() {}
    }
    const win = { PressureObserver: Refusing } as unknown as Window & typeof globalThis;
    const stop = pressureHeatSource(win)!.subscribe(() => {});
    await flush();
    stop();
  });
});

describe('createHeatGovernor', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function governor() {
    const changes: boolean[] = [];
    const g = createHeatGovernor({ onChange: (v) => changes.push(v), coolDownMs: 120_000 });
    return { g, changes };
  }

  it('never steps down for nominal or fair', () => {
    const { g, changes } = governor();
    g.report('nominal');
    g.report('fair');
    vi.advanceTimersByTime(600_000);
    expect(changes).toEqual([]);
  });

  it('steps down at once on serious, once, however often it is reported', () => {
    const { g, changes } = governor();
    g.report('serious');
    g.report('critical');
    g.report('serious');
    expect(changes).toEqual([true]);
  });

  it('steps back up only after the whole cool-down below serious', () => {
    const { g, changes } = governor();
    g.report('critical');
    g.report('fair');
    vi.advanceTimersByTime(119_000);
    g.report('nominal'); // still cooling: does not restart the clock
    expect(changes).toEqual([true]);
    vi.advanceTimersByTime(1_000);
    expect(changes).toEqual([true, false]);
  });

  it('restarts the cool-down when the device heats up again during it', () => {
    const { g, changes } = governor();
    g.report('serious');
    g.report('fair');
    vi.advanceTimersByTime(100_000);
    g.report('serious');
    g.report('fair');
    vi.advanceTimersByTime(100_000);
    expect(changes).toEqual([true]);
    vi.advanceTimersByTime(20_000);
    expect(changes).toEqual([true, false]);
  });

  it('cancels a pending cool-down on dispose', () => {
    const { g, changes } = governor();
    g.report('serious');
    g.report('fair');
    g.dispose();
    vi.advanceTimersByTime(300_000);
    expect(changes).toEqual([true]);
  });
});
