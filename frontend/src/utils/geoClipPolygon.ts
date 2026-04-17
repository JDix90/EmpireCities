/**
 * Clip a GeoJSON geometry to an arbitrary polygon (not just a bbox).
 * Used for Voronoi-based organic territory borders.
 */

import intersect from '@turf/intersect';
import rewind from '@turf/rewind';
import { feature, featureCollection } from '@turf/helpers';

/**
 * Clip a polygon or multipolygon to an arbitrary clip polygon.
 * Rewinds the result with CW exterior rings to match Natural Earth / three-globe convention.
 */
export function clipToPolygon(
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  clipPoly: GeoJSON.Polygon
): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  const geomFeature = feature(geom);
  const clipFeature = feature(clipPoly);
  const result = intersect(featureCollection([geomFeature, clipFeature]));
  const resultFeature = result as GeoJSON.Feature<GeoJSON.Polygon> | null;
  if (!resultFeature?.geometry) return null;
  const rewound = rewind(resultFeature, { reverse: true }) as GeoJSON.Feature<GeoJSON.Polygon>;
  return rewound.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
}
