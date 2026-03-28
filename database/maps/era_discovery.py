"""
ChronoConquest — Age of Discovery Era Map (circa 1600 AD)
Canvas: 1200 x 700 px
Major powers: Spanish Empire, Portuguese Empire, Ottoman Empire,
              Mughal India, Ming China, Aztec/Inca remnants, West Africa
"""

import json

def quad(x1,y1, x2,y2, x3,y3, x4,y4):
    return [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]

def pent(x1,y1, x2,y2, x3,y3, x4,y4, x5,y5):
    return [[x1,y1],[x2,y2],[x3,y3],[x4,y4],[x5,y5]]

# ---------------------------------------------------------------------------
# REGIONS
# ---------------------------------------------------------------------------
regions = [
    {"region_id": "europe_disc",     "name": "Europe",              "bonus": 5},
    {"region_id": "ottoman",         "name": "Ottoman Empire",      "bonus": 4},
    {"region_id": "americas_north",  "name": "North America",       "bonus": 4},
    {"region_id": "americas_south",  "name": "South America",       "bonus": 4},
    {"region_id": "africa_disc",     "name": "Africa",              "bonus": 3},
    {"region_id": "mughal_india",    "name": "Mughal India",        "bonus": 4},
    {"region_id": "ming_china",      "name": "Ming China",          "bonus": 5},
    {"region_id": "sea_routes",      "name": "Sea Routes",          "bonus": 2},
]

# ---------------------------------------------------------------------------
# TERRITORIES
# ---------------------------------------------------------------------------
territories = [
    # ── EUROPE ──────────────────────────────────────────────────────────────
    {"territory_id": "spain_portugal","name": "Spain & Portugal",
     "polygon": quad(90,155, 190,150, 195,240, 85,245),
     "center_point": [140, 198], "region_id": "europe_disc"},

    {"territory_id": "france_disc",  "name": "France",
     "polygon": quad(155,110, 245,105, 250,185, 150,190),
     "center_point": [200, 148], "region_id": "europe_disc"},

    {"territory_id": "britain_disc", "name": "Britain",
     "polygon": quad(110,30, 190,25, 195,105, 105,110),
     "center_point": [150, 68], "region_id": "europe_disc"},

    {"territory_id": "holy_roman_disc","name": "Holy Roman Empire",
     "polygon": quad(215,95, 335,90, 340,180, 210,185),
     "center_point": [275, 138], "region_id": "europe_disc"},

    {"territory_id": "russia_disc",  "name": "Russia",
     "polygon": quad(315,50, 530,45, 535,150, 310,155),
     "center_point": [423, 100], "region_id": "europe_disc"},

    {"territory_id": "italy_disc",   "name": "Italian States",
     "polygon": quad(225,180, 305,175, 310,260, 220,265),
     "center_point": [265, 220], "region_id": "europe_disc"},

    # ── OTTOMAN EMPIRE ──────────────────────────────────────────────────────
    {"territory_id": "ottoman_balkans","name": "Ottoman Balkans",
     "polygon": quad(290,175, 400,170, 405,255, 285,260),
     "center_point": [345, 215], "region_id": "ottoman"},

    {"territory_id": "anatolia_disc","name": "Anatolia",
     "polygon": quad(375,160, 490,155, 495,240, 370,245),
     "center_point": [433, 200], "region_id": "ottoman"},

    {"territory_id": "levant_disc",  "name": "Levant & Syria",
     "polygon": quad(415,240, 500,235, 505,315, 410,320),
     "center_point": [458, 278], "region_id": "ottoman"},

    {"territory_id": "egypt_disc",   "name": "Egypt",
     "polygon": quad(345,265, 430,260, 435,345, 340,350),
     "center_point": [388, 305], "region_id": "ottoman"},

    {"territory_id": "mesopotamia_disc","name": "Mesopotamia",
     "polygon": quad(470,220, 565,215, 570,300, 465,305),
     "center_point": [518, 260], "region_id": "ottoman"},

    {"territory_id": "persia_disc",  "name": "Safavid Persia",
     "polygon": quad(545,185, 660,180, 665,270, 540,275),
     "center_point": [603, 228], "region_id": "ottoman"},

    {"territory_id": "arabia_disc",  "name": "Arabia",
     "polygon": quad(430,310, 545,305, 550,400, 425,405),
     "center_point": [488, 355], "region_id": "ottoman"},

    # ── NORTH AMERICA ───────────────────────────────────────────────────────
    {"territory_id": "new_spain",    "name": "New Spain (Mexico)",
     "polygon": quad(30,230, 175,225, 180,320, 25,325),
     "center_point": [103, 275], "region_id": "americas_north"},

    {"territory_id": "north_america_east","name": "Eastern North America",
     "polygon": quad(30,100, 175,95, 180,220, 25,225),
     "center_point": [103, 160], "region_id": "americas_north"},

    {"territory_id": "north_america_west","name": "Western North America",
     "polygon": quad(30,20, 175,15, 180,95, 25,100),
     "center_point": [103, 58], "region_id": "americas_north"},

    # ── SOUTH AMERICA ───────────────────────────────────────────────────────
    {"territory_id": "new_granada",  "name": "New Granada",
     "polygon": quad(30,325, 140,320, 145,420, 25,425),
     "center_point": [85, 373], "region_id": "americas_south"},

    {"territory_id": "brazil",       "name": "Brazil",
     "polygon": quad(110,340, 225,335, 230,445, 105,450),
     "center_point": [168, 393], "region_id": "americas_south"},

    {"territory_id": "peru_chile",   "name": "Peru & Chile",
     "polygon": quad(30,420, 140,415, 145,530, 25,535),
     "center_point": [85, 478], "region_id": "americas_south"},

    {"territory_id": "rio_plata",    "name": "Rio de la Plata",
     "polygon": quad(110,445, 230,440, 235,545, 105,550),
     "center_point": [168, 498], "region_id": "americas_south"},

    # ── AFRICA ──────────────────────────────────────────────────────────────
    {"territory_id": "morocco",      "name": "Morocco",
     "polygon": quad(105,255, 200,250, 205,335, 100,340),
     "center_point": [153, 295], "region_id": "africa_disc"},

    {"territory_id": "west_africa_disc","name": "West Africa",
     "polygon": quad(100,340, 270,335, 275,435, 95,440),
     "center_point": [185, 388], "region_id": "africa_disc"},

    {"territory_id": "central_africa_disc","name": "Central Africa",
     "polygon": quad(255,415, 430,410, 435,515, 250,520),
     "center_point": [343, 463], "region_id": "africa_disc"},

    {"territory_id": "east_africa_disc","name": "East Africa",
     "polygon": quad(405,350, 540,345, 545,455, 400,460),
     "center_point": [473, 403], "region_id": "africa_disc"},

    {"territory_id": "south_africa", "name": "Southern Africa",
     "polygon": quad(260,510, 450,505, 455,610, 255,615),
     "center_point": [355, 560], "region_id": "africa_disc"},

    # ── MUGHAL INDIA ────────────────────────────────────────────────────────
    {"territory_id": "mughal_north", "name": "Mughal North India",
     "polygon": quad(650,175, 790,170, 795,265, 645,270),
     "center_point": [720, 220], "region_id": "mughal_india"},

    {"territory_id": "mughal_south", "name": "South India (Deccan)",
     "polygon": quad(655,265, 800,260, 805,360, 650,365),
     "center_point": [728, 313], "region_id": "mughal_india"},

    {"territory_id": "ceylon_spice", "name": "Ceylon & Spice Islands",
     "polygon": quad(760,360, 900,355, 905,445, 755,450),
     "center_point": [830, 403], "region_id": "mughal_india"},

    # ── MING CHINA ──────────────────────────────────────────────────────────
    {"territory_id": "ming_north",   "name": "Ming North China",
     "polygon": quad(820,100, 990,95, 995,195, 815,200),
     "center_point": [905, 148], "region_id": "ming_china"},

    {"territory_id": "ming_south",   "name": "Ming South China",
     "polygon": quad(830,195, 1000,190, 1005,295, 825,300),
     "center_point": [915, 245], "region_id": "ming_china"},

    {"territory_id": "japan_disc",   "name": "Japan",
     "polygon": quad(1000,80, 1130,75, 1135,175, 995,180),
     "center_point": [1065, 128], "region_id": "ming_china"},

    {"territory_id": "southeast_asia_disc","name": "Southeast Asia",
     "polygon": quad(870,295, 1040,290, 1045,390, 865,395),
     "center_point": [955, 343], "region_id": "ming_china"},

    # ── SEA ROUTES ──────────────────────────────────────────────────────────
    {"territory_id": "atlantic_route","name": "Atlantic Sea Route",
     "polygon": quad(30,540, 110,535, 115,630, 25,635),
     "center_point": [70, 583], "region_id": "sea_routes"},

    {"territory_id": "indian_ocean", "name": "Indian Ocean Route",
     "polygon": quad(540,455, 760,450, 765,545, 535,550),
     "center_point": [650, 500], "region_id": "sea_routes"},
]

# ---------------------------------------------------------------------------
# CONNECTIONS
# ---------------------------------------------------------------------------
connections = [
    # Europe internal
    {"from": "spain_portugal",   "to": "france_disc",       "type": "land"},
    {"from": "spain_portugal",   "to": "morocco",           "type": "sea"},
    {"from": "france_disc",      "to": "britain_disc",      "type": "sea"},
    {"from": "france_disc",      "to": "holy_roman_disc",   "type": "land"},
    {"from": "france_disc",      "to": "italy_disc",        "type": "land"},
    {"from": "holy_roman_disc",  "to": "russia_disc",       "type": "land"},
    {"from": "holy_roman_disc",  "to": "ottoman_balkans",   "type": "land"},
    {"from": "holy_roman_disc",  "to": "italy_disc",        "type": "land"},
    {"from": "russia_disc",      "to": "ottoman_balkans",   "type": "land"},
    {"from": "russia_disc",      "to": "persia_disc",       "type": "land"},
    # Ottoman
    {"from": "ottoman_balkans",  "to": "anatolia_disc",     "type": "land"},
    {"from": "anatolia_disc",    "to": "levant_disc",       "type": "land"},
    {"from": "anatolia_disc",    "to": "mesopotamia_disc",  "type": "land"},
    {"from": "levant_disc",      "to": "egypt_disc",        "type": "land"},
    {"from": "levant_disc",      "to": "mesopotamia_disc",  "type": "land"},
    {"from": "egypt_disc",       "to": "arabia_disc",       "type": "land"},
    {"from": "mesopotamia_disc", "to": "persia_disc",       "type": "land"},
    {"from": "mesopotamia_disc", "to": "arabia_disc",       "type": "land"},
    {"from": "persia_disc",      "to": "mughal_north",      "type": "land"},
    # Americas North
    {"from": "north_america_west","to": "north_america_east","type": "land"},
    {"from": "north_america_east","to": "new_spain",         "type": "land"},
    {"from": "spain_portugal",   "to": "north_america_east","type": "sea"},
    {"from": "britain_disc",     "to": "north_america_east","type": "sea"},
    # Americas South
    {"from": "new_spain",        "to": "new_granada",       "type": "land"},
    {"from": "new_granada",      "to": "brazil",            "type": "land"},
    {"from": "new_granada",      "to": "peru_chile",        "type": "land"},
    {"from": "brazil",           "to": "rio_plata",         "type": "land"},
    {"from": "peru_chile",       "to": "rio_plata",         "type": "land"},
    {"from": "spain_portugal",   "to": "brazil",            "type": "sea"},
    # Africa
    {"from": "morocco",          "to": "west_africa_disc",  "type": "land"},
    {"from": "egypt_disc",       "to": "east_africa_disc",  "type": "land"},
    {"from": "west_africa_disc", "to": "central_africa_disc","type": "land"},
    {"from": "east_africa_disc", "to": "central_africa_disc","type": "land"},
    {"from": "central_africa_disc","to": "south_africa",    "type": "land"},
    {"from": "east_africa_disc", "to": "south_africa",      "type": "land"},
    {"from": "spain_portugal",   "to": "west_africa_disc",  "type": "sea"},
    # India
    {"from": "mughal_north",     "to": "mughal_south",      "type": "land"},
    {"from": "mughal_south",     "to": "ceylon_spice",      "type": "sea"},
    {"from": "east_africa_disc", "to": "indian_ocean",      "type": "sea"},
    {"from": "arabia_disc",      "to": "indian_ocean",      "type": "sea"},
    {"from": "mughal_south",     "to": "indian_ocean",      "type": "sea"},
    {"from": "ceylon_spice",     "to": "southeast_asia_disc","type": "sea"},
    # China
    {"from": "ming_north",       "to": "ming_south",        "type": "land"},
    {"from": "ming_north",       "to": "japan_disc",        "type": "sea"},
    {"from": "ming_south",       "to": "southeast_asia_disc","type": "land"},
    # Sea routes
    {"from": "south_africa",     "to": "atlantic_route",    "type": "sea"},
    {"from": "atlantic_route",   "to": "rio_plata",         "type": "sea"},
    {"from": "south_africa",     "to": "indian_ocean",      "type": "sea"},
    {"from": "indian_ocean",     "to": "ceylon_spice",      "type": "sea"},
]

MAP_DATA = {
    "map_id": "era_discovery",
    "name": "Age of Discovery (1600 AD)",
    "description": "The world in the age of colonial empires and global sea trade. Command the Spanish Armada, Portuguese spice fleets, Ottoman janissaries, or Mughal cavalry across a world being reshaped by exploration.",
    "era_theme": "discovery",
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
    print(f"\n✓ Age of Discovery: {len(territories)} territories, {len(connections)} connections, {len(regions)} regions")
