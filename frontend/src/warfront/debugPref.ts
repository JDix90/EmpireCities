/**
 * Whether the tactical view shows its development read-outs, and the match clock a
 * player reads.
 *
 * Tick counts, the zoom factor and the grid size are for whoever is working on the
 * mode; somebody playing a match needs the time and nothing else from that row. The
 * choice is remembered per browser under a `cc-` key like every other client-side
 * preference, and read back strictly: anything but the value this module writes is off.
 */

export const WARFRONT_DEBUG_KEY = 'cc-warfront-debug';

type PrefStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): PrefStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Only the exact value `saveDebugPref` writes turns the read-outs on. */
export function parseDebugPref(raw: string | null | undefined): boolean {
  return raw === '1';
}

export function loadDebugPref(storage: PrefStorage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    return parseDebugPref(storage.getItem(WARFRONT_DEBUG_KEY));
  } catch {
    return false;
  }
}

export function saveDebugPref(on: boolean, storage: PrefStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    if (on) storage.setItem(WARFRONT_DEBUG_KEY, '1');
    else storage.removeItem(WARFRONT_DEBUG_KEY);
  } catch {
    // A private window or a full quota: the toggle still works for this visit.
  }
}

/** Simulation ticks as a match clock, `m:ss`. Anything unusable reads as the start. */
export function formatMatchClock(ticks: number, tickRate: number): string {
  if (!Number.isFinite(ticks) || !Number.isFinite(tickRate) || ticks <= 0 || tickRate <= 0) return '0:00';
  const total = Math.floor(ticks / tickRate);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}
