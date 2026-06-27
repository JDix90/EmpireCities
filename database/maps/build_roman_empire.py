"""
Roman Empire — 117 A.D. (the height under Trajan). Forty-one provinces from
Britannia to Mesopotamia, ringed by the Germanic, Dacian, and Parthian frontiers
and bound by the Mediterranean sea-lanes.

Geometry: a Voronoi tessellation of the province seeds tiles the frame; each
province renders its overlapping modern country geometry clipped to its Voronoi
cell — real coastlines (especially the Mediterranean) with organic, gap-free
borders, the same approach as the Charlemagne 814 map. Built via mapkit.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from mapkit import build_map

BOUNDS = {"minLng": -11.0, "maxLng": 48.0, "minLat": 23.0, "maxLat": 57.0}

REGIONS = [
    {"region_id": "italia",    "name": "Italia & the Islands",     "bonus": 5},
    {"region_id": "hispania",  "name": "Hispaniae",                "bonus": 4},
    {"region_id": "gallia",    "name": "Gallia & Britannia",       "bonus": 5},
    {"region_id": "germania",  "name": "Germania & the Alps",      "bonus": 4},
    {"region_id": "illyricum", "name": "Illyricum & the Danube",   "bonus": 5},
    {"region_id": "graecia",   "name": "Achaea & Macedonia",       "bonus": 3},
    {"region_id": "anatolia",  "name": "Asia Minor",               "bonus": 4},
    {"region_id": "oriens",    "name": "Oriens",                   "bonus": 5},
    {"region_id": "africa",    "name": "Africa & Aegyptus",        "bonus": 5},
]

# (territory_id, name, region_id, seed [lng, lat])
SEEDS = [
    ("italia_north", "Italia Cisalpina", "italia", [10.5, 45.2]),
    ("italia_central", "Italia & Roma", "italia", [12.6, 42.2]),
    ("italia_south", "Magna Graecia", "italia", [16.2, 40.6]),
    ("sicilia", "Sicilia", "italia", [14.2, 37.5]),
    ("sardinia_corsica", "Sardinia et Corsica", "italia", [9.1, 40.3]),
    ("tarraconensis", "Hispania Tarraconensis", "hispania", [-2.5, 41.5]),
    ("baetica", "Hispania Baetica", "hispania", [-4.8, 37.6]),
    ("lusitania", "Lusitania", "hispania", [-8.0, 39.6]),
    ("narbonensis", "Gallia Narbonensis", "gallia", [4.2, 43.8]),
    ("aquitania", "Aquitania", "gallia", [0.6, 44.7]),
    ("lugdunensis", "Gallia Lugdunensis", "gallia", [2.8, 47.6]),
    ("belgica", "Gallia Belgica", "gallia", [4.8, 49.6]),
    ("britannia", "Britannia", "gallia", [-2.0, 52.3]),
    ("germania_inferior", "Germania Inferior", "germania", [6.6, 51.0]),
    ("germania_superior", "Germania Superior", "germania", [8.2, 48.5]),
    ("raetia", "Raetia", "germania", [11.0, 47.3]),
    ("noricum", "Noricum", "germania", [14.2, 47.3]),
    ("pannonia", "Pannonia", "illyricum", [18.0, 46.2]),
    ("dalmatia", "Dalmatia", "illyricum", [17.5, 43.8]),
    ("moesia", "Moesia", "illyricum", [23.5, 43.6]),
    ("dacia", "Dacia", "illyricum", [24.5, 46.2]),
    ("thracia", "Thracia", "illyricum", [26.2, 42.0]),
    ("macedonia", "Macedonia", "graecia", [22.2, 40.7]),
    ("achaea", "Achaea", "graecia", [22.4, 38.0]),
    ("creta", "Creta", "graecia", [25.0, 35.2]),
    ("asia", "Asia", "anatolia", [28.2, 38.8]),
    ("bithynia", "Bithynia et Pontus", "anatolia", [32.5, 41.0]),
    ("galatia", "Galatia", "anatolia", [33.5, 39.2]),
    ("cappadocia", "Cappadocia", "anatolia", [36.2, 38.8]),
    ("cilicia", "Cilicia", "anatolia", [34.0, 37.0]),
    ("syria", "Syria", "oriens", [37.8, 34.8]),
    ("judaea", "Judaea", "oriens", [35.3, 31.5]),
    ("arabia", "Arabia Petraea", "oriens", [36.5, 30.0]),
    ("mesopotamia", "Mesopotamia", "oriens", [42.0, 34.5]),
    ("armenia", "Armenia", "oriens", [43.5, 39.5]),
    ("cyprus", "Cyprus", "oriens", [33.2, 35.0]),
    ("aegyptus", "Aegyptus", "africa", [30.8, 27.5]),
    ("cyrenaica", "Cyrenaica", "africa", [21.5, 31.0]),
    ("africa_proconsularis", "Africa Proconsularis", "africa", [9.6, 34.8]),
    ("numidia", "Numidia", "africa", [5.5, 35.3]),
    ("mauretania", "Mauretania", "africa", [-3.0, 34.3]),
]

C = [
    ("italia_north","italia_central","land"),("italia_central","italia_south","land"),
    ("italia_north","narbonensis","land"),("italia_north","raetia","land"),
    ("italia_north","noricum","land"),("italia_north","pannonia","land"),
    ("italia_north","sardinia_corsica","sea"),("italia_central","sardinia_corsica","sea"),
    ("italia_central","sicilia","sea"),("italia_central","dalmatia","sea"),
    ("italia_south","sicilia","sea"),("italia_south","achaea","sea"),
    ("italia_south","africa_proconsularis","sea"),("sicilia","sardinia_corsica","sea"),
    ("sicilia","africa_proconsularis","sea"),("sardinia_corsica","tarraconensis","sea"),
    ("sardinia_corsica","africa_proconsularis","sea"),
    ("tarraconensis","baetica","land"),("tarraconensis","lusitania","land"),
    ("tarraconensis","aquitania","land"),("tarraconensis","narbonensis","land"),
    ("baetica","lusitania","land"),("baetica","mauretania","sea"),("tarraconensis","mauretania","sea"),
    ("narbonensis","aquitania","land"),("narbonensis","lugdunensis","land"),
    ("aquitania","lugdunensis","land"),("lugdunensis","belgica","land"),
    ("lugdunensis","germania_superior","land"),("belgica","germania_inferior","land"),
    ("belgica","germania_superior","land"),("belgica","britannia","sea"),
    ("lugdunensis","britannia","sea"),("germania_inferior","britannia","sea"),
    ("germania_inferior","germania_superior","land"),("germania_superior","raetia","land"),
    ("raetia","noricum","land"),("noricum","pannonia","land"),
    ("pannonia","dalmatia","land"),("pannonia","moesia","land"),("pannonia","dacia","land"),
    ("dalmatia","moesia","land"),("dalmatia","macedonia","land"),
    ("moesia","dacia","land"),("moesia","thracia","land"),("moesia","macedonia","land"),
    ("thracia","macedonia","land"),("thracia","bithynia","sea"),("thracia","asia","sea"),
    ("macedonia","achaea","land"),("achaea","creta","sea"),("achaea","asia","sea"),
    ("creta","cyrenaica","sea"),("creta","asia","sea"),
    ("asia","bithynia","land"),("asia","galatia","land"),("asia","cilicia","land"),
    ("bithynia","galatia","land"),("bithynia","cappadocia","land"),
    ("galatia","cappadocia","land"),("galatia","cilicia","land"),
    ("cappadocia","cilicia","land"),("cappadocia","armenia","land"),
    ("cappadocia","mesopotamia","land"),("cappadocia","syria","land"),
    ("cilicia","syria","land"),("cilicia","cyprus","sea"),
    ("syria","cyprus","sea"),("syria","judaea","land"),("syria","arabia","land"),
    ("syria","mesopotamia","land"),("judaea","arabia","land"),("judaea","aegyptus","land"),
    ("arabia","mesopotamia","land"),("arabia","aegyptus","sea"),("mesopotamia","armenia","land"),
    ("aegyptus","cyrenaica","land"),("cyrenaica","africa_proconsularis","sea"),
    ("africa_proconsularis","numidia","land"),("numidia","mauretania","land"),
]

CELL_COUNTRIES = {
    'italia_north': ['CH', 'IT', 'FR'],
    'italia_central': ['VA', 'SM', 'IT'],
    'italia_south': ['IT'],
    'sicilia': ['MT', 'LY', 'IT'],
    'sardinia_corsica': ['IT', 'FR'],
    'tarraconensis': ['ES'],
    'baetica': ['ES', 'MA'],
    'lusitania': ['ES', 'PT'],
    'narbonensis': ['CH', 'ES', 'MC', 'IT', 'FR'],
    'aquitania': ['ES', 'FR', 'AD'],
    'lugdunensis': ['FR'],
    'belgica': ['NL', 'LU', 'FR', 'BE'],
    'britannia': ['JE', 'GG', 'IM', 'GB', 'IE', 'FR'],
    'germania_inferior': ['SE', 'NL', 'LU', 'DE', 'FR', 'DK', 'BE'],
    'germania_superior': ['CH', 'IT', 'DE', 'FR'],
    'raetia': ['CH', 'LI', 'IT', 'DE', 'CZ', 'AT'],
    'noricum': ['SE', 'SI', 'PL', 'IT', 'DE', 'DK', 'CZ', 'HR', 'AT'],
    'pannonia': ['SK', 'SI', 'RS', 'RU', 'RO', 'PL', 'LT', 'LV', 'HU', 'CZ', 'HR', 'BA', 'AT'],
    'dalmatia': ['RS', 'ME', 'XK', 'HR', 'BA', 'AL'],
    'moesia': ['RS', 'RO', 'XK', 'BG'],
    'dacia': ['UA', 'SK', 'RU', 'RO', 'PL', 'MD', 'LT', 'LV', 'HU', 'BY'],
    'thracia': ['UA', 'TR', 'RO', 'GR', 'BG'],
    'macedonia': ['RS', 'ME', 'MK', 'XK', 'GR', 'BG', 'AL'],
    'achaea': ['GR'],
    'creta': ['LY', 'GR', 'EG'],
    'asia': ['TR', 'GR'],
    'bithynia': ['UA', 'TR', 'RU'],
    'galatia': ['TR'],
    'cappadocia': ['TR', 'SY', 'RU'],
    'cilicia': ['TR', 'SY'],
    'syria': ['TR', 'SY', 'SA', 'LB', 'JO', 'IQ'],
    'judaea': ['SY', 'LB', 'JO', 'IL', 'PS', 'EG'],
    'arabia': ['SA', 'JO', 'IL', 'EG'],
    'mesopotamia': ['TR', 'SY', 'SA', 'KW', 'IQ', 'IR'],
    'armenia': ['UA', 'TR', 'RU', 'KZ', 'IQ', 'IR', 'GE', 'AZ', 'AM'],
    'cyprus': ['TR', 'EG', 'CY'],
    'aegyptus': ['LY', 'EG'],
    'cyrenaica': ['NE', 'LY', 'EG', 'TD'],
    'africa_proconsularis': ['TN', 'NE', 'LY', 'DZ'],
    'numidia': ['DZ'],
    'mauretania': ['MA', 'EH', 'MR', 'ML', 'DZ'],
}

BB = [BOUNDS["minLng"], BOUNDS["minLat"], BOUNDS["maxLng"], BOUNDS["maxLat"]]


def _clip_hp(poly, m, nrm):
    out = []
    n = len(poly)
    def side(p): return (p[0] - m[0]) * nrm[0] + (p[1] - m[1]) * nrm[1]
    for i in range(n):
        a = poly[i]; b = poly[(i + 1) % n]; sa = side(a); sb = side(b)
        if sa <= 0: out.append(a)
        if (sa < 0) != (sb < 0):
            t = sa / (sa - sb); out.append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))
    return out


def _cell(sid, seeds):
    si = seeds[sid]; poly = [(BB[0], BB[1]), (BB[2], BB[1]), (BB[2], BB[3]), (BB[0], BB[3])]
    for oid, sj in seeds.items():
        if oid == sid: continue
        m = ((si[0] + sj[0]) / 2, (si[1] + sj[1]) / 2); nrm = (sj[0] - si[0], sj[1] - si[1])
        poly = _clip_hp(poly, m, nrm)
        if len(poly) < 3: break
    return poly


if __name__ == "__main__":
    seeds = {tid: tuple(s) for tid, _n, _r, s in SEEDS}
    territories = []
    admin_refs = {}
    for tid, name, region, _seed in SEEDS:
        cell = _cell(tid, seeds)
        ring = [[round(x, 3), round(y, 3)] for x, y in cell]
        xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
        cbbox = [round(min(xs), 2), round(min(ys), 2), round(max(xs), 2), round(max(ys), 2)]
        territories.append((tid, name, region, ring))
        admin_refs[tid] = {
            "geo_config": [{"iso": c, "clip_bbox": cbbox} for c in CELL_COUNTRIES[tid]],
            "clip_polygon": [ring],
        }
    build_map(
        map_id="community_roman_empire_117",
        name="Roman Empire — 117 A.D.",
        description=(
            "The Roman Empire at its height under Trajan, 117 A.D. Forty-one provinces "
            "from Britannia to Mesopotamia — Italia and the islands at the core, the "
            "Hispanic, Gallic, and Danubian west, the Greek and Anatolian east, the "
            "Levantine Oriens, and the African and Egyptian south — ringed by the "
            "Germanic, Dacian, and Parthian frontiers and bound together by the "
            "Mediterranean sea-lanes. Hold Rome or rise from the provinces to claim the purple."
        ),
        bounds=BOUNDS,
        regions=REGIONS,
        territories=territories,
        connections=C,
        globe_view={"center_lat": 40.0, "center_lng": 18.0, "altitude": 1.05},
        era_theme="ancient",
        admin_refs=admin_refs,
    )
