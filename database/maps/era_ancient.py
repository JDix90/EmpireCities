"""
ChronoConquest — Ancient World Era Map (circa 200 AD)
Canvas: 1200 x 700 px
Major powers: Roman Empire, Parthian Empire, Han China, Kushan Empire,
              Gupta India, Aksumite Ethiopia, Germanic Tribes, Nomadic Steppe
"""

import json
import math

# ---------------------------------------------------------------------------
# Helper: build a convex polygon approximation from a center + radius list
# ---------------------------------------------------------------------------
def poly(cx, cy, rx, ry, sides=6, rotation=0):
    pts = []
    for i in range(sides):
        angle = rotation + (2 * math.pi * i / sides)
        pts.append([round(cx + rx * math.cos(angle), 1),
                    round(cy + ry * math.sin(angle), 1)])
    return pts

def rect(x, y, w, h):
    return [[x, y], [x+w, y], [x+w, y+h], [x, y+h]]

def quad(x1,y1, x2,y2, x3,y3, x4,y4):
    return [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]

# ---------------------------------------------------------------------------
# REGIONS
# ---------------------------------------------------------------------------
regions = [
    {"region_id": "roman_west",    "name": "Roman West",          "bonus": 5},
    {"region_id": "roman_east",    "name": "Roman East",          "bonus": 4},
    {"region_id": "parthia",       "name": "Parthian Empire",     "bonus": 4},
    {"region_id": "han_china",     "name": "Han China",           "bonus": 5},
    {"region_id": "india",         "name": "Indian Subcontinent", "bonus": 3},
    {"region_id": "africa",        "name": "Africa",              "bonus": 3},
    {"region_id": "steppe",        "name": "Eurasian Steppe",     "bonus": 3},
    {"region_id": "germanic",      "name": "Germanic Lands",      "bonus": 2},
]

# ---------------------------------------------------------------------------
# TERRITORIES  (territory_id, name, polygon, center, region_id)
# ---------------------------------------------------------------------------
territories = [
    # ── ROMAN WEST ──────────────────────────────────────────────────────────
    {"territory_id": "britannia",      "name": "Britannia",
     "polygon": quad(120,30, 195,25, 200,110, 115,115),
     "center_point": [157, 70], "region_id": "roman_west"},

    {"territory_id": "gaul",           "name": "Gaul",
     "polygon": quad(160,110, 255,105, 260,185, 155,190),
     "center_point": [208, 148], "region_id": "roman_west"},

    {"territory_id": "hispania",       "name": "Hispania",
     "polygon": quad(95,155, 185,150, 190,240, 90,245),
     "center_point": [140, 198], "region_id": "roman_west"},

    {"territory_id": "italia",         "name": "Italia",
     "polygon": quad(220,150, 295,145, 300,230, 215,235),
     "center_point": [258, 190], "region_id": "roman_west"},

    {"territory_id": "north_africa",   "name": "North Africa",
     "polygon": quad(130,270, 310,265, 315,340, 125,345),
     "center_point": [220, 305], "region_id": "roman_west"},

    # ── ROMAN EAST ──────────────────────────────────────────────────────────
    {"territory_id": "greece",         "name": "Greece & Balkans",
     "polygon": quad(265,155, 340,150, 345,230, 260,235),
     "center_point": [303, 193], "region_id": "roman_east"},

    {"territory_id": "anatolia",       "name": "Anatolia",
     "polygon": quad(320,145, 430,140, 435,215, 315,220),
     "center_point": [378, 180], "region_id": "roman_east"},

    {"territory_id": "levant",         "name": "Levant & Syria",
     "polygon": quad(370,215, 445,210, 450,285, 365,290),
     "center_point": [408, 250], "region_id": "roman_east"},

    {"territory_id": "egypt",          "name": "Egypt",
     "polygon": quad(320,270, 400,265, 405,340, 315,345),
     "center_point": [360, 305], "region_id": "roman_east"},

    # ── PARTHIAN EMPIRE ─────────────────────────────────────────────────────
    {"territory_id": "mesopotamia",    "name": "Mesopotamia",
     "polygon": quad(420,215, 510,210, 515,285, 415,290),
     "center_point": [465, 250], "region_id": "parthia"},

    {"territory_id": "persia",         "name": "Persia",
     "polygon": quad(490,200, 590,195, 595,280, 485,285),
     "center_point": [540, 240], "region_id": "parthia"},

    {"territory_id": "bactria",        "name": "Bactria",
     "polygon": quad(570,155, 660,150, 665,225, 565,230),
     "center_point": [615, 190], "region_id": "parthia"},

    {"territory_id": "arabia",         "name": "Arabia",
     "polygon": quad(415,285, 510,280, 515,370, 410,375),
     "center_point": [463, 328], "region_id": "parthia"},

    # ── EURASIAN STEPPE ─────────────────────────────────────────────────────
    {"territory_id": "pontic_steppe",  "name": "Pontic Steppe",
     "polygon": quad(310,80, 470,75, 475,145, 305,150),
     "center_point": [390, 113], "region_id": "steppe"},

    {"territory_id": "central_steppe", "name": "Central Steppe",
     "polygon": quad(470,70, 660,65, 665,140, 465,145),
     "center_point": [565, 105], "region_id": "steppe"},

    {"territory_id": "eastern_steppe", "name": "Eastern Steppe",
     "polygon": quad(660,55, 850,50, 855,130, 655,135),
     "center_point": [755, 93], "region_id": "steppe"},

    # ── HAN CHINA ───────────────────────────────────────────────────────────
    {"territory_id": "northern_china", "name": "Northern China",
     "polygon": quad(800,130, 970,125, 975,215, 795,220),
     "center_point": [883, 173], "region_id": "han_china"},

    {"territory_id": "central_china",  "name": "Central China",
     "polygon": quad(810,215, 980,210, 985,295, 805,300),
     "center_point": [895, 255], "region_id": "han_china"},

    {"territory_id": "southern_china", "name": "Southern China",
     "polygon": quad(820,295, 990,290, 995,375, 815,380),
     "center_point": [905, 335], "region_id": "han_china"},

    {"territory_id": "manchuria",      "name": "Manchuria & Korea",
     "polygon": quad(950,80, 1080,75, 1085,155, 945,160),
     "center_point": [1015, 118], "region_id": "han_china"},

    # ── KUSHAN / INDIA ──────────────────────────────────────────────────────
    {"territory_id": "kushan",         "name": "Kushan Empire",
     "polygon": quad(620,195, 750,190, 755,275, 615,280),
     "center_point": [685, 235], "region_id": "india"},

    {"territory_id": "northern_india", "name": "Northern India",
     "polygon": quad(650,275, 790,270, 795,355, 645,360),
     "center_point": [720, 315], "region_id": "india"},

    {"territory_id": "southern_india", "name": "Southern India",
     "polygon": quad(660,355, 790,350, 795,440, 655,445),
     "center_point": [725, 398], "region_id": "india"},

    # ── AFRICA ──────────────────────────────────────────────────────────────
    {"territory_id": "aksum",          "name": "Aksum (Ethiopia)",
     "polygon": quad(390,345, 480,340, 485,420, 385,425),
     "center_point": [435, 383], "region_id": "africa"},

    {"territory_id": "west_africa",    "name": "West Africa",
     "polygon": quad(120,350, 270,345, 275,440, 115,445),
     "center_point": [195, 395], "region_id": "africa"},

    {"territory_id": "central_africa", "name": "Central Africa",
     "polygon": quad(270,360, 420,355, 425,460, 265,465),
     "center_point": [345, 410], "region_id": "africa"},

    # ── GERMANIC LANDS ──────────────────────────────────────────────────────
    {"territory_id": "germania",       "name": "Germania",
     "polygon": quad(210,55, 320,50, 325,130, 205,135),
     "center_point": [265, 93], "region_id": "germanic"},

    {"territory_id": "sarmatia",       "name": "Sarmatia",
     "polygon": quad(305,55, 420,50, 425,130, 300,135),
     "center_point": [363, 93], "region_id": "germanic"},
]

# ---------------------------------------------------------------------------
# CONNECTIONS  (land unless noted)
# ---------------------------------------------------------------------------
connections = [
    # Roman West internal
    {"from": "britannia",      "to": "gaul",           "type": "sea"},
    {"from": "gaul",           "to": "hispania",        "type": "land"},
    {"from": "gaul",           "to": "italia",          "type": "land"},
    {"from": "gaul",           "to": "germania",        "type": "land"},
    {"from": "hispania",       "to": "north_africa",    "type": "sea"},
    {"from": "italia",         "to": "north_africa",    "type": "sea"},
    {"from": "italia",         "to": "greece",          "type": "land"},
    {"from": "north_africa",   "to": "egypt",           "type": "land"},
    # Roman East internal
    {"from": "greece",         "to": "anatolia",        "type": "sea"},
    {"from": "anatolia",       "to": "levant",          "type": "land"},
    {"from": "levant",         "to": "egypt",           "type": "land"},
    {"from": "levant",         "to": "mesopotamia",     "type": "land"},
    # Parthia internal
    {"from": "mesopotamia",    "to": "persia",          "type": "land"},
    {"from": "mesopotamia",    "to": "arabia",          "type": "land"},
    {"from": "persia",         "to": "bactria",         "type": "land"},
    {"from": "persia",         "to": "kushan",          "type": "land"},
    {"from": "bactria",        "to": "kushan",          "type": "land"},
    {"from": "bactria",        "to": "central_steppe",  "type": "land"},
    # Steppe internal
    {"from": "pontic_steppe",  "to": "central_steppe",  "type": "land"},
    {"from": "central_steppe", "to": "eastern_steppe",  "type": "land"},
    {"from": "eastern_steppe", "to": "northern_china",  "type": "land"},
    {"from": "eastern_steppe", "to": "manchuria",       "type": "land"},
    # Han China internal
    {"from": "northern_china", "to": "central_china",   "type": "land"},
    {"from": "central_china",  "to": "southern_china",  "type": "land"},
    {"from": "northern_china", "to": "manchuria",       "type": "land"},
    {"from": "northern_china", "to": "kushan",          "type": "land"},
    # India internal
    {"from": "kushan",         "to": "northern_india",  "type": "land"},
    {"from": "northern_india", "to": "southern_india",  "type": "land"},
    # Africa internal
    {"from": "egypt",          "to": "aksum",           "type": "land"},
    {"from": "north_africa",   "to": "west_africa",     "type": "land"},
    {"from": "west_africa",    "to": "central_africa",  "type": "land"},
    {"from": "central_africa", "to": "aksum",           "type": "land"},
    # Cross-region
    {"from": "anatolia",       "to": "pontic_steppe",   "type": "land"},
    {"from": "pontic_steppe",  "to": "sarmatia",        "type": "land"},
    {"from": "sarmatia",       "to": "germania",        "type": "land"},
    {"from": "aksum",          "to": "arabia",          "type": "sea"},
    {"from": "southern_india", "to": "southern_china",  "type": "sea"},
]

MAP_DATA = {
    "map_id": "era_ancient",
    "name": "Ancient World (200 AD)",
    "description": "The world at the height of the Roman Empire. Command the legions of Rome, the cavalry of Parthia, the armies of Han China, or the warriors of the Eurasian Steppe.",
    "era_theme": "ancient",
    "canvas_width": 1200,
    "canvas_height": 700,
    "territories": territories,
    "connections": connections,
    "regions": regions,
    "is_public": True,
    "is_moderated": True,
    "moderation_status": "approved",
    "creator_id": "system",
}

if __name__ == "__main__":
    print(json.dumps(MAP_DATA, indent=2))
    print(f"\n✓ Ancient World: {len(territories)} territories, {len(connections)} connections, {len(regions)} regions")
