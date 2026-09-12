/**
 * Homeland trimming for bare country references on the globe.
 *
 * Natural Earth folds integral overseas territory into the parent country's
 * feature, so an unclipped `FR` painted Gaul across French Guiana, the Antilles
 * and Réunion. `COUNTRY_HOMELANDS` says which polygons are the homeland; this
 * module applies it (whole polygons kept or dropped, never cut) and hands the
 * dropped pieces to their own ISO codes so maps can still claim them by name.
 */

import { COUNTRY_HOMELANDS, type ClipBbox } from '../data/territoryGeoMapping';

type PolyGeom = GeoJSON.Polygon | GeoJSON.MultiPolygon;

function polygonsOf(geom: PolyGeom): GeoJSON.Position[][][] {
  return geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
}

function ringBbox(poly: GeoJSON.Position[][]): ClipBbox {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of poly[0] ?? []) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLng, minLat, maxLng, maxLat];
}

function bboxesTouch(a: ClipBbox, b: ClipBbox): boolean {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

function bboxContainsCentre(box: ClipBbox, b: ClipBbox): boolean {
  const lng = (b[0] + b[2]) / 2;
  const lat = (b[1] + b[3]) / 2;
  return lng >= box[0] && lng <= box[2] && lat >= box[1] && lat <= box[3];
}

function toGeometry(polys: GeoJSON.Position[][][]): PolyGeom | null {
  if (polys.length === 0) return null;
  if (polys.length === 1) return { type: 'Polygon', coordinates: polys[0] };
  return { type: 'MultiPolygon', coordinates: polys };
}

/**
 * The homeland part of a country geometry for a bare (unclipped) reference.
 * Countries without a COUNTRY_HOMELANDS entry pass through untouched. Returns
 * null only if nothing is left, which the boxes are chosen never to allow.
 */
export function homelandGeometry(iso: string, geom: PolyGeom): PolyGeom | null {
  const def = COUNTRY_HOMELANDS[iso];
  if (!def) return geom;
  const kept = polygonsOf(geom).filter((poly) =>
    def.homeland.some((box) => bboxesTouch(box, ringBbox(poly))),
  );
  return toGeometry(kept);
}

/**
 * Register the polygons trimmed off by `homelandGeometry` under their own ISO
 * codes (`GF`, `GP`, `SJ`, …) in an ISO → features index, so a territory can
 * reference them directly. A code the index already has (the GeoJSON ships a
 * feature for it) is left alone; a possession with no matching polygon in the
 * file is not registered at all.
 */
export function registerPossessionFeatures(isoToFeatures: Map<string, GeoJSON.Feature[]>): void {
  for (const [iso, def] of Object.entries(COUNTRY_HOMELANDS)) {
    if (!def.possessions) continue;
    const parents = isoToFeatures.get(iso) ?? [];
    const byCode = new Map<string, GeoJSON.Position[][][]>();
    for (const f of parents) {
      const g = f.geometry;
      if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
      for (const poly of polygonsOf(g as PolyGeom)) {
        const b = ringBbox(poly);
        if (def.homeland.some((box) => bboxesTouch(box, b))) continue;
        for (const [code, box] of Object.entries(def.possessions)) {
          if (isoToFeatures.has(code) || !bboxContainsCentre(box, b)) continue;
          const list = byCode.get(code) ?? [];
          list.push(poly);
          byCode.set(code, list);
          break;
        }
      }
    }
    for (const [code, polys] of byCode) {
      const geometry = toGeometry(polys);
      if (!geometry) continue;
      isoToFeatures.set(code, [
        { type: 'Feature', properties: { ISO_A2: code, ISO_A2_EH: code, DERIVED_FROM: iso }, geometry },
      ]);
    }
  }
}
