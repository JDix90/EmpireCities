/**
 * "Strait of Hormuz" — Persian / Arabian Gulf chokepoint.
 * 24 territories across 5 regions, optimised for 2–3 players.
 *
 * Bbox covers ~49°E–60°E, ~22.5°N–28°N:
 *   Iran southern coast (Hormozgan), key island zones (Kish, Lavan, Qeshm),
 *   Oman (Musandam + Batinah coast), UAE east, Qatar, Bahrain.
 *
 * Layout: 5 latitude bands (A–E), strict non-overlapping rectangle grid.
 * Organic wiggles give realistic-looking borders; geo_polygon rings go
 * straight into the globe renderer with no special-case code.
 *
 * Run:  node database/maps/buildCommunityStraitHormuz.js
 */
const fs = require('fs');
const path = require('path');

const MAP_ID = 'community_strait_hormuz';
const CW = 1200;
const CH = 700;

const B = { minLng: 49.0, maxLng: 60.0, minLat: 22.5, maxLat: 28.0 };

function toCanvas(lng, lat) {
  const x = ((lng - B.minLng) / (B.maxLng - B.minLng)) * CW;
  const y = ((B.maxLat - lat) / (B.maxLat - B.minLat)) * CH;
  return [x, y];
}

// ── Shared-edge organic geometry (self-contained, adapted from organic14nGeometry.js) ──

const EPS = 1e-9;

function strKey(parts) {
  return parts.map((x) => (typeof x === 'number' ? x.toFixed(6) : x)).join('|');
}

function hash11(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h % 2001) / 1000) - 1;
}

function wiggleAmp(key, scale) {
  return scale * (0.35 + 0.65 * Math.abs(hash11(key)));
}

function dedupeConsecutive(pts) {
  const r = [];
  for (const p of pts) {
    const prev = r[r.length - 1];
    if (!prev || Math.abs(prev[0] - p[0]) > EPS || Math.abs(prev[1] - p[1]) > EPS) r.push(p);
  }
  return r;
}

function wiggleHorizontal(w, e, lat, key, segments = 10) {
  const amp = wiggleAmp(key, 0.04 + 0.015 * Math.min(8, Math.abs(e - w)));
  const out = [[w, lat]];
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const lng = w + t * (e - w);
    const k = strKey(['H', key, i]);
    const dy = amp * hash11(k) * Math.sin(t * Math.PI);
    out.push([lng, lat + dy]);
  }
  out.push([e, lat]);
  return dedupeConsecutive(out);
}

function wiggleVertical(lng, s, n, key, segments = 10) {
  const amp = wiggleAmp(key, 0.035 + 0.012 * Math.min(6, Math.abs(n - s)));
  const out = [[lng, s]];
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const lat = s + t * (n - s);
    const k = strKey(['V', key, i]);
    const dx = amp * hash11(k) * Math.sin(t * Math.PI);
    out.push([lng + dx, lat]);
  }
  out.push([lng, n]);
  return dedupeConsecutive(out);
}

function interpLatAtLng(pts, lng) {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const lo = Math.min(a[0], b[0]), hi = Math.max(a[0], b[0]);
    if (lng + EPS < lo || lng - EPS > hi) continue;
    if (Math.abs(a[0] - b[0]) < EPS) return a[1];
    const t = (lng - a[0]) / (b[0] - a[0]);
    return a[1] + t * (b[1] - a[1]);
  }
  return pts[pts.length - 1][1];
}

function clipHorizontalToLngRange(pts, lo, hi) {
  if (pts.length < 2 || hi <= lo + EPS) return [];
  const dense = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const steps = Math.max(4, Math.ceil(Math.abs(b[0] - a[0]) * 20));
    for (let j = 0; j <= steps; j++) {
      const t = j / steps;
      dense.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  const inside = dense.filter((p) => p[0] >= lo - 1e-7 && p[0] <= hi + 1e-7);
  if (inside.length === 0) {
    return [[lo, interpLatAtLng(dense, lo)], [hi, interpLatAtLng(dense, hi)]];
  }
  return dedupeConsecutive([
    [lo, interpLatAtLng(dense, lo)],
    ...inside,
    [hi, interpLatAtLng(dense, hi)],
  ]);
}

function buildEdgeLibrary(rawRects) {
  const edgeMap = new Map();
  const masterHCache = new Map();

  function getMasterH(lat) {
    const k = strKey(['mH', lat]);
    if (!masterHCache.has(k)) {
      const segs = Math.max(40, Math.ceil((B.maxLng - B.minLng) * 6));
      masterHCache.set(k, wiggleHorizontal(B.minLng, B.maxLng, lat, 'mH|' + lat, segs));
    }
    return masterHCache.get(k);
  }

  function ensure(key, factory) {
    if (!edgeMap.has(key)) edgeMap.set(key, factory());
    return edgeMap.get(key);
  }

  for (const r of rawRects) {
    const { w, s, e, n, id } = r;
    ensure(strKey(['H', s, w, e]), () => clipHorizontalToLngRange(getMasterH(s), w, e));
    ensure(strKey(['H', n, w, e]), () => clipHorizontalToLngRange(getMasterH(n), w, e));
    ensure(strKey(['V', w, s, n]), () => wiggleVertical(w, s, n, strKey(['vw', id, w])));
    ensure(strKey(['V', e, s, n]), () => wiggleVertical(e, s, n, strKey(['ve', id, e])));
  }
  return edgeMap;
}

function rectToOrganicRing(r, edgeMap) {
  const { w, s, e, n } = r;
  const south = edgeMap.get(strKey(['H', s, w, e]));
  const east  = edgeMap.get(strKey(['V', e, s, n]));
  const north = edgeMap.get(strKey(['H', n, w, e]));
  const west  = edgeMap.get(strKey(['V', w, s, n]));
  if (!south || !east || !north || !west) return null;

  const ring = [];
  for (const p of south) ring.push([p[0], p[1]]);
  for (let i = 1; i < east.length; i++) ring.push([east[i][0], east[i][1]]);
  for (let i = north.length - 2; i >= 0; i--) ring.push([north[i][0], north[i][1]]);
  for (let i = west.length - 2; i >= 1; i--) ring.push([west[i][0], west[i][1]]);

  const closed = dedupeConsecutive(ring);
  if (closed.length < 3) return null;
  const f = closed[0], l = closed[closed.length - 1];
  if (Math.abs(f[0] - l[0]) > EPS || Math.abs(f[1] - l[1]) > EPS) closed.push([f[0], f[1]]);
  return closed;
}

function ringToTerritory(id, name, regionId, ringLngLat) {
  const ring = [...ringLngLat];
  const first = ring[0], last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);

  const poly = ring.map(([lng, lat]) => toCanvas(lng, lat));
  let cx = 0, cy = 0;
  for (let i = 0; i < poly.length - 1; i++) { cx += poly[i][0]; cy += poly[i][1]; }
  const nv = poly.length - 1;
  cx /= nv; cy /= nv;

  const geoRing = ring.map(([lng, lat]) => [
    Math.round(lng * 10000) / 10000,
    Math.round(lat * 10000) / 10000,
  ]);

  return {
    territory_id: id,
    name,
    polygon: poly.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]),
    center_point: [Math.round(cx * 100) / 100, Math.round(cy * 100) / 100],
    region_id: regionId,
    geo_polygon: geoRing,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 24 Territory definitions — WGS84 bounding rectangles {w, s, e, n}
//
// Layout: 5 latitude bands, strict non-overlapping rectangle grid.
//   Row A  27.0–28.0  Iran interior (4)
//   Row B  26.0–27.0  Iran coast / Hormozgan (5)
//   Row C  25.0–26.0  Gulf centre: islands, Qatar, Bahrain, strait (6)
//   Row D  24.0–25.0  UAE coast, Musandam, approaches (5)
//   Row E  22.5–24.0  Southern Gulf / Oman coast (4)
// ═══════════════════════════════════════════════════════════════════════════════

const RAW = [
  // ── ROW A: IRAN INTERIOR (27.0–28.0) ──────────────────────────────────────
  { id: 'hz_bushehr',    name: 'Bushehr Province',      region_id: 'region_iran_interior', w: 49.0, s: 27.0, e: 52.0, n: 28.0 },
  { id: 'hz_firuzabad',  name: 'Firuzabad Heights',     region_id: 'region_iran_interior', w: 52.0, s: 27.0, e: 55.0, n: 28.0 },
  { id: 'hz_lar',        name: 'Lar Highlands',         region_id: 'region_iran_interior', w: 55.0, s: 27.0, e: 57.5, n: 28.0 },
  { id: 'hz_jask_int',   name: 'Jask Hinterland',       region_id: 'region_iran_interior', w: 57.5, s: 27.0, e: 60.0, n: 28.0 },

  // ── ROW B: IRAN COAST / HORMOZGAN (26.0–27.0) ─────────────────────────────
  { id: 'hz_dayyer',     name: 'Dayyer Coast',          region_id: 'region_hormozgan',     w: 49.0, s: 26.0, e: 51.5, n: 27.0 },
  { id: 'hz_kangan',     name: 'Kangan–Assaluyeh',      region_id: 'region_hormozgan',     w: 51.5, s: 26.0, e: 53.5, n: 27.0 },
  { id: 'hz_bastak',     name: 'Bastak Region',         region_id: 'region_hormozgan',     w: 53.5, s: 26.0, e: 55.5, n: 27.0 },
  { id: 'hz_bandar',     name: 'Bandar Abbas',          region_id: 'region_hormozgan',     w: 55.5, s: 26.0, e: 57.5, n: 27.0 },
  { id: 'hz_minab',      name: 'Minab Lowlands',        region_id: 'region_hormozgan',     w: 57.5, s: 26.0, e: 60.0, n: 27.0 },

  // ── ROW C: GULF CENTRE / ISLANDS / ARAB NORTH (25.0–26.0) ─────────────────
  { id: 'hz_bahrain',    name: 'Bahrain',               region_id: 'region_gulf_islands',  w: 49.0, s: 25.0, e: 50.8, n: 26.0 },
  { id: 'hz_qatar',      name: 'Qatar',                 region_id: 'region_arab_coast',    w: 50.8, s: 25.0, e: 52.0, n: 26.0 },
  { id: 'hz_kish',       name: 'Kish & Abu Musa',       region_id: 'region_gulf_islands',  w: 52.0, s: 25.0, e: 54.0, n: 26.0 },
  { id: 'hz_lavan',      name: 'Lavan & Sirri',         region_id: 'region_gulf_islands',  w: 54.0, s: 25.0, e: 55.5, n: 26.0 },
  { id: 'hz_qeshm',      name: 'Qeshm Strait',          region_id: 'region_gulf_islands',  w: 55.5, s: 25.0, e: 57.5, n: 26.0 },
  { id: 'hz_jask_coast', name: 'Jask Coast',            region_id: 'region_hormozgan',     w: 57.5, s: 25.0, e: 60.0, n: 26.0 },

  // ── ROW D: UAE COAST / MUSANDAM / APPROACHES (24.0–25.0) ──────────────────
  { id: 'hz_qatar_s',    name: 'Southern Qatar',        region_id: 'region_arab_coast',    w: 49.0, s: 24.0, e: 51.5, n: 25.0 },
  { id: 'hz_abu_dhabi',  name: 'Abu Dhabi',             region_id: 'region_arab_coast',    w: 51.5, s: 24.0, e: 53.5, n: 25.0 },
  { id: 'hz_dubai',      name: 'Dubai & Sharjah',       region_id: 'region_arab_coast',    w: 53.5, s: 24.0, e: 55.5, n: 25.0 },
  { id: 'hz_musandam',   name: 'Musandam Peninsula',    region_id: 'region_oman',          w: 55.5, s: 24.0, e: 57.0, n: 25.0 },
  { id: 'hz_fujairah',   name: 'Fujairah & Dibba',      region_id: 'region_oman',          w: 57.0, s: 24.0, e: 60.0, n: 25.0 },

  // ── ROW E: SOUTHERN GULF / OMAN COAST (22.5–24.0) ─────────────────────────
  { id: 'hz_rub_khali',  name: 'Empty Quarter',         region_id: 'region_arab_coast',    w: 49.0, s: 22.5, e: 53.0, n: 24.0 },
  { id: 'hz_al_ain',     name: 'Al Ain Corridor',       region_id: 'region_arab_coast',    w: 53.0, s: 22.5, e: 56.0, n: 24.0 },
  { id: 'hz_sohar',      name: 'Sohar & Batinah',       region_id: 'region_oman',          w: 56.0, s: 22.5, e: 58.0, n: 24.0 },
  { id: 'hz_muscat',     name: 'Muscat Region',         region_id: 'region_oman',          w: 58.0, s: 22.5, e: 60.0, n: 24.0 },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Connections — land for shared grid edges; sea for Gulf / strait crossings.
// ═══════════════════════════════════════════════════════════════════════════════

const connections = [
  // ── Row A internal (lat 27.0–28.0) ──
  { from: 'hz_bushehr',   to: 'hz_firuzabad',  type: 'land' },
  { from: 'hz_firuzabad', to: 'hz_lar',        type: 'land' },
  { from: 'hz_lar',       to: 'hz_jask_int',   type: 'land' },

  // ── Row A ↔ Row B (lat 27.0 boundary) ──
  { from: 'hz_bushehr',   to: 'hz_dayyer',     type: 'land' },
  { from: 'hz_bushehr',   to: 'hz_kangan',     type: 'land' },
  { from: 'hz_firuzabad', to: 'hz_kangan',     type: 'land' },
  { from: 'hz_firuzabad', to: 'hz_bastak',     type: 'land' },
  { from: 'hz_lar',       to: 'hz_bastak',     type: 'land' },
  { from: 'hz_lar',       to: 'hz_bandar',     type: 'land' },
  { from: 'hz_jask_int',  to: 'hz_minab',      type: 'land' },

  // ── Row B internal ──
  { from: 'hz_dayyer',    to: 'hz_kangan',     type: 'land' },
  { from: 'hz_kangan',    to: 'hz_bastak',     type: 'land' },
  { from: 'hz_bastak',    to: 'hz_bandar',     type: 'land' },
  { from: 'hz_bandar',    to: 'hz_minab',      type: 'land' },

  // ── Row B ↔ Row C (lat 26.0 boundary — Gulf crossing) ──
  { from: 'hz_dayyer',    to: 'hz_bahrain',    type: 'sea'  },
  { from: 'hz_kangan',    to: 'hz_kish',       type: 'sea'  },
  { from: 'hz_bastak',    to: 'hz_kish',       type: 'sea'  },
  { from: 'hz_bastak',    to: 'hz_lavan',      type: 'sea'  },
  { from: 'hz_bandar',    to: 'hz_qeshm',      type: 'sea'  },
  { from: 'hz_minab',     to: 'hz_jask_coast', type: 'land' },

  // ── Row C internal ──
  { from: 'hz_bahrain',   to: 'hz_qatar',      type: 'sea'  },
  { from: 'hz_qatar',     to: 'hz_kish',       type: 'sea'  },
  { from: 'hz_kish',      to: 'hz_lavan',      type: 'sea'  },
  { from: 'hz_lavan',     to: 'hz_qeshm',      type: 'sea'  },
  { from: 'hz_qeshm',     to: 'hz_jask_coast', type: 'sea'  },

  // ── Row C ↔ Row D (lat 25.0 boundary) ──
  { from: 'hz_bahrain',   to: 'hz_qatar_s',    type: 'sea'  },
  { from: 'hz_qatar',     to: 'hz_qatar_s',    type: 'land' },
  { from: 'hz_qatar',     to: 'hz_abu_dhabi',  type: 'sea'  },
  { from: 'hz_kish',      to: 'hz_abu_dhabi',  type: 'sea'  },
  { from: 'hz_kish',      to: 'hz_dubai',      type: 'sea'  },
  { from: 'hz_lavan',     to: 'hz_dubai',      type: 'sea'  },
  { from: 'hz_qeshm',     to: 'hz_musandam',   type: 'sea'  },
  { from: 'hz_qeshm',     to: 'hz_fujairah',   type: 'sea'  },
  { from: 'hz_jask_coast',to: 'hz_fujairah',   type: 'sea'  },

  // ── Row D internal ──
  { from: 'hz_qatar_s',   to: 'hz_abu_dhabi',  type: 'land' },
  { from: 'hz_abu_dhabi', to: 'hz_dubai',      type: 'land' },
  { from: 'hz_dubai',     to: 'hz_musandam',   type: 'land' },
  { from: 'hz_musandam',  to: 'hz_fujairah',   type: 'land' },

  // ── Row D ↔ Row E (lat 24.0 boundary) ──
  { from: 'hz_qatar_s',   to: 'hz_rub_khali',  type: 'land' },
  { from: 'hz_abu_dhabi', to: 'hz_rub_khali',  type: 'land' },
  { from: 'hz_abu_dhabi', to: 'hz_al_ain',     type: 'land' },
  { from: 'hz_dubai',     to: 'hz_al_ain',     type: 'land' },
  { from: 'hz_musandam',  to: 'hz_al_ain',     type: 'land' },
  { from: 'hz_musandam',  to: 'hz_sohar',      type: 'land' },
  { from: 'hz_fujairah',  to: 'hz_sohar',      type: 'land' },
  { from: 'hz_fujairah',  to: 'hz_muscat',     type: 'land' },

  // ── Row E internal ──
  { from: 'hz_rub_khali', to: 'hz_al_ain',     type: 'land' },
  { from: 'hz_al_ain',    to: 'hz_sohar',      type: 'land' },
  { from: 'hz_sohar',     to: 'hz_muscat',     type: 'land' },

  // ── Strategic cross-region sea lanes ──
  { from: 'hz_bahrain',   to: 'hz_kangan',     type: 'sea'  },
  { from: 'hz_lavan',     to: 'hz_musandam',   type: 'sea'  },
  { from: 'hz_jask_coast',to: 'hz_muscat',     type: 'sea'  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Regions (5 regions, bonuses tuned for 24 territories / 2–3 players)
// ═══════════════════════════════════════════════════════════════════════════════

const regions = [
  { region_id: 'region_iran_interior', name: 'Iran Interior',    bonus: 2 },
  { region_id: 'region_hormozgan',     name: 'Hormozgan Coast',  bonus: 3 },
  { region_id: 'region_gulf_islands',  name: 'Gulf Islands',     bonus: 3 },
  { region_id: 'region_arab_coast',    name: 'Arabian Coast',    bonus: 4 },
  { region_id: 'region_oman',          name: 'Oman',             bonus: 3 },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Build — organic rings from shared edge library, emit JSON
// ═══════════════════════════════════════════════════════════════════════════════

const edgeMap = buildEdgeLibrary(RAW);
const territories = RAW.map((r) => {
  const ring = rectToOrganicRing(r, edgeMap);
  if (!ring) throw new Error(`organic ring failed for ${r.id}`);
  return ringToTerritory(r.id, r.name, r.region_id, ring);
});

const out = {
  map_id: MAP_ID,
  name: 'Strait of Hormuz',
  description:
    'The world\'s most strategic maritime chokepoint — 24 territories spanning Iran\'s Hormozgan coast, the Gulf islands of Kish, Qeshm, and Lavan, the Musandam Peninsula, the UAE east coast, Oman\'s Batinah shore, Qatar, and Bahrain. Control the strait, dominate the Gulf.',
  era_theme: 'custom',
  canvas_width: CW,
  canvas_height: CH,
  projection_bounds: B,
  globe_view: {
    lock_rotation: true,
    center_lat: 25.5,
    center_lng: 55.0,
    altitude: 0.65,
  },
  territories,
  connections,
  regions,
};

const outPath = path.join(__dirname, 'community_strait_hormuz.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(
  'Wrote', outPath,
  '—', territories.length, 'territories,',
  connections.length, 'connections,',
  regions.length, 'regions',
);
