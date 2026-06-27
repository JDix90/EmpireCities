"""
mapkit — shared helpers for authoring curated regional maps (Borderfall).

A map author defines real geographic outlines (`geo_polygon`, [lng,lat] degrees)
per territory; mapkit derives the flat-canvas `polygon` + `center_point` via a
linear equirectangular projection (the same recipe as buildCharlemagne814.py),
validates the graph (schema + full BFS connectivity), and writes the map JSON.

Usage (see build_balkanized_spain.py for a worked example):

    from mapkit import build_map

    build_map(
        map_id="community_example",
        name="Example",
        description="...",
        bounds={"minLng": -10, "maxLng": 4, "minLat": 36, "maxLat": 44},
        regions=[{"region_id": "castile", "name": "Castile", "bonus": 4}, ...],
        territories=[("toledo", "Toledo", "castile", [[-4,40],[-3,40],...]), ...],
        connections=[("toledo", "madrid", "land"), ...],
        globe_view={"center_lat": 40, "center_lng": -3, "altitude": 0.7},
    )
"""

import json
import math
import os


def load_admin(map_id):
    """Load committed real-geometry admin refs (territory_id -> {iso_codes|admin1|geo_config|clip_bbox})
    generated from Natural Earth ne_10m admin-1. Returns {} if absent."""
    path = os.path.join(os.path.dirname(__file__), "admin", f"{map_id}.admin.json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return {}


def voronoi_cells(bounds, seeds):
    """Bounded Voronoi tessellation of `seeds` ({id: (lng,lat)}) over the bounds
    rectangle. Returns {id: ring[[lng,lat],...]} (convex cells that tile the frame).
    Used by historical-empire maps to give each territory an organic, gap-free cell
    that its real country geometry is clipped to (see build_roman_empire.py)."""
    bb = [bounds["minLng"], bounds["minLat"], bounds["maxLng"], bounds["maxLat"]]

    def clip_hp(poly, m, nrm):
        out = []
        n = len(poly)
        def side(p):
            return (p[0] - m[0]) * nrm[0] + (p[1] - m[1]) * nrm[1]
        for i in range(n):
            a = poly[i]; b = poly[(i + 1) % n]; sa = side(a); sb = side(b)
            if sa <= 0:
                out.append(a)
            if (sa < 0) != (sb < 0):
                t = sa / (sa - sb)
                out.append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))
        return out

    cells = {}
    for sid, si in seeds.items():
        poly = [(bb[0], bb[1]), (bb[2], bb[1]), (bb[2], bb[3]), (bb[0], bb[3])]
        for oid, sj in seeds.items():
            if oid == sid:
                continue
            m = ((si[0] + sj[0]) / 2, (si[1] + sj[1]) / 2)
            nrm = (sj[0] - si[0], sj[1] - si[1])
            poly = clip_hp(poly, m, nrm)
            if len(poly) < 3:
                break
        cells[sid] = [[round(x, 3), round(y, 3)] for x, y in poly]
    return cells


def auto_canvas(bounds, width=1200):
    """Pick canvas H so the flat map is ~undistorted at the region's mid-latitude."""
    mid_lat = (bounds["minLat"] + bounds["maxLat"]) / 2
    lng_span = bounds["maxLng"] - bounds["minLng"]
    lat_span = bounds["maxLat"] - bounds["minLat"]
    aspect = lng_span * math.cos(math.radians(mid_lat)) / lat_span
    height = max(10, int(round(width / aspect / 10.0)) * 10)
    return width, height


def make_project(bounds, canvas_w, canvas_h):
    def project(lng, lat):
        x = (lng - bounds["minLng"]) / (bounds["maxLng"] - bounds["minLng"]) * canvas_w
        y = (bounds["maxLat"] - lat) / (bounds["maxLat"] - bounds["minLat"]) * canvas_h
        return [round(x, 2), round(y, 2)]
    return project


def centroid(poly):
    """Area-weighted polygon centroid (canvas space); falls back to mean if degenerate."""
    a = cx = cy = 0.0
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        cross = x0 * y1 - x1 * y0
        a += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    a *= 0.5
    if abs(a) < 1e-9:
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        return [round(sum(xs) / n, 2), round(sum(ys) / n, 2)]
    return [round(cx / (6 * a), 2), round(cy / (6 * a), 2)]


def _segments_cross(a, b, c, d):
    def orient(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    o1, o2, o3, o4 = orient(a, b, c), orient(a, b, d), orient(c, d, a), orient(c, d, b)
    return ((o1 > 0) != (o2 > 0)) and ((o3 > 0) != (o4 > 0))


def ring_defects(geo):
    """Return (self_intersecting_edge_pairs, repeated_vertex_pairs) for a [lng,lat] ring.

    A non-empty result means the ring is NOT simple — three-globe's earcut cap
    triangulation will render it as spiky shards or lobes on the globe.
    """
    r = [(float(p[0]), float(p[1])) for p in geo]
    if len(r) > 1 and r[0] == r[-1]:
        r = r[:-1]
    n = len(r)
    crosses = []
    for i in range(n):
        a, b = r[i], r[(i + 1) % n]
        for j in range(i + 1, n):
            if j == i or (i + 1) % n == j or (j + 1) % n == i:
                continue
            if _segments_cross(a, b, r[j], r[(j + 1) % n]):
                crosses.append((i, j))
    seen, repeats = {}, []
    for i, p in enumerate(r):
        if p in seen:
            repeats.append((seen[p], i))
        seen[p] = i
    return crosses, repeats


def validate(m):
    """Raise on hard errors; return a list of soft warnings."""
    errors, warnings = [], []
    t_ids = [t["territory_id"] for t in m["territories"]]
    t_set = set(t_ids)
    r_ids = {r["region_id"] for r in m["regions"]}

    if len(t_ids) != len(t_set):
        dupes = {x for x in t_ids if t_ids.count(x) > 1}
        errors.append(f"duplicate territory ids: {dupes}")
    if len(m["territories"]) < 20:
        warnings.append(f"only {len(m['territories'])} territories (recommend >=20)")

    b = m["projection_bounds"]
    for t in m["territories"]:
        if t["region_id"] not in r_ids:
            errors.append(f"{t['territory_id']}: unknown region {t['region_id']}")
        if len(t["polygon"]) < 3:
            errors.append(f"{t['territory_id']}: <3 polygon points")
        for lng, lat in t.get("geo_polygon", []):
            if not (b["minLng"] <= lng <= b["maxLng"] and b["minLat"] <= lat <= b["maxLat"]):
                warnings.append(f"{t['territory_id']}: geo point out of bounds ({lng},{lat})")
        crosses, repeats = ring_defects(t.get("geo_polygon", []))
        if crosses:
            errors.append(f"{t['territory_id']}: geo_polygon self-intersects at edge pair {crosses[0]}")
        if repeats:
            errors.append(f"{t['territory_id']}: geo_polygon has a repeated (pinch) vertex at {repeats[0]}")

    seen = set()
    adj = {tid: set() for tid in t_set}
    for c in m["connections"]:
        for end in ("from", "to"):
            if c[end] not in t_set:
                errors.append(f"connection references unknown territory {c[end]}")
        if c.get("type") not in ("land", "sea", "orbit"):
            errors.append(f"connection {c['from']}->{c['to']} has bad type {c.get('type')}")
        key = frozenset([c["from"], c["to"]])
        if c["from"] == c["to"]:
            errors.append(f"self-loop connection on {c['from']}")
        if key in seen:
            warnings.append(f"duplicate connection {c['from']} <-> {c['to']}")
        seen.add(key)
        if c["from"] in adj and c["to"] in adj:
            adj[c["from"]].add(c["to"])
            adj[c["to"]].add(c["from"])

    start = m["territories"][0]["territory_id"]
    visited, queue = set(), [start]
    while queue:
        node = queue.pop()
        if node in visited:
            continue
        visited.add(node)
        queue.extend(adj[node] - visited)
    isolated = t_set - visited
    if isolated:
        errors.append(f"isolated territories (graph not connected): {sorted(isolated)}")

    # every region must own at least one territory
    owned = {t["region_id"] for t in m["territories"]}
    for r in m["regions"]:
        if r["region_id"] not in owned:
            errors.append(f"region {r['region_id']} has no territories")

    return errors, warnings


def build_map(map_id, name, description, bounds, regions, territories, connections,
              globe_view=None, era_theme="custom", canvas=None, write=True,
              admin_refs=None):
    """
    regions:     [{"region_id","name","bonus"}, ...]
    territories: [(territory_id, name, region_id, geo_polygon[[lng,lat],...]), ...]
    connections: [(from_id, to_id, "land"|"sea"), ...]
    admin_refs:  optional {territory_id: {"iso_codes":[...]} | {"admin1":[...]} |
                 {"geo_config":[...]} | {"clip_bbox":[...]}} merged onto each territory
                 so it renders from real Natural Earth geometry (geo_polygon kept as fallback).
    Returns (map_dict, json_path). Validates first; raises SystemExit on errors.
    """
    canvas_w, canvas_h = canvas if canvas else auto_canvas(bounds)
    project = make_project(bounds, canvas_w, canvas_h)
    admin_refs = admin_refs or {}

    region_members = {r["region_id"]: [] for r in regions}
    out_territories = []
    for tid, tname, region_id, geo in territories:
        canvas_poly = [project(lng, lat) for lng, lat in geo]
        terr = {
            "territory_id": tid,
            "name": tname,
            "polygon": canvas_poly,
            "center_point": centroid(canvas_poly),
            "region_id": region_id,
            "geo_polygon": [[round(lng, 3), round(lat, 3)] for lng, lat in geo],
        }
        for key in ("iso_codes", "admin1", "admin1_clips", "geo_config", "clip_bbox", "clip_polygon"):
            if key in admin_refs.get(tid, {}):
                terr[key] = admin_refs[tid][key]
        out_territories.append(terr)
        if region_id in region_members:
            region_members[region_id].append(tid)

    out_regions = [{
        "region_id": r["region_id"],
        "name": r["name"],
        "bonus": r["bonus"],
        "territory_ids": region_members.get(r["region_id"], []),
    } for r in regions]

    gv = {"lock_rotation": True}
    if globe_view:
        gv.update(globe_view)

    m = {
        "map_id": map_id,
        "name": name,
        "description": description,
        "era_theme": era_theme,
        "canvas_width": canvas_w,
        "canvas_height": canvas_h,
        "projection_bounds": bounds,
        "globe_view": gv,
        "territories": out_territories,
        "connections": [{"from": a, "to": bb, "type": t} for a, bb, t in connections],
        "regions": out_regions,
        "is_public": True,
        "play_count": 0,
        "creator_id": "system",
    }

    errs, warns = validate(m)
    print(f"[{map_id}] {len(out_territories)} territories, "
          f"{len(out_regions)} regions, {len(m['connections'])} connections, "
          f"canvas {canvas_w}x{canvas_h}")
    for w in warns:
        print("  WARN:", w)
    if errs:
        for e in errs:
            print("  ERROR:", e)
        raise SystemExit(f"[{map_id}] validation failed")
    print(f"[{map_id}] Validation OK — fully connected graph.")

    path = os.path.join(os.path.dirname(__file__), f"{map_id}.json")
    if write:
        with open(path, "w") as f:
            json.dump(m, f, indent=2)
        print(f"[{map_id}] wrote {path}")
    return m, path
