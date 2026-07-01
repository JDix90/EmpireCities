/**
 * Offline validation for map territory geometry references.
 *
 * Territories render real Natural-Earth geometry keyed by a "code" — an ISO
 * country code (`geo_config[].iso` / legacy `iso_codes[]`) or an admin-1 province
 * code (`admin1[]`). The invariant (documented in
 * frontend/src/data/territoryGeoMapping.ts): within one map, any code used by MORE
 * THAN ONE territory must be CLIPPED in every occurrence — via a per-item
 * `clip_bbox`, a territory-level `clip_bbox`, or an `admin1_clips` entry for that
 * code. An unclipped shared code draws the FULL country/province in each territory
 * that uses it, producing an overlapping "double-draw".
 *
 * This deterministically catches the class of bug the June 2026 map audit fixed
 * (LK/KR/TH/VN/MM whole-country double-draws, Puno claimed by two territories) and
 * prevents it from silently regressing on future map edits. It needs no geometry
 * data, so it runs in the fast `validate:maps` CI step.
 *
 * Not covered (would need real geometry — see the optional offline probe): two
 * territories that both clip the SAME code but with OVERLAPPING bboxes, or a
 * whole-country `iso` overlapping an `admin1` sub-code of that country.
 */

type Bbox = [number, number, number, number];

interface GeoConfigItem {
  iso: string;
  clip_bbox?: Bbox;
}

export interface GeoTerritory {
  territory_id: string;
  geo_config?: GeoConfigItem[];
  iso_codes?: string[];
  admin1?: string[];
  clip_bbox?: Bbox;
  admin1_clips?: Record<string, Bbox>;
}

export interface GeoMapDocument {
  map_id?: string;
  territories: GeoTerritory[];
}

/** The geometry codes a territory declares, each with whether it is clipped. */
function territoryGeoCodes(t: GeoTerritory): Array<{ code: string; clipped: boolean }> {
  const out: Array<{ code: string; clipped: boolean }> = [];
  const territoryClipped = !!t.clip_bbox;
  // Modern per-iso form: each item is clipped iff it carries its own bbox.
  for (const item of t.geo_config ?? []) {
    out.push({ code: item.iso, clipped: !!item.clip_bbox });
  }
  // Legacy country list: the optional territory-level bbox clips the whole union.
  for (const iso of t.iso_codes ?? []) {
    out.push({ code: iso, clipped: territoryClipped });
  }
  // Admin-1 provinces: clipped by the territory bbox, or a per-code admin1_clips entry.
  for (const code of t.admin1 ?? []) {
    out.push({ code, clipped: territoryClipped || !!t.admin1_clips?.[code] });
  }
  return out;
}

/**
 * Returns human-readable errors; empty array means valid. Flags any geometry code
 * used by ≥2 territories where at least one occurrence is unclipped.
 */
export function validateMapGeometry(map: GeoMapDocument): string[] {
  const errors: string[] = [];
  const byCode = new Map<string, Array<{ territory_id: string; clipped: boolean }>>();

  for (const t of map.territories ?? []) {
    for (const { code, clipped } of territoryGeoCodes(t)) {
      const uses = byCode.get(code) ?? [];
      uses.push({ territory_id: t.territory_id, clipped });
      byCode.set(code, uses);
    }
  }

  for (const [code, uses] of byCode) {
    if (uses.length < 2) continue; // used once → no double-draw possible
    const unclipped = uses.filter((u) => !u.clipped).map((u) => u.territory_id);
    if (unclipped.length > 0) {
      errors.push(
        `Geometry code "${code}" is used by ${uses.length} territories but drawn UNCLIPPED in: ` +
          `${unclipped.join(', ')} — a shared code must be clipped (clip_bbox / admin1_clips) in every ` +
          `territory to avoid an overlapping double-draw.`,
      );
    }
  }

  return errors;
}
