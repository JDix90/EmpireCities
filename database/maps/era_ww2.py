"""
ChronoConquest — World War II Era Map (1939–1945)
Canvas: 1200 x 700 px
Theatres: Western Europe, Eastern Front, North Africa, Pacific, Atlantic
Major factions: Germany, Italy, Japan, USA, UK, USSR, China
"""

import json

def quad(x1,y1, x2,y2, x3,y3, x4,y4):
    return [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]

def pent(x1,y1, x2,y2, x3,y3, x4,y4, x5,y5):
    return [[x1,y1],[x2,y2],[x3,y3],[x4,y4],[x5,y5]]

def hex6(x1,y1, x2,y2, x3,y3, x4,y4, x5,y5, x6,y6):
    return [[x1,y1],[x2,y2],[x3,y3],[x4,y4],[x5,y5],[x6,y6]]

# ---------------------------------------------------------------------------
# REGIONS
# ---------------------------------------------------------------------------
regions = [
    {"region_id": "western_front",  "name": "Western Front",     "bonus": 5},
    {"region_id": "eastern_front",  "name": "Eastern Front",     "bonus": 5},
    {"region_id": "north_africa_th","name": "North Africa",      "bonus": 3},
    {"region_id": "pacific_theatre","name": "Pacific Theatre",   "bonus": 5},
    {"region_id": "china_theatre",  "name": "China Theatre",     "bonus": 4},
    {"region_id": "atlantic_th",    "name": "Atlantic",          "bonus": 2},
    {"region_id": "middle_east_th", "name": "Middle East",       "bonus": 3},
    {"region_id": "sub_saharan_th", "name": "Sub-Saharan Africa","bonus": 2},
]

# ---------------------------------------------------------------------------
# TERRITORIES
# ---------------------------------------------------------------------------
territories = [
    # ── WESTERN FRONT ───────────────────────────────────────────────────────
    {"territory_id": "britain_ww2",  "name": "United Kingdom",
     "polygon": quad(120,30, 200,25, 205,110, 115,115),
     "center_point": [160, 70], "region_id": "western_front"},

    {"territory_id": "france_ww2",   "name": "France & Benelux",
     "polygon": quad(165,110, 255,105, 260,190, 160,195),
     "center_point": [210, 153], "region_id": "western_front"},

    {"territory_id": "germany",      "name": "Germany",
     "polygon": quad(225,80, 330,75, 335,165, 220,170),
     "center_point": [278, 123], "region_id": "western_front"},

    {"territory_id": "italy_ww2",    "name": "Italy",
     "polygon": quad(235,185, 315,180, 320,270, 230,275),
     "center_point": [278, 228], "region_id": "western_front"},

    {"territory_id": "iberia_ww2",   "name": "Iberia",
     "polygon": quad(90,155, 185,150, 190,240, 85,245),
     "center_point": [138, 198], "region_id": "western_front"},

    {"territory_id": "scandinavia_ww2","name": "Scandinavia",
     "polygon": quad(200,20, 325,15, 330,80, 195,85),
     "center_point": [263, 50], "region_id": "western_front"},

    # ── EASTERN FRONT ───────────────────────────────────────────────────────
    {"territory_id": "eastern_europe_ww2","name": "Poland & Balkans",
     "polygon": quad(310,80, 430,75, 435,175, 305,180),
     "center_point": [373, 128], "region_id": "eastern_front"},

    {"territory_id": "ukraine",      "name": "Ukraine",
     "polygon": quad(395,100, 530,95, 535,185, 390,190),
     "center_point": [463, 143], "region_id": "eastern_front"},

    {"territory_id": "russia_west",  "name": "Western Russia",
     "polygon": quad(395,30, 580,25, 585,100, 390,105),
     "center_point": [488, 65], "region_id": "eastern_front"},

    {"territory_id": "russia_central","name": "Central Russia",
     "polygon": quad(545,25, 730,20, 735,110, 540,115),
     "center_point": [638, 68], "region_id": "eastern_front"},

    {"territory_id": "russia_east",  "name": "Eastern Russia",
     "polygon": quad(700,15, 900,10, 905,105, 695,110),
     "center_point": [800, 60], "region_id": "eastern_front"},

    {"territory_id": "caucasus",     "name": "Caucasus",
     "polygon": quad(490,175, 600,170, 605,250, 485,255),
     "center_point": [545, 213], "region_id": "eastern_front"},

    # ── NORTH AFRICA ────────────────────────────────────────────────────────
    {"territory_id": "morocco_ww2",  "name": "Morocco & Algeria",
     "polygon": quad(100,255, 235,250, 240,335, 95,340),
     "center_point": [168, 295], "region_id": "north_africa_th"},

    {"territory_id": "libya_egypt",  "name": "Libya & Egypt",
     "polygon": quad(230,250, 400,245, 405,335, 225,340),
     "center_point": [315, 290], "region_id": "north_africa_th"},

    {"territory_id": "ethiopia_ww2", "name": "Ethiopia & East Africa",
     "polygon": quad(390,295, 530,290, 535,390, 385,395),
     "center_point": [460, 343], "region_id": "north_africa_th"},

    {"territory_id": "west_africa_ww2","name": "West Africa",
     "polygon": quad(95,340, 275,335, 280,435, 90,440),
     "center_point": [183, 388], "region_id": "north_africa_th"},

    # ── MIDDLE EAST ─────────────────────────────────────────────────────────
    {"territory_id": "turkey_ww2",   "name": "Turkey",
     "polygon": quad(390,175, 510,170, 515,255, 385,260),
     "center_point": [450, 215], "region_id": "middle_east_th"},

    {"territory_id": "levant_ww2",   "name": "Levant & Iraq",
     "polygon": quad(460,225, 580,220, 585,310, 455,315),
     "center_point": [520, 268], "region_id": "middle_east_th"},

    {"territory_id": "iran_ww2",     "name": "Iran",
     "polygon": quad(565,185, 680,180, 685,270, 560,275),
     "center_point": [623, 228], "region_id": "middle_east_th"},

    {"territory_id": "arabia_ww2",   "name": "Arabia",
     "polygon": quad(455,310, 580,305, 585,400, 450,405),
     "center_point": [518, 355], "region_id": "middle_east_th"},

    # ── PACIFIC THEATRE ─────────────────────────────────────────────────────
    {"territory_id": "japan_ww2",    "name": "Japan",
     "polygon": quad(1010,80, 1120,75, 1125,175, 1005,180),
     "center_point": [1065, 128], "region_id": "pacific_theatre"},

    {"territory_id": "philippines",  "name": "Philippines",
     "polygon": quad(1000,250, 1110,245, 1115,340, 995,345),
     "center_point": [1055, 295], "region_id": "pacific_theatre"},

    {"territory_id": "dutch_east_indies","name": "Dutch East Indies",
     "polygon": quad(870,340, 1060,335, 1065,430, 865,435),
     "center_point": [965, 383], "region_id": "pacific_theatre"},

    {"territory_id": "australia_ww2","name": "Australia",
     "polygon": quad(870,440, 1100,435, 1105,570, 865,575),
     "center_point": [985, 505], "region_id": "pacific_theatre"},

    {"territory_id": "pacific_islands","name": "Pacific Islands",
     "polygon": quad(1100,200, 1190,195, 1195,380, 1095,385),
     "center_point": [1145, 290], "region_id": "pacific_theatre"},

    {"territory_id": "usa_west",     "name": "Western USA",
     "polygon": quad(30,80, 155,75, 160,195, 25,200),
     "center_point": [93, 138], "region_id": "pacific_theatre"},

    # ── CHINA THEATRE ───────────────────────────────────────────────────────
    {"territory_id": "manchuria_ww2","name": "Manchuria",
     "polygon": quad(860,80, 1010,75, 1015,170, 855,175),
     "center_point": [935, 125], "region_id": "china_theatre"},

    {"territory_id": "north_china_ww2","name": "North China",
     "polygon": quad(790,150, 945,145, 950,240, 785,245),
     "center_point": [868, 195], "region_id": "china_theatre"},

    {"territory_id": "south_china_ww2","name": "South China",
     "polygon": quad(800,240, 960,235, 965,340, 795,345),
     "center_point": [880, 290], "region_id": "china_theatre"},

    {"territory_id": "burma_indochina","name": "Burma & Indochina",
     "polygon": quad(750,270, 890,265, 895,360, 745,365),
     "center_point": [820, 315], "region_id": "china_theatre"},

    {"territory_id": "india_ww2",    "name": "India",
     "polygon": quad(640,180, 780,175, 785,280, 635,285),
     "center_point": [713, 230], "region_id": "china_theatre"},

    # ── ATLANTIC ────────────────────────────────────────────────────────────
    {"territory_id": "usa_east",     "name": "Eastern USA & Canada",
     "polygon": quad(30,20, 175,15, 180,80, 25,85),
     "center_point": [103, 53], "region_id": "atlantic_th"},

    {"territory_id": "caribbean",    "name": "Caribbean & Central America",
     "polygon": quad(30,195, 175,190, 180,270, 25,275),
     "center_point": [103, 233], "region_id": "atlantic_th"},

    # ── SUB-SAHARAN ─────────────────────────────────────────────────────────
    {"territory_id": "central_africa_ww2","name": "Central Africa",
     "polygon": quad(255,415, 430,410, 435,510, 250,515),
     "center_point": [343, 463], "region_id": "sub_saharan_th"},

    {"territory_id": "south_africa_ww2","name": "Southern Africa",
     "polygon": quad(255,510, 455,505, 460,610, 250,615),
     "center_point": [355, 560], "region_id": "sub_saharan_th"},
]

# ---------------------------------------------------------------------------
# CONNECTIONS
# ---------------------------------------------------------------------------
connections = [
    # Western Front
    {"from": "britain_ww2",       "to": "france_ww2",        "type": "sea"},
    {"from": "britain_ww2",       "to": "scandinavia_ww2",   "type": "sea"},
    {"from": "france_ww2",        "to": "germany",           "type": "land"},
    {"from": "france_ww2",        "to": "italy_ww2",         "type": "land"},
    {"from": "france_ww2",        "to": "iberia_ww2",        "type": "land"},
    {"from": "germany",           "to": "scandinavia_ww2",   "type": "land"},
    {"from": "germany",           "to": "eastern_europe_ww2","type": "land"},
    {"from": "italy_ww2",         "to": "eastern_europe_ww2","type": "land"},
    {"from": "italy_ww2",         "to": "libya_egypt",       "type": "sea"},
    # Eastern Front
    {"from": "eastern_europe_ww2","to": "ukraine",           "type": "land"},
    {"from": "eastern_europe_ww2","to": "turkey_ww2",        "type": "land"},
    {"from": "ukraine",           "to": "russia_west",       "type": "land"},
    {"from": "ukraine",           "to": "caucasus",          "type": "land"},
    {"from": "russia_west",       "to": "russia_central",    "type": "land"},
    {"from": "russia_central",    "to": "russia_east",       "type": "land"},
    {"from": "russia_east",       "to": "manchuria_ww2",     "type": "land"},
    {"from": "caucasus",          "to": "iran_ww2",          "type": "land"},
    # North Africa
    {"from": "iberia_ww2",        "to": "morocco_ww2",       "type": "sea"},
    {"from": "morocco_ww2",       "to": "libya_egypt",       "type": "land"},
    {"from": "morocco_ww2",       "to": "west_africa_ww2",   "type": "land"},
    {"from": "libya_egypt",       "to": "ethiopia_ww2",      "type": "land"},
    {"from": "libya_egypt",       "to": "levant_ww2",        "type": "land"},
    {"from": "west_africa_ww2",   "to": "central_africa_ww2","type": "land"},
    {"from": "ethiopia_ww2",      "to": "central_africa_ww2","type": "land"},
    # Middle East
    {"from": "turkey_ww2",        "to": "levant_ww2",        "type": "land"},
    {"from": "turkey_ww2",        "to": "iran_ww2",          "type": "land"},
    {"from": "levant_ww2",        "to": "iran_ww2",          "type": "land"},
    {"from": "levant_ww2",        "to": "arabia_ww2",        "type": "land"},
    {"from": "iran_ww2",          "to": "india_ww2",         "type": "land"},
    {"from": "arabia_ww2",        "to": "ethiopia_ww2",      "type": "sea"},
    # Pacific
    {"from": "japan_ww2",         "to": "manchuria_ww2",     "type": "land"},
    {"from": "japan_ww2",         "to": "philippines",       "type": "sea"},
    {"from": "japan_ww2",         "to": "pacific_islands",   "type": "sea"},
    {"from": "philippines",       "to": "dutch_east_indies", "type": "sea"},
    {"from": "dutch_east_indies", "to": "australia_ww2",     "type": "sea"},
    {"from": "pacific_islands",   "to": "australia_ww2",     "type": "sea"},
    {"from": "pacific_islands",   "to": "usa_west",          "type": "sea"},
    {"from": "usa_west",          "to": "usa_east",          "type": "land"},
    # China Theatre
    {"from": "manchuria_ww2",     "to": "north_china_ww2",   "type": "land"},
    {"from": "north_china_ww2",   "to": "south_china_ww2",   "type": "land"},
    {"from": "south_china_ww2",   "to": "burma_indochina",   "type": "land"},
    {"from": "burma_indochina",   "to": "india_ww2",         "type": "land"},
    {"from": "burma_indochina",   "to": "dutch_east_indies", "type": "sea"},
    # Atlantic
    {"from": "usa_east",          "to": "caribbean",         "type": "land"},
    {"from": "usa_east",          "to": "britain_ww2",       "type": "sea"},
    {"from": "caribbean",         "to": "france_ww2",        "type": "sea"},
    # Sub-Saharan
    {"from": "central_africa_ww2","to": "south_africa_ww2",  "type": "land"},
    {"from": "south_africa_ww2",  "to": "australia_ww2",     "type": "sea"},
]

MAP_DATA = {
    "map_id": "era_ww2",
    "name": "World War II (1939–1945)",
    "description": "The greatest conflict in human history. Command the Wehrmacht across Europe, lead the Allied landings, defend the Pacific with Japan, or push back with the Soviet Red Army on the Eastern Front.",
    "era_theme": "ww2",
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
    print(f"\n✓ WWII: {len(territories)} territories, {len(connections)} connections, {len(regions)} regions")
