/**
 * Splitting a country into its provinces: the admin-1 units of the shipped
 * Natural Earth file (US states, Russian oblasts, Chinese provinces, …) become
 * territories of their own, in the country's region, with the borders they
 * share with each other, the neighbours the country had, and any lane the
 * author had drawn to the country handed to its nearest province.
 */

import type { EditorConnection, EditorTerritory } from './editorGlobeData';
import {
  classifyNeighbor,
  findNeighbors,
  largestExteriorRing,
  minVertexDistanceKm,
  type PolyGeom,
  type TerritoryGeom,
} from './editorGeo';
import { slugId } from './editorTemplates';
import type { ProvinceInfo } from '../../hooks/useEditorProvinces';

export interface ProvinceSplit {
  territories: EditorTerritory[];
  connections: EditorConnection[];
}

export interface ProvinceSplitInput {
  /** The country territory being replaced. */
  parent: EditorTerritory;
  provinces: ProvinceInfo[];
  /** Every other territory on the map, with geometry. */
  others: TerritoryGeom[];
  /** Ids already in use, so a province id never collides. */
  existingIds: ReadonlySet<string>;
  /** The connections the country had; each goes to the province nearest its other end. */
  parentConnections: EditorConnection[];
  maxVertices?: number;
}

function uniqueId(base: string, taken: ReadonlySet<string>, extra: Set<string>): string {
  let id = base;
  let n = 2;
  while (taken.has(id) || extra.has(id)) id = `${base}_${n++}`;
  extra.add(id);
  return id;
}

export function buildProvinceSplit(input: ProvinceSplitInput): ProvinceSplit {
  const { parent, provinces, others, existingIds, parentConnections } = input;
  const maxVertices = input.maxVertices ?? 300;
  const minted = new Set<string>();

  const territories: EditorTerritory[] = provinces.map((p) => ({
    territory_id: uniqueId(slugId('t', p.code), existingIds, minted),
    name: p.name,
    polygon: largestExteriorRing(p.geometry),
    center_point: p.label,
    region_id: parent.region_id,
    admin1: [p.code],
  }));

  const connections: EditorConnection[] = [];
  const has = (a: string, b: string) =>
    connections.some((c) => (c.from === a && c.to === b) || (c.from === b && c.to === a));
  const add = (from: string, to: string, type: EditorConnection['type']) => {
    if (from !== to && !has(from, to)) connections.push({ from, to, type });
  };

  // Borders and straits between the provinces themselves.
  for (let i = 0; i < provinces.length; i++) {
    for (let j = i + 1; j < provinces.length; j++) {
      const match = classifyNeighbor(provinces[i].geometry, provinces[j].geometry, { maxVertices });
      if (match) add(territories[i].territory_id, territories[j].territory_id, match.type);
    }
  }

  // The neighbours the country had, now by whichever province actually touches them.
  const othersById = new Map(others.map((o) => [o.id, o.geometry] as const));
  provinces.forEach((p, i) => {
    for (const n of findNeighbors(p.geometry, others)) add(territories[i].territory_id, n.id, n.type);
  });

  // A connection the author made to the country (a long sea lane, say) that no
  // province now reaches by geometry: hand it to the nearest province.
  for (const c of parentConnections) {
    const otherId = c.from === parent.territory_id ? c.to : c.from;
    if (otherId === parent.territory_id) continue;
    if (territories.some((t) => has(t.territory_id, otherId))) continue;
    const otherGeom: PolyGeom | undefined = othersById.get(otherId);
    let nearest = 0;
    if (otherGeom) {
      let best = Infinity;
      provinces.forEach((p, i) => {
        const d = minVertexDistanceKm(p.geometry, otherGeom, maxVertices);
        if (d < best) {
          best = d;
          nearest = i;
        }
      });
    }
    add(territories[nearest].territory_id, otherId, c.type);
  }

  return { territories, connections };
}

/** The ISO country code a province code belongs to ("US-CA" → "US"). */
export function provinceCountry(code: string): string {
  return code.slice(0, 2);
}

/** Every country a map's territories already cover, by whole code or by province. */
export function coveredCountryCodes(territories: Array<Pick<EditorTerritory, 'iso_codes' | 'admin1'>>): Set<string> {
  const set = new Set<string>();
  for (const t of territories) {
    t.iso_codes?.forEach((c) => set.add(c));
    t.admin1?.forEach((c) => set.add(provinceCountry(c)));
  }
  return set;
}
