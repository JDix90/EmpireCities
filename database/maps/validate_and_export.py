"""
ChronoConquest — Map Validation & JSON Export
Validates all 6 era maps and exports them to JSON files.
"""

import json
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
from era_ancient   import MAP_DATA as ANCIENT
from era_medieval  import MAP_DATA as MEDIEVAL
from era_discovery import MAP_DATA as DISCOVERY
from era_ww2       import MAP_DATA as WW2
from era_coldwar   import MAP_DATA as COLDWAR
from era_modern    import MAP_DATA as MODERN

ALL_MAPS = [ANCIENT, MEDIEVAL, DISCOVERY, WW2, COLDWAR, MODERN]

ERRORS   = []
WARNINGS = []

def validate_map(m):
    name  = m["name"]
    t_ids = {t["territory_id"] for t in m["territories"]}
    r_ids = {r["region_id"]    for r in m["regions"]}

    # Min territory count
    if len(m["territories"]) < 20:
        WARNINGS.append(f"[{name}] Only {len(m['territories'])} territories (recommend ≥20)")

    # Min connection count
    if len(m["connections"]) < len(m["territories"]) - 1:
        ERRORS.append(f"[{name}] Not enough connections to form a connected graph")

    # All connections reference valid territory IDs
    for c in m["connections"]:
        if c["from"] not in t_ids:
            ERRORS.append(f"[{name}] Connection 'from' ID not found: {c['from']}")
        if c["to"] not in t_ids:
            ERRORS.append(f"[{name}] Connection 'to' ID not found: {c['to']}")

    # All territories reference valid region IDs
    for t in m["territories"]:
        if t["region_id"] not in r_ids:
            ERRORS.append(f"[{name}] Territory '{t['territory_id']}' has unknown region_id: {t['region_id']}")

    # All territories have valid polygons (≥3 points)
    for t in m["territories"]:
        if len(t["polygon"]) < 3:
            ERRORS.append(f"[{name}] Territory '{t['territory_id']}' has <3 polygon points")

    # All territories have center_point
    for t in m["territories"]:
        if not t.get("center_point") or len(t["center_point"]) != 2:
            ERRORS.append(f"[{name}] Territory '{t['territory_id']}' missing center_point")

    # Check connectivity (BFS from first territory)
    adj = {tid: set() for tid in t_ids}
    for c in m["connections"]:
        if c["from"] in adj and c["to"] in adj:
            adj[c["from"]].add(c["to"])
            adj[c["to"]].add(c["from"])

    start   = m["territories"][0]["territory_id"]
    visited = set()
    queue   = [start]
    while queue:
        node = queue.pop()
        if node in visited:
            continue
        visited.add(node)
        queue.extend(adj[node] - visited)

    isolated = t_ids - visited
    if isolated:
        WARNINGS.append(f"[{name}] {len(isolated)} isolated territories: {isolated}")

    # Check for duplicate territory IDs
    ids = [t["territory_id"] for t in m["territories"]]
    if len(ids) != len(set(ids)):
        ERRORS.append(f"[{name}] Duplicate territory IDs found")

    # Check for truly duplicate connections (same unordered pair appearing twice)
    seen_pairs = set()
    for c in m["connections"]:
        key = frozenset([c["from"], c["to"]])
        if key in seen_pairs:
            WARNINGS.append(f"[{name}] Duplicate connection: {c['from']} ↔ {c['to']}")
        seen_pairs.add(key)

    print(f"  ✓ {name}: {len(m['territories'])} territories, "
          f"{len(m['connections'])} connections, {len(m['regions'])} regions")
    print(f"    Connectivity: {len(visited)}/{len(t_ids)} territories reachable")


print("=" * 60)
print("ChronoConquest — Map Validation Report")
print("=" * 60)

for m in ALL_MAPS:
    validate_map(m)

print()
if ERRORS:
    print(f"❌ {len(ERRORS)} ERROR(S):")
    for e in ERRORS:
        print(f"   {e}")
    sys.exit(1)
else:
    print("✅ No errors found.")

if WARNINGS:
    print(f"⚠️  {len(WARNINGS)} WARNING(S):")
    for w in WARNINGS:
        print(f"   {w}")
else:
    print("✅ No warnings.")

# Export to JSON
print()
print("Exporting JSON files...")
out_dir = os.path.dirname(__file__)
for m in ALL_MAPS:
    fname = os.path.join(out_dir, f"{m['map_id']}.json")
    with open(fname, "w") as f:
        json.dump(m, f, indent=2)
    print(f"  → {fname}")

print()
print("Summary:")
total_t = sum(len(m["territories"]) for m in ALL_MAPS)
total_c = sum(len(m["connections"])  for m in ALL_MAPS)
print(f"  {len(ALL_MAPS)} maps · {total_t} total territories · {total_c} total connections")
print("Done.")
