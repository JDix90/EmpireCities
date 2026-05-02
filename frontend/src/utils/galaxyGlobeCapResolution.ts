/**
 * Per-territory cap curvature for Galactic Age exo globes (react-globe.gl → three-conic-polygon-geometry).
 *
 * When the planar lng span of a ring exceeds ~180°, Turf point-in-polygon (used to filter interior
 * lattice sites) does not match spherical topology — caps render with punched-out “Swiss cheese”.
 * The library only adds that lattice when min(lng span, lat span) ≥ resolution; bumping resolution
 * just above the narrow bbox axis skips the lattice and uses planar earcut on the contour instead.
 */
export function galaxyExoWideHullCapResolution(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | undefined,
): number | null {
  if (!geometry) return null;
  const ring =
    geometry.type === 'Polygon'
      ? geometry.coordinates[0]
      : geometry.coordinates[0]?.[0];
  if (!ring || ring.length < 4) return null;
  const lngs = ring.map((c) => c[0]);
  const lats = ring.map((c) => c[1]);
  const lngSpan = Math.max(...lngs) - Math.min(...lngs);
  const latSpan = Math.max(...lats) - Math.min(...lats);
  if (lngSpan <= 179) return null;
  const narrow = Math.min(lngSpan, latSpan);
  return Math.min(90, Math.max(6, narrow + 2));
}
