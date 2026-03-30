"""
ChronoConquest — The Modern Day (2025)
43 territories · 8 regions · comprehensive current-world geopolitical map
"""

import json


def quad(cx, cy, w, h):
    hw, hh = w / 2, h / 2
    return [[cx - hw, cy - hh], [cx + hw, cy - hh],
            [cx + hw, cy + hh], [cx - hw, cy + hh]]


regions = [
    {"region_id": "north_america",      "name": "North America",             "bonus": 5},
    {"region_id": "south_america",      "name": "South America",             "bonus": 3},
    {"region_id": "europe",             "name": "Europe",                    "bonus": 5},
    {"region_id": "russia_cis",         "name": "Russia & CIS",             "bonus": 4},
    {"region_id": "middle_east",        "name": "Middle East & North Africa","bonus": 4},
    {"region_id": "sub_saharan_africa", "name": "Sub-Saharan Africa",       "bonus": 3},
    {"region_id": "asia",               "name": "Asia",                     "bonus": 7},
    {"region_id": "oceania",            "name": "Oceania & Pacific",        "bonus": 2},
]

territories = [
    # ── North America ──
    {"territory_id": "usa_east_mod",         "name": "Eastern United States",      "polygon": quad(327, 218, 75, 80),  "center_point": [327, 218],  "region_id": "north_america"},
    {"territory_id": "usa_west_mod",         "name": "Western United States",      "polygon": quad(248, 213, 90, 90),  "center_point": [248, 213],  "region_id": "north_america"},
    {"territory_id": "canada_mod",           "name": "Canada",                     "polygon": quad(278, 115, 210, 115),"center_point": [278, 115],  "region_id": "north_america"},
    {"territory_id": "mexico_mod",           "name": "Mexico",                     "polygon": quad(245, 298, 95, 70),  "center_point": [245, 298],  "region_id": "north_america"},
    {"territory_id": "central_america_mod",  "name": "Central America & Caribbean","polygon": quad(325, 338, 95, 60),  "center_point": [325, 338],  "region_id": "north_america"},

    # ── South America ──
    {"territory_id": "colombia_mod",  "name": "Colombia & Venezuela",   "polygon": quad(358, 395, 90, 55),  "center_point": [358, 395],  "region_id": "south_america"},
    {"territory_id": "brazil_mod",    "name": "Brazil",                 "polygon": quad(420, 458, 110, 110),"center_point": [420, 458],  "region_id": "south_america"},
    {"territory_id": "peru_mod",      "name": "Peru, Ecuador & Bolivia","polygon": quad(330, 460, 75, 85),  "center_point": [330, 460],  "region_id": "south_america"},
    {"territory_id": "argentina_mod", "name": "Argentina & Uruguay",    "polygon": quad(385, 565, 75, 115), "center_point": [385, 565],  "region_id": "south_america"},
    {"territory_id": "chile_mod",     "name": "Chile & Paraguay",       "polygon": quad(323, 565, 50, 135), "center_point": [323, 565],  "region_id": "south_america"},

    # ── Europe ──
    {"territory_id": "uk_mod",            "name": "United Kingdom & Ireland","polygon": quad(573, 115, 60, 65),  "center_point": [573, 115],  "region_id": "europe"},
    {"territory_id": "france_mod",        "name": "France & Benelux",       "polygon": quad(595, 178, 75, 70),  "center_point": [595, 178],  "region_id": "europe"},
    {"territory_id": "germany_mod",       "name": "Germany & Austria",      "polygon": quad(655, 140, 65, 75),  "center_point": [655, 140],  "region_id": "europe"},
    {"territory_id": "scandinavia_mod",   "name": "Scandinavia",            "polygon": quad(640, 60, 85, 85),   "center_point": [640, 60],   "region_id": "europe"},
    {"territory_id": "iberia_mod",        "name": "Spain & Portugal",       "polygon": quad(558, 225, 70, 65),  "center_point": [558, 225],  "region_id": "europe"},
    {"territory_id": "italy_mod",         "name": "Italy & Switzerland",    "polygon": quad(645, 208, 55, 70),  "center_point": [645, 208],  "region_id": "europe"},
    {"territory_id": "balkans_mod",       "name": "Balkans & Greece",       "polygon": quad(700, 205, 65, 75),  "center_point": [700, 205],  "region_id": "europe"},

    # ── Russia & CIS ──
    {"territory_id": "poland_baltics_mod","name": "Poland & Baltic States", "polygon": quad(718, 120, 70, 75),  "center_point": [718, 120],  "region_id": "russia_cis"},
    {"territory_id": "ukraine_mod",       "name": "Ukraine & Belarus",      "polygon": quad(775, 138, 75, 70),  "center_point": [775, 138],  "region_id": "russia_cis"},
    {"territory_id": "russia_west_mod",   "name": "Western Russia",         "polygon": quad(818, 73, 110, 90),  "center_point": [818, 73],   "region_id": "russia_cis"},
    {"territory_id": "russia_east_mod",   "name": "Eastern Russia",         "polygon": quad(978, 63, 210, 100), "center_point": [978, 63],   "region_id": "russia_cis"},
    {"territory_id": "central_asia_mod",  "name": "Central Asia",           "polygon": quad(858, 183, 90, 70),  "center_point": [858, 183],  "region_id": "russia_cis"},

    # ── Middle East & North Africa ──
    {"territory_id": "turkey_mod",  "name": "Turkey",                       "polygon": quad(760, 215, 75, 45),  "center_point": [760, 215],  "region_id": "middle_east"},
    {"territory_id": "levant_mod",  "name": "Iraq, Syria & Levant",         "polygon": quad(785, 265, 65, 55),  "center_point": [785, 265],  "region_id": "middle_east"},
    {"territory_id": "iran_mod",    "name": "Iran",                         "polygon": quad(855, 248, 75, 70),  "center_point": [855, 248],  "region_id": "middle_east"},
    {"territory_id": "saudi_mod",   "name": "Saudi Arabia & Gulf States",   "polygon": quad(805, 323, 85, 70),  "center_point": [805, 323],  "region_id": "middle_east"},
    {"territory_id": "egypt_mod",   "name": "Egypt",                        "polygon": quad(715, 300, 65, 65),  "center_point": [715, 300],  "region_id": "middle_east"},
    {"territory_id": "maghreb_mod", "name": "North Africa",                 "polygon": quad(613, 280, 140, 65), "center_point": [613, 280],  "region_id": "middle_east"},

    # ── Sub-Saharan Africa ──
    {"territory_id": "west_africa_mod",     "name": "West Africa",           "polygon": quad(563, 378, 80, 70),  "center_point": [563, 378],  "region_id": "sub_saharan_africa"},
    {"territory_id": "nigeria_mod",         "name": "Nigeria & Cameroon",    "polygon": quad(635, 385, 65, 65),  "center_point": [635, 385],  "region_id": "sub_saharan_africa"},
    {"territory_id": "central_africa_mod",  "name": "Central Africa",        "polygon": quad(693, 430, 80, 75),  "center_point": [693, 430],  "region_id": "sub_saharan_africa"},
    {"territory_id": "sudan_horn_mod",      "name": "Sudan & Horn of Africa","polygon": quad(755, 360, 75, 85),  "center_point": [755, 360],  "region_id": "sub_saharan_africa"},
    {"territory_id": "east_africa_mod",     "name": "East Africa",           "polygon": quad(755, 440, 65, 85),  "center_point": [755, 440],  "region_id": "sub_saharan_africa"},
    {"territory_id": "southern_africa_mod", "name": "Southern Africa",       "polygon": quad(708, 520, 90, 105), "center_point": [708, 520],  "region_id": "sub_saharan_africa"},

    # ── Asia ──
    {"territory_id": "india_mod",          "name": "India",               "polygon": quad(928, 315, 70, 105), "center_point": [928, 315],  "region_id": "asia"},
    {"territory_id": "pakistan_afghan_mod", "name": "Pakistan & Afghanistan","polygon": quad(885, 255, 55, 75),"center_point": [885, 255],  "region_id": "asia"},
    {"territory_id": "china_west_mod",     "name": "Western China",        "polygon": quad(950, 198, 75, 90), "center_point": [950, 198],  "region_id": "asia"},
    {"territory_id": "china_east_mod",     "name": "Eastern China",        "polygon": quad(1023, 210, 70, 105),"center_point": [1023, 210],"region_id": "asia"},
    {"territory_id": "japan_mod",          "name": "Japan",                "polygon": quad(1095, 213, 45, 80),"center_point": [1095, 213], "region_id": "asia"},
    {"territory_id": "korea_mod",          "name": "Korean Peninsula",     "polygon": quad(1060, 183, 35, 60),"center_point": [1060, 183], "region_id": "asia"},
    {"territory_id": "southeast_asia_mod", "name": "Southeast Asia",       "polygon": quad(1003, 365, 80, 75),"center_point": [1003, 365], "region_id": "asia"},

    # ── Oceania ──
    {"territory_id": "indonesia_mod", "name": "Indonesia & Philippines","polygon": quad(1048, 415, 90, 55), "center_point": [1048, 415], "region_id": "oceania"},
    {"territory_id": "australia_mod", "name": "Australia & New Zealand","polygon": quad(1078, 515, 110, 115),"center_point": [1078, 515], "region_id": "oceania"},
]

connections = [
    # North America internal
    {"from": "usa_east_mod",        "to": "usa_west_mod",        "type": "land"},
    {"from": "usa_east_mod",        "to": "canada_mod",          "type": "land"},
    {"from": "usa_west_mod",        "to": "canada_mod",          "type": "land"},
    {"from": "usa_east_mod",        "to": "mexico_mod",          "type": "land"},
    {"from": "usa_west_mod",        "to": "mexico_mod",          "type": "land"},
    {"from": "mexico_mod",          "to": "central_america_mod", "type": "land"},
    {"from": "usa_east_mod",        "to": "central_america_mod", "type": "sea"},

    # South America internal
    {"from": "central_america_mod", "to": "colombia_mod",    "type": "land"},
    {"from": "colombia_mod",        "to": "brazil_mod",      "type": "land"},
    {"from": "colombia_mod",        "to": "peru_mod",        "type": "land"},
    {"from": "brazil_mod",          "to": "peru_mod",        "type": "land"},
    {"from": "brazil_mod",          "to": "argentina_mod",   "type": "land"},
    {"from": "peru_mod",            "to": "chile_mod",       "type": "land"},
    {"from": "argentina_mod",       "to": "chile_mod",       "type": "land"},
    {"from": "peru_mod",            "to": "argentina_mod",   "type": "land"},

    # Europe internal
    {"from": "uk_mod",          "to": "france_mod",         "type": "sea"},
    {"from": "uk_mod",          "to": "scandinavia_mod",    "type": "sea"},
    {"from": "france_mod",      "to": "germany_mod",        "type": "land"},
    {"from": "france_mod",      "to": "iberia_mod",         "type": "land"},
    {"from": "france_mod",      "to": "italy_mod",          "type": "land"},
    {"from": "germany_mod",     "to": "scandinavia_mod",    "type": "sea"},
    {"from": "germany_mod",     "to": "italy_mod",          "type": "land"},
    {"from": "germany_mod",     "to": "poland_baltics_mod", "type": "land"},
    {"from": "germany_mod",     "to": "balkans_mod",        "type": "land"},
    {"from": "italy_mod",       "to": "balkans_mod",        "type": "sea"},
    {"from": "balkans_mod",     "to": "turkey_mod",         "type": "land"},
    {"from": "balkans_mod",     "to": "ukraine_mod",        "type": "land"},

    # Russia/CIS internal and borders
    {"from": "poland_baltics_mod", "to": "ukraine_mod",        "type": "land"},
    {"from": "poland_baltics_mod", "to": "russia_west_mod",    "type": "land"},
    {"from": "poland_baltics_mod", "to": "scandinavia_mod",    "type": "sea"},
    {"from": "ukraine_mod",        "to": "russia_west_mod",    "type": "land"},
    {"from": "ukraine_mod",        "to": "turkey_mod",         "type": "sea"},
    {"from": "russia_west_mod",    "to": "russia_east_mod",    "type": "land"},
    {"from": "russia_west_mod",    "to": "central_asia_mod",   "type": "land"},
    {"from": "russia_west_mod",    "to": "scandinavia_mod",    "type": "land"},
    {"from": "russia_east_mod",    "to": "central_asia_mod",   "type": "land"},
    {"from": "russia_east_mod",    "to": "china_west_mod",     "type": "land"},
    {"from": "russia_east_mod",    "to": "korea_mod",          "type": "land"},
    {"from": "russia_east_mod",    "to": "japan_mod",          "type": "sea"},

    # Middle East & North Africa internal
    {"from": "turkey_mod",  "to": "levant_mod",        "type": "land"},
    {"from": "turkey_mod",  "to": "iran_mod",          "type": "land"},
    {"from": "levant_mod",  "to": "egypt_mod",         "type": "land"},
    {"from": "levant_mod",  "to": "iran_mod",          "type": "land"},
    {"from": "levant_mod",  "to": "saudi_mod",         "type": "land"},
    {"from": "egypt_mod",   "to": "maghreb_mod",       "type": "land"},
    {"from": "egypt_mod",   "to": "saudi_mod",         "type": "sea"},
    {"from": "egypt_mod",   "to": "sudan_horn_mod",    "type": "land"},
    {"from": "iran_mod",    "to": "saudi_mod",         "type": "sea"},
    {"from": "iran_mod",    "to": "pakistan_afghan_mod","type": "land"},
    {"from": "iran_mod",    "to": "central_asia_mod",  "type": "land"},
    {"from": "saudi_mod",   "to": "sudan_horn_mod",    "type": "sea"},

    # Sub-Saharan Africa internal
    {"from": "maghreb_mod",        "to": "west_africa_mod",     "type": "land"},
    {"from": "maghreb_mod",        "to": "iberia_mod",          "type": "sea"},
    {"from": "maghreb_mod",        "to": "sudan_horn_mod",      "type": "land"},
    {"from": "west_africa_mod",    "to": "nigeria_mod",         "type": "land"},
    {"from": "nigeria_mod",        "to": "central_africa_mod",  "type": "land"},
    {"from": "central_africa_mod", "to": "east_africa_mod",     "type": "land"},
    {"from": "central_africa_mod", "to": "southern_africa_mod", "type": "land"},
    {"from": "central_africa_mod", "to": "sudan_horn_mod",      "type": "land"},
    {"from": "east_africa_mod",    "to": "sudan_horn_mod",      "type": "land"},
    {"from": "east_africa_mod",    "to": "southern_africa_mod", "type": "land"},

    # Asia internal
    {"from": "pakistan_afghan_mod", "to": "india_mod",            "type": "land"},
    {"from": "pakistan_afghan_mod", "to": "central_asia_mod",     "type": "land"},
    {"from": "pakistan_afghan_mod", "to": "china_west_mod",       "type": "land"},
    {"from": "india_mod",          "to": "china_west_mod",       "type": "land"},
    {"from": "india_mod",          "to": "china_east_mod",       "type": "land"},
    {"from": "india_mod",          "to": "southeast_asia_mod",   "type": "land"},
    {"from": "china_west_mod",     "to": "china_east_mod",       "type": "land"},
    {"from": "china_west_mod",     "to": "central_asia_mod",     "type": "land"},
    {"from": "china_east_mod",     "to": "korea_mod",            "type": "land"},
    {"from": "china_east_mod",     "to": "southeast_asia_mod",   "type": "land"},
    {"from": "china_east_mod",     "to": "japan_mod",            "type": "sea"},
    {"from": "japan_mod",          "to": "korea_mod",            "type": "sea"},
    {"from": "southeast_asia_mod", "to": "indonesia_mod",        "type": "sea"},
    {"from": "indonesia_mod",      "to": "australia_mod",        "type": "sea"},

    # Cross-continental sea routes
    {"from": "usa_east_mod",        "to": "uk_mod",          "type": "sea"},
    {"from": "brazil_mod",          "to": "west_africa_mod", "type": "sea"},
    {"from": "canada_mod",          "to": "russia_east_mod", "type": "sea"},
    {"from": "india_mod",           "to": "east_africa_mod", "type": "sea"},
    {"from": "australia_mod",       "to": "chile_mod",       "type": "sea"},
    {"from": "indonesia_mod",       "to": "japan_mod",       "type": "sea"},
]

MAP_DATA = {
    "map_id":            "era_modern",
    "name":              "The Modern Day",
    "description":       "The world as it stands today. Command the United States, lead the European Union, direct the rising power of China, build alliances across Africa, or dominate the Pacific Rim in a struggle for 21st-century supremacy.",
    "era_theme":         "modern",
    "canvas_width":      1200,
    "canvas_height":     700,
    "territories":       territories,
    "connections":       connections,
    "regions":           regions,
    "is_public":         True,
    "is_moderated":      True,
    "moderation_status": "approved",
    "creator_id":        "system",
}

if __name__ == "__main__":
    print(json.dumps(MAP_DATA, indent=2))
    print(f"\n{len(territories)} territories · {len(connections)} connections · {len(regions)} regions")
