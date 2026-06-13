import { ERA_ADVANCE_GOLD_RGB, lerpRgb } from './mapVisualStyles';
import { eraMeta } from '../constants/eraMeta';

export function eraAdvanceDisplayName(variant?: string): string {
  return eraMeta(variant).short;
}

export function sortIdsByDistanceFromOrigin<T extends { x: number; y: number; id: string }>(
  items: T[],
  origin: { x: number; y: number },
): T[] {
  return [...items].sort((a, b) => {
    const da = (a.x - origin.x) ** 2 + (a.y - origin.y) ** 2;
    const db = (b.x - origin.x) ** 2 + (b.y - origin.y) ** 2;
    return da - db;
  });
}

export function sortTerritoryIdsByLatLng(
  ids: string[],
  centers: Map<string, { lat: number; lng: number }>,
  originId: string,
): string[] {
  const origin = centers.get(originId);
  if (!origin) return ids;
  return [...ids].sort((a, b) => {
    const ca = centers.get(a);
    const cb = centers.get(b);
    if (!ca) return 1;
    if (!cb) return -1;
    const da = (ca.lat - origin.lat) ** 2 + (ca.lng - origin.lng) ** 2;
    const db = (cb.lat - origin.lat) ** 2 + (cb.lng - origin.lng) ** 2;
    return da - db;
  });
}

/** Cascade intensity 0–1 for a territory at elapsed ms. */
export function eraAdvanceCascadePhase(
  elapsed: number,
  territoryIndex: number,
  totalTerritories: number,
  duration: number,
): number {
  const cascadeWindow = Math.min(2200, duration * 0.55);
  const perStep = cascadeWindow / Math.max(totalTerritories, 1);
  const start = 280 + territoryIndex * perStep * 0.65;
  const local = elapsed - start;
  if (local <= 0) return 0;
  const rise = Math.min(1, local / 320);
  const holdEnd = start + 900;
  if (elapsed < holdEnd) return rise;
  const fade = 1 - Math.min(1, (elapsed - holdEnd) / (duration - holdEnd));
  return rise * Math.max(0, fade);
}

export function eraAdvanceCapitalBurstPhase(elapsed: number): number {
  if (elapsed < 120) return elapsed / 120;
  if (elapsed < 900) return 1;
  if (elapsed < 1600) return 1 - (elapsed - 900) / 700;
  return 0;
}

export function eraAdvancePolygonRgba(
  playerRgb: [number, number, number],
  phase: number,
): string {
  const mix = lerpRgb(playerRgb, ERA_ADVANCE_GOLD_RGB, 0.35 + phase * 0.55);
  const white = lerpRgb(mix, [255, 255, 255], phase * 0.35);
  const alpha = 0.5 + phase * 0.45;
  return `rgba(${white.join(',')}, ${alpha})`;
}
