#!/usr/bin/env tsx
/**
 * Planar Voronoi for Galactic Age exo-worlds in **normalized UV space** per world,
 * then mapped back to WGS84. Avoids continent-sized wedges when territory rectangles
 * are far apart in lng/lat on the era canvas.
 *
 * Usage: pnpm -C frontend exec tsx scripts/buildGalaxyExoVoronoi.ts
 * Output:  frontend/src/data/galaxyExoVoronoiGlobe.ts
 */

import voronoi from '@turf/voronoi';
import { featureCollection, point } from '@turf/helpers';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type EraGalaxyMap = {
  canvas_width: number;
  canvas_height: number;
  projection_bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number };
  territories: Array<{
    territory_id: string;
    world_id?: string;
    center_point: [number, number];
    polygon: number[][];
  }>;
};

const mapPath = path.join(__dirname, '..', '..', 'database', 'maps', 'era_galaxy.json');
const map = JSON.parse(fs.readFileSync(mapPath, 'utf-8')) as EraGalaxyMap;

const W = map.canvas_width ?? 1200;
const H = map.canvas_height ?? 700;
const b = map.projection_bounds;

function canvasToLngLat(cx: number, cy: number): [number, number] {
  const lng = b.minLng + (cx / W) * (b.maxLng - b.minLng);
  const lat = b.maxLat - (cy / H) * (b.maxLat - b.minLat);
  return [lng, lat];
}

/** Shoelace / 2 for open ring; >0 ⇒ math-CW (lng=x, lat=y). */
function signedArea(ring: [number, number][]): number {
  let s = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    s += (x2 - x1) * (y2 + y1);
  }
  return s / 2;
}

function roundRing(ring: [number, number][], decimals: number): [number, number][] {
  const f = 10 ** decimals;
  return ring.map(([x, y]) => [Math.round(x * f) / f, Math.round(y * f) / f]);
}

const EXO_WORLDS = ['verdan', 'rust', 'nexus_station'] as const;

const entries: Record<string, [number, number][]> = {};

for (const world of EXO_WORLDS) {
  const terrs = map.territories
    .filter((t) => t.world_id === world)
    .sort((a, b) => a.territory_id.localeCompare(b.territory_id));

  if (terrs.length === 0) continue;

  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const t of terrs) {
    for (const [px, py] of t.polygon) {
      const [lng, lat] = canvasToLngLat(px, py);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
  }
  const lngSpan = maxLng - minLng || 1;
  const latSpan = maxLat - minLat || 1;

  const toUv = (lng: number, lat: number): [number, number] => [
    (lng - minLng) / lngSpan,
    (lat - minLat) / latSpan,
  ];
  const toLngLat = (u: number, v: number): [number, number] => [
    minLng + u * lngSpan,
    minLat + v * latSpan,
  ];

  const seeds = terrs.map((t) => ({
    id: t.territory_id,
    uv: toUv(...canvasToLngLat(t.center_point[0], t.center_point[1])),
  }));

  const pts = seeds.map((s) => point(s.uv, { territory_id: s.id }));
  const pad = 0.04;
  const uvBbox: [number, number, number, number] = [-pad, -pad, 1 + pad, 1 + pad];

  const fc = featureCollection(pts);
  const diagram = voronoi(fc, { bbox: uvBbox });
  if (!diagram?.features?.length) throw new Error(`Voronoi failed for world ${world}`);

  function ringCentroid(ring: [number, number][]): [number, number] {
    let sx = 0;
    let sy = 0;
    for (const [x, y] of ring) {
      sx += x;
      sy += y;
    }
    const n = ring.length || 1;
    return [sx / n, sy / n];
  }

  const cells = diagram.features
    .map((f) => {
      if (!f.geometry || f.geometry.type !== 'Polygon') return null;
      const ringUv = f.geometry.coordinates[0] as [number, number][];
      let ringLl = ringUv.map(([u, v]) => toLngLat(u, v));
      if (
        ringLl.length &&
        (ringLl[0][0] !== ringLl[ringLl.length - 1][0] || ringLl[0][1] !== ringLl[ringLl.length - 1][1])
      ) {
        ringLl = [...ringLl, [...ringLl[0]]];
      }
      ringLl = ringLl.slice(0, -1) as [number, number][];
      return { ringLl, c: ringCentroid(ringUv) };
    })
    .filter(Boolean) as { ringLl: [number, number][]; c: [number, number] }[];

  type Pair = { tid: string; j: number; d: number };
  const pairs: Pair[] = [];
  for (const s of seeds) {
    for (let j = 0; j < cells.length; j++) {
      const dx = cells[j].c[0] - s.uv[0];
      const dy = cells[j].c[1] - s.uv[1];
      pairs.push({ tid: s.id, j, d: dx * dx + dy * dy });
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  const gotSeed = new Set<string>();
  const gotCell = new Set<number>();
  for (const p of pairs) {
    if (gotSeed.has(p.tid) || gotCell.has(p.j)) continue;
    gotSeed.add(p.tid);
    gotCell.add(p.j);
    let ring = cells[p.j].ringLl;
    if (signedArea(ring) <= 0) ring = [...ring].reverse();
    entries[p.tid] = roundRing(ring, 5);
  }
}

const outPath = path.join(__dirname, '..', 'src', 'data', 'galaxyExoVoronoiGlobe.ts');
const lines: string[] = [
  '/**',
  ' * Voronoi globe caps for Galactic Age exo-worlds (Verdan, Rust Belt, Nexus).',
  ' * Built in per-world UV space so cells tile the authored map cluster, then mapped to WGS84.',
  ' *',
  ' * Generated by: pnpm -C frontend exec tsx scripts/buildGalaxyExoVoronoi.ts',
  ' * DO NOT EDIT MANUALLY.',
  ' */',
  '',
  'export const GALAXY_EXO_VORONOI_GLOBE: Record<string, [number, number][]> = {',
];

const ids = Object.keys(entries).sort();
for (const id of ids) {
  const ring = entries[id];
  lines.push(`  '${id}': [`);
  for (const [lng, lat] of ring) {
    lines.push(`    [${lng}, ${lat}],`);
  }
  lines.push(`  ],`);
}
lines.push('};');
lines.push('');

fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
console.log(`Wrote ${ids.length} Voronoi rings → ${outPath}`);
