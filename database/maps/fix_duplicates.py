"""
Fix duplicate connection warnings by deduplicating connections in all map JSON files.
"""
import json, os

MAP_FILES = [
    "era_ancient.json",
    "era_medieval.json",
    "era_discovery.json",
    "era_ww2.json",
    "era_coldwar.json",
]

base = os.path.dirname(__file__)

for fname in MAP_FILES:
    path = os.path.join(base, fname)
    with open(path) as f:
        data = json.load(f)

    seen = set()
    deduped = []
    for c in data["connections"]:
        key = frozenset([c["from"], c["to"]])
        if key not in seen:
            seen.add(key)
            deduped.append(c)

    removed = len(data["connections"]) - len(deduped)
    data["connections"] = deduped

    with open(path, "w") as f:
        json.dump(data, f, indent=2)

    if removed:
        print(f"  {fname}: removed {removed} duplicate connection(s)")
    else:
        print(f"  {fname}: no duplicates")

print("Done.")
