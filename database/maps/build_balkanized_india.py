"""
Balkanized India — the subcontinent fractured into rival successor powers.
Reference genre: r/imaginarymaps "balkanized India / Mughal collapse / regional sultanates".

geo_polygon outlines trace the real coastlines (Arabian Sea, Bay of Bengal, Indian
Ocean), the Himalayan wall, the Western & Eastern Ghats, the Indus/Ganges/Brahmaputra
river systems, and the Thar desert. Sri Lanka (Lanka) is an island joined by sea links.
Built via mapkit.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from mapkit import build_map

BOUNDS = {"minLng": 66.0, "maxLng": 98.0, "minLat": 6.0, "maxLat": 36.0}

REGIONS = [
    {"region_id": "kashmir",   "name": "Kashmir & the Himalaya", "bonus": 3},
    {"region_id": "punjab",    "name": "Sikh Punjab",            "bonus": 3},
    {"region_id": "rajputana", "name": "Rajputana",              "bonus": 3},
    {"region_id": "hindustan", "name": "Hindustan",              "bonus": 6},
    {"region_id": "bengal",    "name": "Bengal",                 "bonus": 4},
    {"region_id": "gujarat",   "name": "Gujarat",                "bonus": 3},
    {"region_id": "maratha",   "name": "Maratha Confederacy",    "bonus": 5},
    {"region_id": "dravidia",  "name": "Dravidian South",        "bonus": 5},
    {"region_id": "lanka",     "name": "Lanka",                  "bonus": 2},
]

# (territory_id, name, region_id, geo_polygon [[lng,lat],...])
T = [
    # --- Kashmir & the Himalaya (far north) ---
    ("kashmir_vale", "Vale of Kashmir", "kashmir", [
        [73.5,34.0],[75.0,34.6],[76.5,35.0],[77.5,35.0],[77.0,33.8],[75.5,33.2],
        [74.0,33.4],[73.5,34.0]]),
    ("ladakh", "Ladakh & the High Passes", "kashmir", [
        [77.5,35.0],[79.5,34.6],[80.0,33.0],[79.0,32.0],[77.5,32.4],[77.0,33.8],
        [77.5,35.0]]),
    ("himalaya", "Garhwal & Kumaon", "kashmir", [
        [77.5,32.4],[79.0,32.0],[81.0,30.8],[82.5,30.0],[81.0,29.4],[79.0,29.8],
        [77.6,30.6],[77.5,32.4]]),

    # --- Sikh Punjab (NW, between Indus and Sutlej) ---
    ("lahore", "Lahore", "punjab", [
        [73.0,32.6],[74.5,32.8],[75.5,31.6],[75.0,30.6],[73.6,30.4],[72.6,31.4],
        [73.0,32.6]]),
    ("indus_punjab", "Indus Doab", "punjab", [
        [70.5,32.8],[73.0,32.6],[72.6,31.4],[71.2,30.4],[70.0,30.6],[69.6,31.8],
        [70.5,32.8]]),
    ("malwa_punjab", "Malwa & the Sutlej", "punjab", [
        [73.6,30.4],[75.0,30.6],[76.6,30.8],[77.0,29.6],[75.4,29.0],[74.0,29.2],
        [73.6,30.4]]),

    # --- Rajputana (NW desert, Thar) ---
    ("marwar", "Marwar & the Thar", "rajputana", [
        [69.6,31.8],[70.0,30.6],[71.2,30.4],[72.0,29.0],[73.0,27.6],[72.0,26.4],
        [70.6,26.8],[69.4,28.2],[68.8,29.8],[69.6,31.8]]),
    ("mewar", "Mewar & Ajmer", "rajputana", [
        [73.0,27.6],[75.4,29.0],[77.0,28.4],[76.4,26.8],[75.0,25.4],[73.6,25.0],
        [72.6,26.0],[73.0,27.6]]),
    ("dhundhar", "Jaipur & Dhundhar", "rajputana", [
        [75.4,29.0],[77.0,29.6],[78.2,28.8],[78.0,27.0],[77.0,26.4],[76.4,26.8],
        [77.0,28.4],[75.4,29.0]]),

    # --- Hindustan (Gangetic north, Delhi-UP) ---
    ("delhi", "Delhi", "hindustan", [
        [76.6,30.8],[77.6,30.6],[78.6,29.8],[78.2,28.8],[77.0,29.6],[76.6,30.8]]),
    ("doab", "The Ganges-Yamuna Doab", "hindustan", [
        [78.2,28.8],[78.6,29.8],[80.0,28.8],[81.0,27.0],[79.4,26.4],[78.0,27.0],
        [78.2,28.8]]),
    ("agra", "Agra & Braj", "hindustan", [
        [77.0,27.0],[78.0,27.0],[79.4,26.4],[79.6,25.2],[78.0,24.8],[76.8,25.4],
        [77.0,26.4],[77.0,27.0]]),
    ("awadh", "Awadh", "hindustan", [
        [80.0,28.8],[81.0,29.4],[82.5,28.4],[83.4,27.2],[82.0,26.0],[81.0,27.0],
        [80.0,28.8]]),
    ("bundelkhand", "Bundelkhand", "hindustan", [
        [78.0,24.8],[79.4,26.4],[81.0,27.0],[82.0,26.0],[82.0,24.2],[81.0,23.4],
        [79.4,23.4],[78.0,24.8]]),
    ("kashi", "Kashi & Eastern Awadh", "hindustan", [
        [82.0,26.0],[83.4,27.2],[84.6,26.4],[84.8,25.2],[83.4,24.6],[82.0,24.2],
        [82.0,26.0]]),

    # --- Bengal (NE delta) ---
    ("bihar", "Bihar & Magadha", "bengal", [
        [84.6,26.4],[86.4,26.8],[87.6,26.0],[87.4,24.6],[85.8,24.4],[84.8,25.2],
        [84.6,26.4]]),
    ("gangetic_bengal", "Gauda & the Ganges Delta", "bengal", [
        [87.6,26.0],[89.0,26.2],[89.6,24.6],[89.0,22.8],[88.0,22.0],[87.0,22.4],
        [87.4,24.6],[87.6,26.0]]),
    ("dacca", "Dacca & the Eastern Delta", "bengal", [
        [89.0,26.2],[90.6,26.0],[92.0,24.8],[91.4,23.2],[90.6,22.6],[89.6,22.0],
        [89.0,22.8],[89.6,24.6],[89.0,26.2]]),
    ("assam", "Assam & the Brahmaputra", "bengal", [
        [90.6,26.0],[92.5,27.2],[94.6,27.6],[96.0,27.0],[95.0,26.0],[92.6,24.0],
        [92.0,24.8],[90.6,26.0]]),

    # --- Gujarat (west coast) ---
    ("kathiawar", "Kathiawar & Saurashtra", "gujarat", [
        [68.8,22.6],[70.4,22.8],[72.0,22.0],[72.4,20.8],[71.0,20.4],[69.6,20.8],
        [68.4,21.8],[68.8,22.6]]),
    ("gujarat_main", "Ahmedabad & the Gulf", "gujarat", [
        [70.6,26.8],[72.0,26.4],[73.0,25.0],[73.4,23.4],[72.6,22.4],[72.0,22.0],
        [70.4,22.8],[68.8,22.6],[68.8,24.0],[69.4,25.4],[70.6,26.8]]),
    ("malwa", "Malwa Plateau", "gujarat", [
        [73.4,23.4],[75.0,24.0],[76.8,24.0],[78.0,24.8],[78.6,23.0],[77.0,22.0],
        [75.0,21.8],[73.6,22.4],[73.4,23.4]]),

    # --- Maratha Confederacy (west-central Deccan) ---
    ("konkan", "Konkan Coast", "maratha", [
        [72.4,20.8],[73.4,20.4],[73.8,18.6],[74.0,16.6],[73.2,15.8],[72.8,17.4],
        [72.6,19.2],[72.4,20.8]]),
    ("desh", "Pune & the Desh", "maratha", [
        [73.4,20.4],[75.4,20.6],[76.6,19.4],[76.0,17.8],[74.6,16.8],[74.0,16.6],
        [73.8,18.6],[73.4,20.4]]),
    ("nagpur", "Berar & Nagpur", "maratha", [
        [75.0,21.8],[77.0,22.0],[79.4,23.4],[81.0,22.4],[80.6,20.8],[78.6,20.2],
        [76.6,19.4],[75.4,20.6],[75.0,21.8]]),
    ("khandesh", "Khandesh & Gondwana", "maratha", [
        [78.0,24.8],[79.4,23.4],[78.6,23.0],[78.0,24.8]]),

    # --- Dravidian South (Tamil/Telugu/Kannada peninsula) ---
    ("hyderabad", "Golconda & the Telangana Deccan", "dravidia", [
        [76.0,17.8],[76.6,19.4],[78.6,20.2],[80.6,20.8],[81.4,18.6],[80.4,16.6],
        [78.6,16.4],[77.0,16.6],[76.0,17.8]]),
    ("andhra", "Andhra & the Coromandel", "dravidia", [
        [78.6,16.4],[80.4,16.6],[81.4,18.6],[83.6,18.2],[84.8,16.0],[82.6,13.8],
        [80.6,13.2],[79.8,14.6],[78.4,14.4],[78.6,16.4]]),
    ("karnata", "Karnataka & the Kannada Country", "dravidia", [
        [74.6,16.8],[76.0,17.8],[77.0,16.6],[78.6,16.4],[78.4,14.4],[77.4,13.0],
        [76.4,11.0],[75.6,12.8],[74.4,13.8],[74.0,15.6],[74.6,16.8]]),
    ("malabar", "Malabar & Kerala", "dravidia", [
        [74.4,13.8],[75.6,12.8],[76.4,11.0],[77.0,8.6],[76.2,8.2],[75.0,10.0],
        [74.6,12.4],[74.4,13.8]]),
    ("tamil", "Tamil Nadu & the Carnatic", "dravidia", [
        [77.4,13.0],[78.4,14.4],[79.8,14.6],[80.6,13.2],[80.0,11.4],[79.4,9.6],
        [78.2,8.2],[77.0,8.6],[76.4,11.0],[77.4,13.0]]),

    # --- Lanka (Sri Lanka island) ---
    ("lanka_north", "Jaffna & the Vanni", "lanka", [
        [79.6,9.8],[80.8,9.6],[81.4,8.6],[80.6,8.0],[79.8,8.6],[79.6,9.8]]),
    ("lanka_south", "Kandy & the Hill Country", "lanka", [
        [79.8,8.6],[80.6,8.0],[81.4,8.6],[81.8,6.8],[80.4,6.0],[79.8,7.4],
        [79.8,8.6]]),
]

C = [
    # Kashmir & Himalaya
    ("kashmir_vale", "ladakh", "land"), ("kashmir_vale", "lahore", "land"),
    ("ladakh", "himalaya", "land"), ("himalaya", "delhi", "land"),
    ("himalaya", "doab", "land"), ("himalaya", "awadh", "land"),
    ("kashmir_vale", "indus_punjab", "land"),
    # Punjab
    ("lahore", "indus_punjab", "land"), ("lahore", "malwa_punjab", "land"),
    ("indus_punjab", "malwa_punjab", "land"), ("indus_punjab", "marwar", "land"),
    ("malwa_punjab", "marwar", "land"), ("malwa_punjab", "dhundhar", "land"),
    ("malwa_punjab", "delhi", "land"),
    # Rajputana
    ("marwar", "mewar", "land"), ("marwar", "gujarat_main", "land"),
    ("mewar", "dhundhar", "land"), ("mewar", "gujarat_main", "land"),
    ("mewar", "malwa", "land"), ("dhundhar", "delhi", "land"),
    ("dhundhar", "agra", "land"), ("mewar", "agra", "land"),
    # Hindustan
    ("delhi", "doab", "land"), ("delhi", "agra", "land"),
    ("doab", "agra", "land"), ("doab", "awadh", "land"),
    ("agra", "bundelkhand", "land"), ("agra", "malwa", "land"),
    ("awadh", "kashi", "land"), ("awadh", "bundelkhand", "land"),
    ("bundelkhand", "kashi", "land"), ("bundelkhand", "malwa", "land"),
    ("bundelkhand", "khandesh", "land"), ("bundelkhand", "nagpur", "land"),
    ("kashi", "bihar", "land"),
    # Bengal
    ("bihar", "gangetic_bengal", "land"), ("bihar", "nagpur", "land"),
    ("gangetic_bengal", "dacca", "land"), ("gangetic_bengal", "nagpur", "land"),
    ("dacca", "assam", "land"), ("assam", "gangetic_bengal", "land"),
    ("gangetic_bengal", "andhra", "land"),
    # Gujarat
    ("kathiawar", "gujarat_main", "land"), ("gujarat_main", "malwa", "land"),
    ("malwa", "khandesh", "land"), ("malwa", "nagpur", "land"),
    ("kathiawar", "konkan", "sea"), ("gujarat_main", "konkan", "land"),
    # Maratha
    ("konkan", "desh", "land"), ("desh", "nagpur", "land"),
    ("desh", "khandesh", "land"), ("khandesh", "nagpur", "land"),
    ("malwa", "desh", "land"), ("desh", "hyderabad", "land"),
    ("desh", "karnata", "land"), ("konkan", "karnata", "land"),
    ("nagpur", "hyderabad", "land"),
    # Dravidian South
    ("hyderabad", "andhra", "land"), ("hyderabad", "karnata", "land"),
    ("andhra", "tamil", "land"), ("karnata", "tamil", "land"),
    ("karnata", "malabar", "land"), ("malabar", "tamil", "land"),
    ("nagpur", "andhra", "land"),
    # Lanka (island — sea links to Tamil Nadu)
    ("lanka_north", "lanka_south", "land"),
    ("lanka_north", "tamil", "sea"), ("lanka_south", "tamil", "sea"),
]

if __name__ == "__main__":
    build_map(
        map_id="community_balkanized_india",
        name="Balkanized India",
        description=(
            "The subcontinent shattered into rival successor states after the empire's "
            "fall — Sikh Punjab, Hindustan of the Gangetic plain, the Bengal delta, the "
            "Maratha Confederacy of the Deccan, the Dravidian south, Gujarat's merchant "
            "coast, Himalayan Kashmir, the Rajput desert kingdoms, and island Lanka. "
            "Mountains, monsoon rivers, and ocean coasts draw every frontier."
        ),
        bounds=BOUNDS,
        regions=REGIONS,
        territories=T,
        connections=C,
        globe_view={"center_lat": 21.0, "center_lng": 80.0, "altitude": 0.95},
    )
