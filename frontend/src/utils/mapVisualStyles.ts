/** Shared timing and palette constants for map visual animations. */

export const MAP_VISUAL_DURATIONS = {
  reinforce: 3200,
  combat: 3300,
  combatCaptured: 3800,
  fortify: 2600,
  captureFlash: 900,
  strike: 3200,
  naval: 2800,
  influence: 3200,
  influenceBlocked: 1200,
  event: 3400,
  eventGlobal: 3600,
  eraAdvance: 4500,
} as const;

export const ERA_ADVANCE_GOLD_RGB: [number, number, number] = [255, 215, 100];

export const REINFORCE_COLOR = '#4ade80';
export const FORTIFY_COLOR = '#38bdf8';
export const EVENT_AMBER_RGB: [number, number, number] = [251, 191, 36];
export const EVENT_TRUCE_RGB: [number, number, number] = [74, 222, 128];
export const EVENT_STABILITY_RGB: [number, number, number] = [196, 181, 253];
export const COMBAT_RING_RGB: [number, number, number] = [255, 120, 50];
export const NAVAL_RING_RGB: [number, number, number] = [56, 189, 248];
export const INFLUENCE_RING_RGB: [number, number, number] = [167, 139, 250];
export const INFLUENCE_BLOCKED_RGB: [number, number, number] = [120, 120, 130];
export const CAPTURE_FLASH_RGB: [number, number, number] = [255, 255, 255];

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  if (h.length === 3) {
    return [
      parseInt(h[0]! + h[0], 16),
      parseInt(h[1]! + h[1], 16),
      parseInt(h[2]! + h[2], 16),
    ];
  }
  if (h.length >= 6) {
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }
  return [136, 136, 136];
}

export function lerpRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

export function rgbToPixi([r, g, b]: [number, number, number]): number {
  return (r << 16) | (g << 8) | b;
}
