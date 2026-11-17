/**
 * Region-name labels on the globe sit at the centroid of their region's
 * territories. Two labels whose centroids nearly coincide (the tutorial's
 * Tyrrhenian and Adriatic coasts) drew on top of each other, so the later one
 * is nudged a label-height south of the one it collides with.
 *
 * What counts as "nearly coincide", and how far a label-height is, depends on
 * how much of the world the camera shows. The spacing was written for a world
 * board (1.6° of latitude, 7° of longitude), and a regional board is framed to
 * fill the screen with a dozen degrees or so: there nearly every pair of
 * regions "collided", and each nudge pushed a label onto the next, until
 * Sengoku Japan's Shikoku, Kinki and Tōkai labels sat in the Pacific. A board
 * with `projection_bounds` scales the spacing to its own size instead.
 */
export interface RegionLabelPosition {
  lat: number;
  lng: number;
}

export interface BoardBounds {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
}

/** World-board spacing (a label-height and a label-width, in degrees). */
const WORLD_GAP = { lat: 1.6, lng: 7 };

/** Spacing for a board: the world spacing, or a share of a regional board's own extent. */
export function regionLabelGap(bounds: BoardBounds | null | undefined): { lat: number; lng: number } {
  if (!bounds) return WORLD_GAP;
  const latSpan = Math.abs(bounds.maxLat - bounds.minLat);
  const lngSpan = Math.abs(bounds.maxLng - bounds.minLng);
  return {
    // A regional board is framed to fill the screen, where a label is about
    // 20 px tall and 100–130 px wide: a thirtieth of the board's height and a
    // tenth of its width.
    lat: Math.min(WORLD_GAP.lat, latSpan * 0.03),
    lng: Math.min(WORLD_GAP.lng, lngSpan * 0.1),
  };
}

/**
 * Nudge each label that collides with an earlier one a label-height south of
 * it (north, on a regional board, when south would leave the board).
 */
export function separateRegionLabels<T extends RegionLabelPosition>(
  labels: T[],
  bounds: BoardBounds | null | undefined,
): T[] {
  const gap = regionLabelGap(bounds);
  const out = labels.map((l) => ({ ...l }));
  for (let i = 1; i < out.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (Math.abs(out[i].lat - out[j].lat) < gap.lat && Math.abs(out[i].lng - out[j].lng) < gap.lng) {
        const south = out[j].lat - gap.lat;
        out[i] = { ...out[i], lat: bounds && south < Math.min(bounds.minLat, bounds.maxLat) ? out[j].lat + gap.lat : south };
      }
    }
  }
  return out;
}
