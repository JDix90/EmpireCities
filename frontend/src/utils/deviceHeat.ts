/**
 * How hot the device says it is (docs/MOBILE_UX_PLAN.md M-13 phase 3).
 *
 * Three sources, the first available wins:
 *
 * - The native app's `Thermal` plugin. iOS reports `ProcessInfo.thermalState`,
 *   which uses exactly the four levels below. Android reports
 *   `PowerManager` thermal status, raised by the thermal headroom forecast
 *   when throttling is ten seconds away (see ThermalPlugin.java). The status
 *   arrives as events; the headroom is a forecast, so it is also polled.
 * - The Compute Pressure API in Chromium browsers, whose `cpu` source uses the
 *   same four levels. It folds CPU load in with temperature, which is the
 *   right signal here too: a device that is struggling should draw less.
 * - Nothing: Safari on the web reports no heat, and the level stays unknown.
 *   The battery-saver setting covers those players by hand.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export type HeatLevel = 'nominal' | 'fair' | 'serious' | 'critical';

/** Serious and critical are when iOS and Android both advise shedding work. */
export function isHotLevel(level: HeatLevel): boolean {
  return level === 'serious' || level === 'critical';
}

/** Anything unrecognised reads as nominal: a bad report must never throttle a cool device. */
export function toHeatLevel(value: unknown): HeatLevel {
  return value === 'fair' || value === 'serious' || value === 'critical' ? value : 'nominal';
}

export interface HeatSource {
  /** Starts reporting levels; returns the function that stops. */
  subscribe: (onLevel: (level: HeatLevel) => void) => () => void;
}

/** The native plugin's surface (ios/App/App/ThermalPlugin.swift, android/.../ThermalPlugin.java). */
export interface ThermalPlugin {
  getThermalState(): Promise<{ state: string }>;
  addListener(event: 'thermalStateChange', listener: (data: { state: string }) => void): Promise<PluginListenerHandle>;
}

/** How often the native state is re-read, for Android's headroom forecast (Android advises no more than one headroom read a second). */
export const NATIVE_HEAT_POLL_MS = 15_000;

let thermalPlugin: ThermalPlugin | null = null;

/**
 * The native plugin, when the app build carries it. An older build without
 * the plugin answers `isPluginAvailable('Thermal') === false`, so the web
 * bundle never calls into a plugin that is not there.
 */
export function capacitorHeatSource(): HeatSource | null {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('Thermal')) return null;
  thermalPlugin ??= registerPlugin<ThermalPlugin>('Thermal');
  const plugin = thermalPlugin;
  return {
    subscribe(onLevel) {
      let stopped = false;
      const handles: PluginListenerHandle[] = [];
      const read = () => {
        plugin.getThermalState()
          .then((r) => { if (!stopped) onLevel(toHeatLevel(r?.state)); })
          .catch(() => {});
      };
      read();
      const poll = setInterval(read, NATIVE_HEAT_POLL_MS);
      plugin.addListener('thermalStateChange', (e) => { if (!stopped) onLevel(toHeatLevel(e?.state)); })
        .then((h) => { if (stopped) void h.remove(); else handles.push(h); })
        .catch(() => {});
      return () => {
        stopped = true;
        clearInterval(poll);
        for (const h of handles) void h.remove();
      };
    },
  };
}

interface PressureRecordLike { state?: unknown }
interface PressureObserverLike {
  observe(source: 'cpu', options?: { sampleInterval?: number }): Promise<void>;
  disconnect(): void;
}
type PressureObserverCtor = new (cb: (records: PressureRecordLike[]) => void) => PressureObserverLike;

/** The Compute Pressure API, where the browser has it. */
export function pressureHeatSource(win: Window & typeof globalThis = window): HeatSource | null {
  const Ctor = (win as unknown as { PressureObserver?: PressureObserverCtor }).PressureObserver;
  if (typeof Ctor !== 'function') return null;
  return {
    subscribe(onLevel) {
      let observer: PressureObserverLike;
      try {
        observer = new Ctor((records) => {
          const last = records[records.length - 1];
          if (last) onLevel(toHeatLevel(last.state));
        });
      } catch {
        return () => {};
      }
      // Rejected by a permissions policy or an unsupported source: stay silent.
      observer.observe('cpu', { sampleInterval: 2000 }).catch(() => {});
      return () => { try { observer.disconnect(); } catch { /* already gone */ } };
    },
  };
}

let defaultSource: HeatSource | null | undefined;
/** The first available source, chosen once per page load. */
export function defaultHeatSource(): HeatSource | null {
  if (defaultSource === undefined) defaultSource = capacitorHeatSource() ?? pressureHeatSource();
  return defaultSource;
}

/** How long the device must stay below serious before the budget steps back up. */
export const HEAT_COOL_DOWN_MS = 120_000;

export interface HeatGovernor {
  report: (level: HeatLevel) => void;
  dispose: () => void;
}

/**
 * Turns heat reports into one decision: step down or not. It steps down at
 * once on serious or critical, and back up only after the device has
 * reported below serious for the whole cool-down, since a phone that is
 * handed its full frame rate the moment it dips under the line heats
 * straight back over it. A hot report during the cool-down restarts it.
 */
export function createHeatGovernor(opts: {
  onChange: (steppedDown: boolean) => void;
  coolDownMs?: number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}): HeatGovernor {
  const coolDownMs = opts.coolDownMs ?? HEAT_COOL_DOWN_MS;
  const setT = opts.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = opts.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let stepped = false;
  let coolTimer: unknown = null;
  const cancelCooling = () => {
    if (coolTimer !== null) clearT(coolTimer);
    coolTimer = null;
  };
  return {
    report(level) {
      if (isHotLevel(level)) {
        cancelCooling();
        if (!stepped) {
          stepped = true;
          opts.onChange(true);
        }
        return;
      }
      if (!stepped || coolTimer !== null) return;
      coolTimer = setT(() => {
        coolTimer = null;
        stepped = false;
        opts.onChange(false);
      }, coolDownMs);
    },
    dispose: cancelCooling,
  };
}
