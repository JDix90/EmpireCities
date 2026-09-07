/**
 * Geographic polygon clipping utilities.
 * Clips country polygons to bounding boxes for split territories (e.g. Western USA).
 * Applies rewind after clipping — turf.intersect can reverse winding, causing
 * inverted fills (polygon fills the whole globe except the intended region).
 */

import intersect from '@turf/intersect';
import bboxPolygon from '@turf/bbox-polygon';
import rewind from '@turf/rewind';
import { feature, featureCollection } from '@turf/helpers';

/** [minLng, minLat, maxLng, maxLat] per GeoJSON bbox */
export type ClipBbox = [number, number, number, number];

/**
 * Clip a polygon or multipolygon to a bounding box.
 * Rewinds the result with CW exterior rings to match Natural Earth / three-globe convention.
 * Returns the intersection, or null if no overlap.
 */
export function clipToBbox(
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  bbox: ClipBbox
): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  const geomFeature = feature(geom);
  const boxFeature = bboxPolygon(bbox);
  const result = intersect(featureCollection([geomFeature, boxFeature]));
  const resultFeature = result as GeoJSON.Feature<GeoJSON.Polygon> | null;
  if (!resultFeature?.geometry) return null;
  const rewound = rewind(resultFeature, { reverse: true }) as GeoJSON.Feature<GeoJSON.Polygon>;
  return rewound.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
}
