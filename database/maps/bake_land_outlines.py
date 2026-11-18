"""
Bake each clip-cell territory's real land outline into its `geo_polygon`.

Sengoku Japan, the Roman Empire 117, the Mongol Empire and Napoleonic Europe
are Voronoi boards: every territory is a cell of the board's bounds rectangle
(`clip_polygon`), and the globe and 2D map draw it as the territory's countries
(`geo_config`) clipped to that cell (globeTerritoryGeometry.ts). Their builders
stored the cell itself as `geo_polygon` and as the canvas `polygon`, so anything
that drew those (the map previews) drew rectangles of sea and land, not Japan.

This replaces `geo_polygon` with the drawn land's outline (the largest part's
exterior, simplified) and changes nothing else: the canvas `polygon`, the clip
cell, `center_point` and every connection stay as they are. Natural Earth 1:50m
admin-0 is the same file the globe clips (frontend/public/geo/), and a
territory whose cell holds no land keeps its cell.

Run after re-running any of these maps' builders (they write the cell back):
    python3 database/maps/bake_land_outlines.py
Writes database/maps/<id>.json and frontend/public/maps/regional/<id>.json.
"""
import json
import os
import sys

from shapely.geometry import Polygon, box, shape
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
from mapkit import ring_defects  # noqa: E402

MAPS = [
    "community_sengoku_japan",
    "community_roman_empire_117",
    "community_mongol_empire",
    "community_napoleonic_europe",
]


def countries_by_code():
    """ISO code -> geometries, registered under ISO_A2 and ISO_A2_EH like the globe does."""
    with open(os.path.join(REPO, "frontend", "public", "geo", "ne_50m_admin_0_countries.json")) as f:
        features = json.load(f)["features"]
    out = {}
    for feat in features:
        props = feat.get("properties") or {}
        geom = shape(feat["geometry"]).buffer(0)
        for key in ("ISO_A2", "ISO_A2_EH"):
            code = props.get(key) or props.get(key.lower())
            if code and code != "-99":
                out.setdefault(code, [])
                if not any(g is geom for g in out[code]):
                    out[code].append(geom)
    return out


def drawn_land(territory, countries):
    """The land the globe draws for a clip-cell territory: its countries, each clipped to its bbox, within the cell."""
    parts = []
    for item in territory.get("geo_config", []):
        for geom in countries.get(item["iso"], []):
            if item.get("clip_bbox"):
                geom = geom.intersection(box(*item["clip_bbox"]))
            if not geom.is_empty:
                parts.append(geom)
    if not parts:
        return None
    cell = Polygon(territory["clip_polygon"][0], territory["clip_polygon"][1:])
    land = unary_union(parts).intersection(cell.buffer(0))
    return None if land.is_empty else land


def outline(land, tolerance):
    """The largest part's exterior: simplified, clockwise, rounded like mapkit, with no closing point."""
    polys = [land] if land.geom_type == "Polygon" else [g for g in getattr(land, "geoms", []) if g.geom_type == "Polygon"]
    if not polys:
        return None
    largest = Polygon(max(polys, key=lambda p: p.area).exterior)
    for tol in (tolerance, tolerance / 2, tolerance / 4, 0):
        ring = largest.simplify(tol, preserve_topology=True) if tol else largest
        ring = orient(ring, sign=-1.0)
        pts = []
        for x, y in ring.exterior.coords[:-1]:
            p = [round(x, 3), round(y, 3)]
            if not pts or p != pts[-1]:
                pts.append(p)
        if len(pts) > 1 and pts[0] == pts[-1]:
            pts.pop()
        crosses, repeats = ring_defects(pts)
        if len(pts) >= 4 and not crosses and not repeats:
            return pts
    return None


def main():
    countries = countries_by_code()
    for map_id in MAPS:
        db_path = os.path.join(HERE, f"{map_id}.json")
        with open(db_path) as f:
            m = json.load(f)
        b = m["projection_bounds"]
        # About a pixel of a 1200px canvas: simplification nobody sees, at any board's scale.
        tolerance = max(b["maxLng"] - b["minLng"], b["maxLat"] - b["minLat"]) / 1200
        baked = kept = 0
        for t in m["territories"]:
            if not t.get("clip_polygon") or not t.get("geo_config"):
                continue
            land = drawn_land(t, countries)
            ring = outline(land, tolerance) if land is not None else None
            if ring is None:
                kept += 1
                continue
            t["geo_polygon"] = ring
            baked += 1
        text = json.dumps(m, indent=2)
        for path in (db_path, os.path.join(REPO, "frontend", "public", "maps", "regional", f"{map_id}.json")):
            with open(path, "w") as f:
                f.write(text)
        print(f"{map_id}: {baked} land outlines baked, {kept} cells kept (no land in the cell)")


if __name__ == "__main__":
    main()
