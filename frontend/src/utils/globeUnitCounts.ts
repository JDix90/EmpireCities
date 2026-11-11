/**
 * Army counts on the globe (`globe_unit_counts_enabled`): which territories
 * show their count badge right now.
 *
 * The 2D map has always drawn a count on every territory; the globe drew none,
 * so a player had to tap a territory to read its army. Drawing every count does
 * not work there either: at the first match's default camera Britain is about
 * 8% of a phone screen, and its fourteen badges pile up over the Midlands. So
 * a count shows where it has room:
 *
 *  - the selected territory (or attack source) and its neighbours always;
 *  - every other count only where it sits at least COUNT_BADGE_MIN_GAP_PX
 *    from a badge already placed, your own territories first, then the bigger
 *    stacks;
 *  - never on a fogged territory (the server sends unit_count -1), nor on the
 *    far side of the globe.
 *
 * Zoomed in, or on a board that fills the screen, that is every count;
 * zoomed out on a crowded board it is the ones that matter most.
 */

/** Centre to centre, in CSS pixels: a 20px badge plus a little air. */
export const COUNT_BADGE_MIN_GAP_PX = 26;

/** 0 the selection, 1 its neighbours, 2 the viewer's own, 3 everything else. */
export type CountTier = 0 | 1 | 2 | 3;

export interface CountCandidate {
  id: string;
  tier: CountTier;
  count: number;
}

export function countTier(
  territoryId: string,
  focusId: string | null,
  neighbourIds: ReadonlySet<string>,
  ownerId: string | null | undefined,
  selfPlayerId: string | null | undefined,
): CountTier {
  if (territoryId === focusId) return 0;
  if (neighbourIds.has(territoryId)) return 1;
  if (ownerId && selfPlayerId && ownerId === selfPlayerId) return 2;
  return 3;
}

/** Placement order: by tier, bigger stacks first within one, then by id so ties are stable. */
export function sortCountCandidates<T extends CountCandidate>(candidates: readonly T[]): T[] {
  return [...candidates].sort((a, b) => a.tier - b.tier || b.count - a.count || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface ScreenSpot {
  x: number;
  y: number;
  /** In the canvas and on the camera's side of the globe. */
  onScreen: boolean;
}

/**
 * The room rule, over candidates already in placement order. Returns the ids
 * that get a badge, in that order.
 */
export function placeCountBadges(
  ordered: readonly CountCandidate[],
  spotOf: (id: string) => ScreenSpot | null,
  minGapPx: number = COUNT_BADGE_MIN_GAP_PX,
): string[] {
  const placed: ScreenSpot[] = [];
  const out: string[] = [];
  for (const c of ordered) {
    const spot = spotOf(c.id);
    if (!spot || !spot.onScreen) continue;
    if (c.tier > 1 && placed.some((p) => Math.hypot(p.x - spot.x, p.y - spot.y) < minGapPx)) continue;
    placed.push(spot);
    out.push(c.id);
  }
  return out;
}

/**
 * Whether a point faces the camera, comfortably inside the horizon. From
 * `altitude` globe radii up, the horizon is where the cosine of the angle from
 * the view's centre falls to 1 / (1 + altitude); the margin keeps a badge from
 * hanging off the globe's edge, where three-globe would still draw it.
 */
export function facesCamera(
  lat: number,
  lng: number,
  view: { lat: number; lng: number; altitude: number },
  margin = 0.08,
): boolean {
  const r = Math.PI / 180;
  const cosAngle = Math.sin(lat * r) * Math.sin(view.lat * r)
    + Math.cos(lat * r) * Math.cos(view.lat * r) * Math.cos((lng - view.lng) * r);
  return cosAngle > 1 / (1 + Math.max(0, view.altitude)) + margin;
}

/**
 * The badge's fill: the owner's colour, darkened as the 2D map darkens it, so
 * the white count reads on any player colour. Anything that is not a hex
 * colour comes back unchanged.
 */
export function countBadgeFill(color: string, keep = 0.52): string {
  const h = color.trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return color;
  const base = [11, 14, 20];
  const mix = [0, 2, 4].map((i, k) => Math.round(parseInt(full.slice(i, i + 2), 16) * keep + base[k]! * (1 - keep)));
  return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
}

/** A stable key for the visible set, so an unchanged set is not a re-render. */
export function visibleCountsKey(ids: readonly string[]): string {
  return ids.join('|');
}
