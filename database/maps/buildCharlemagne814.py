"""
Borderfall — "Europe at the Death of Charlemagne, 814 A.D." regional map builder.

Authored from the reference map (Europe 814). Each territory is defined by a real
geographic outline (`geo_polygon`, [lng, lat] degrees) so borders are natural and
mirror the source image. The flat-canvas `polygon` and `center_point` are DERIVED
from the geo outline via the linear equirectangular `projection_bounds`, exactly the
way the Great Britain 925 regional map is built.

Run:  python3 database/maps/buildCharlemagne814.py
Emits: database/maps/community_charlemagne_814.json
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from mapkit import ring_defects  # noqa: E402  (shared geo-simplicity check)

MAP_ID = "community_charlemagne_814"

# --- Projection -------------------------------------------------------------
# Bounds frame the whole reference image: Ireland (W) to the Volga/Caspian (E),
# the Maghreb / Levant (S) to Scandinavia (N).
BOUNDS = {"minLng": -11.0, "maxLng": 56.0, "minLat": 29.0, "maxLat": 66.0}
# Canvas aspect chosen so the flat map is ~undistorted at mid-latitude (~47.5N):
#   W/H = lngSpan * cos(midLat) / latSpan  ≈ 67 * 0.676 / 37 ≈ 1.22
CANVAS_W = 1200
CANVAS_H = 980

# --- Regions (the coloured power-blocs of the reference map) ----------------
REGIONS = [
    {"region_id": "frankish",        "name": "Frankish Empire",          "bonus": 7},
    {"region_id": "britannia_isles", "name": "British Isles",            "bonus": 3},
    {"region_id": "al_andalus",      "name": "Iberia",                   "bonus": 2},
    {"region_id": "norse",           "name": "Scandinavia",              "bonus": 2},
    {"region_id": "eastern_roman",   "name": "Eastern Roman Empire",     "bonus": 3},
    {"region_id": "abbasid",         "name": "Abbasid Caliphate",        "bonus": 1},
    {"region_id": "slavic",          "name": "Slavic Tribes",            "bonus": 3},
    {"region_id": "balkan",          "name": "Balkans",                  "bonus": 2},
    {"region_id": "steppe",          "name": "Steppe Khaganates",        "bonus": 3},
    {"region_id": "northern_tribes", "name": "Baltic & Finnic Tribes",   "bonus": 2},
    {"region_id": "maghreb",         "name": "Maghreb",                  "bonus": 1},
]

# --- Territories ------------------------------------------------------------
# (territory_id, display name, region_id, geo_polygon[[lng,lat],...])
TERRITORIES = [
    # ===================== FRANKISH EMPIRE (green core) =====================
    ("brittannia", "Brittannia", "frankish", [
        [-4.8, 48.6], [-4.3, 48.8], [-2.5, 48.9], [-1.5, 48.7], [-1.6, 47.6],
        [-2.6, 47.3], [-4.2, 47.4], [-4.8, 47.9], [-4.8, 48.6]]),
    ("neustria", "Neustria", "frankish", [
        [-1.5, 48.7], [-0.2, 49.4], [1.5, 50.0], [2.6, 49.6], [3.2, 48.6],
        [2.8, 47.6], [1.5, 46.9], [0.0, 46.6], [-1.6, 47.6], [-1.5, 48.7]]),
    ("frisia", "Frisia", "frankish", [
        [2.6, 49.6], [4.5, 50.6], [6.4, 51.3], [7.7, 52.2], [8.5, 53.4],
        [7.0, 53.6], [5.4, 53.3], [4.3, 52.4], [4.0, 51.4], [3.4, 50.6],
        [2.6, 49.6]]),
    ("austrasia", "Austrasia", "frankish", [
        [4.5, 50.6], [6.4, 51.3], [7.7, 50.6], [8.2, 49.6], [7.6, 48.6],
        [6.2, 48.0], [4.8, 48.1], [3.6, 48.6], [3.2, 48.6], [3.6, 50.3],
        [4.5, 50.6]]),
    ("aquitania", "Aquitania", "frankish", [
        [-1.6, 47.6], [0.0, 46.6], [1.5, 46.9], [2.2, 45.6], [2.6, 44.2],
        [1.8, 43.2], [0.4, 42.9], [-1.4, 43.4], [-1.3, 45.0], [-1.1, 46.2],
        [-1.6, 47.6]]),
    ("burgundy", "Burgundy", "frankish", [
        [2.8, 47.6], [4.8, 48.1], [6.2, 48.0], [7.0, 46.6], [7.0, 45.1],
        [6.1, 44.0], [4.9, 43.5], [4.2, 44.4], [3.4, 45.4], [2.6, 44.2],
        [2.2, 45.6], [2.8, 46.6], [2.8, 47.6]]),
    ("gothia", "Gothia", "frankish", [
        [1.8, 43.2], [2.6, 44.2], [3.4, 45.4], [4.2, 44.4], [4.9, 43.5],
        [4.0, 43.0], [3.0, 42.5], [2.0, 42.5], [1.8, 43.2]]),
    ("marca_hispanica", "Marca Hispanica", "frankish", [
        [0.4, 42.9], [2.0, 42.5], [3.0, 42.5], [2.3, 41.4], [1.0, 40.9],
        [-0.2, 41.2], [-0.6, 42.2], [0.4, 42.9]]),
    ("saxony", "Saxony", "frankish", [
        [7.7, 52.2], [8.5, 53.4], [9.0, 54.0], [10.5, 53.9], [11.6, 53.3],
        [11.8, 52.2], [11.4, 51.0], [10.0, 50.7], [8.6, 50.7], [8.2, 49.6],
        [7.7, 50.6], [7.7, 52.2]]),
    ("bavaria", "Bavaria", "frankish", [
        [8.2, 49.6], [8.6, 50.7], [10.0, 50.7], [11.4, 51.0], [12.8, 50.2],
        [13.6, 48.9], [13.0, 47.6], [11.0, 47.2], [9.6, 47.4], [8.0, 47.6],
        [7.6, 48.6], [8.2, 49.6]]),
    ("eastern_march", "Carinthia & the Eastern March", "frankish", [
        [13.6, 48.9], [16.0, 48.7], [16.6, 47.6], [15.6, 46.5], [14.0, 46.2],
        [12.6, 46.5], [12.4, 47.5], [13.0, 47.6], [13.6, 48.9]]),
    ("frankish_italy", "Kingdom of Italy", "frankish", [
        [7.0, 45.1], [7.6, 45.9], [9.0, 46.4], [11.0, 46.8], [12.6, 46.5],
        [13.4, 45.7], [12.4, 44.6], [13.6, 43.5], [14.0, 42.3], [13.2, 41.4],
        [11.8, 42.4], [10.2, 43.9], [8.8, 44.4], [7.5, 44.0], [7.0, 45.1]]),

    # ========================= BRITISH ISLES ================================
    ("ireland", "Ireland", "britannia_isles", [
        [-10.2, 51.6], [-9.0, 53.4], [-9.6, 54.3], [-8.2, 55.3], [-6.3, 55.2],
        [-5.5, 54.1], [-6.2, 52.2], [-7.6, 51.5], [-10.2, 51.6]]),
    ("scotland", "Scotland", "britannia_isles", [
        [-5.6, 57.9], [-5.0, 58.6], [-3.0, 58.6], [-2.0, 57.5], [-2.2, 56.4],
        [-3.3, 56.0], [-5.0, 55.8], [-5.6, 56.6], [-5.8, 57.4], [-5.6, 57.9]]),
    ("northumbria", "Northumbria", "britannia_isles", [
        [-5.0, 55.8], [-3.3, 56.0], [-2.0, 55.5], [-1.2, 54.6], [-1.8, 53.6],
        [-3.2, 53.5], [-4.7, 54.2], [-5.0, 55.0], [-5.0, 55.8]]),
    ("mercia", "Mercia", "britannia_isles", [
        [-3.2, 53.5], [-1.8, 53.6], [-0.2, 53.2], [0.3, 52.2], [-0.6, 51.5],
        [-2.4, 51.6], [-3.0, 52.4], [-3.2, 53.5]]),
    ("wessex", "Wessex", "britannia_isles", [
        [-2.4, 51.6], [-0.6, 51.5], [0.8, 51.2], [1.4, 51.0], [0.0, 50.6],
        [-2.6, 50.6], [-4.0, 50.3], [-3.4, 51.0], [-2.4, 51.6]]),
    ("wales", "Wales", "britannia_isles", [
        [-3.0, 52.4], [-2.4, 51.6], [-3.4, 51.0], [-5.2, 51.6], [-4.8, 52.6],
        [-4.1, 53.2], [-3.2, 53.5], [-3.0, 52.4]]),

    # ===================== IBERIA (al-Andalus + N kingdoms) =================
    ("galicia_asturias", "Galicia & Asturias", "al_andalus", [
        [-9.0, 43.2], [-7.0, 43.6], [-4.5, 43.5], [-3.0, 43.3], [-3.4, 42.4],
        [-5.5, 42.2], [-7.6, 42.1], [-8.9, 42.3], [-9.0, 43.2]]),
    ("toledo", "Upper March (Toledo & Zaragoza)", "al_andalus", [
        [-3.4, 42.4], [-3.0, 43.3], [-1.0, 42.8], [-0.2, 41.2], [-1.4, 40.0],
        [-3.6, 39.6], [-5.6, 39.8], [-6.8, 40.6], [-6.2, 41.6], [-5.5, 42.2],
        [-3.4, 42.4]]),
    ("cordoba", "Emirate of Córdoba", "al_andalus", [
        [-6.8, 40.6], [-5.6, 39.8], [-3.6, 39.6], [-1.4, 40.0], [-0.4, 39.4],
        [-0.2, 38.0], [-1.8, 37.0], [-4.6, 36.7], [-6.3, 36.2], [-7.4, 37.2],
        [-8.9, 37.0], [-9.4, 38.7], [-8.8, 40.2], [-6.8, 40.6]]),

    # ============================ SCANDINAVIA ===============================
    ("norway", "Norsemen (Norway)", "norse", [
        [5.0, 58.6], [4.9, 60.6], [7.0, 63.0], [11.0, 64.6], [14.6, 65.6],
        [13.0, 63.4], [11.6, 61.4], [9.6, 60.0], [8.2, 58.6], [6.4, 58.0],
        [5.0, 58.6]]),
    ("denmark", "Danes (Denmark)", "norse", [
        [8.1, 54.8], [8.0, 56.0], [8.6, 57.6], [10.6, 57.7], [10.8, 56.2],
        [12.6, 56.0], [12.4, 54.8], [11.0, 54.4], [9.4, 54.4], [8.1, 54.8]]),
    ("sweden", "Swedes & Goths", "norse", [
        [11.6, 58.2], [12.0, 59.6], [14.6, 61.0], [17.4, 62.6], [18.6, 63.4],
        [17.2, 60.6], [16.6, 58.6], [16.4, 56.4], [14.6, 55.4], [12.6, 56.0],
        [11.6, 58.2]]),

    # ===================== EASTERN ROMAN (Byzantine) ========================
    ("thrace", "Thrace", "eastern_roman", [
        [22.0, 41.0], [24.0, 41.6], [26.6, 41.4], [28.2, 41.2], [29.2, 41.2],
        [27.4, 40.0], [25.6, 40.2], [23.8, 40.0], [22.4, 40.2], [22.0, 41.0]]),
    ("hellas", "Hellas", "eastern_roman", [
        [20.4, 39.6], [22.4, 40.2], [23.8, 40.0], [24.0, 38.4], [23.4, 37.0],
        [22.4, 36.6], [21.6, 37.2], [21.0, 38.4], [20.4, 39.6]]),
    ("roman_anatolia", "Anatolia", "eastern_roman", [
        [26.2, 39.6], [28.0, 40.6], [31.0, 41.6], [34.5, 42.0], [38.0, 40.8],
        [38.2, 39.0], [36.4, 37.0], [33.0, 36.2], [29.8, 36.6], [27.2, 37.4],
        [26.4, 38.6], [26.2, 39.6]]),
    ("byzantine_italy", "Calabria & Sicily", "eastern_roman", [
        [14.0, 42.3], [16.2, 41.4], [18.4, 40.2], [17.0, 39.0], [16.6, 38.0],
        [15.2, 37.9], [12.4, 37.6], [13.4, 38.4], [15.0, 40.0], [13.2, 41.4],
        [14.0, 42.3]]),

    # ===================== ABBASID CALIPHATE / LEVANT =======================
    ("armenia", "Armenia & the Caucasus", "abbasid", [
        [38.0, 40.8], [41.0, 41.6], [45.0, 41.8], [48.4, 41.0], [47.0, 39.2],
        [44.4, 38.4], [41.6, 38.4], [38.2, 39.0], [38.0, 40.8]]),
    ("syria", "Syria & the Jazira", "abbasid", [
        [36.4, 37.0], [38.2, 39.0], [41.6, 38.4], [44.4, 38.4], [44.0, 35.6],
        [42.0, 33.4], [39.0, 31.6], [36.4, 31.4], [35.6, 33.4], [36.0, 35.6],
        [36.4, 37.0]]),

    # ========================= SLAVIC TRIBES ================================
    ("pomerania", "Pomore (Pomerania)", "slavic", [
        [10.5, 53.9], [11.6, 54.4], [14.4, 54.6], [16.8, 54.6], [18.6, 54.6],
        [18.4, 53.4], [16.6, 52.8], [14.6, 52.6], [12.4, 52.6], [11.8, 53.3],
        [10.5, 53.9]]),
    ("bohemia_moravia", "Bohemia & Moravia", "slavic", [
        [12.0, 50.4], [13.4, 51.0], [15.0, 51.0], [16.6, 50.2], [17.8, 49.2],
        [17.0, 48.4], [16.0, 48.7], [13.6, 48.9], [12.8, 49.4], [12.0, 50.4]]),
    ("lechia", "Lechia (Sorbs & Vistulans)", "slavic", [
        [12.4, 52.6], [14.6, 52.6], [16.6, 52.8], [18.4, 53.4], [20.4, 53.2],
        [22.4, 51.6], [22.0, 50.2], [20.6, 49.6], [18.8, 49.4], [17.8, 49.2],
        [16.6, 50.2], [15.0, 51.0], [13.4, 51.0], [12.4, 52.6]]),
    ("ruthenia", "Dnieper Slavs (Kiev)", "slavic", [
        [22.0, 50.2], [22.4, 51.6], [24.6, 52.4], [27.6, 53.0], [31.0, 52.8],
        [33.0, 51.4], [33.4, 49.6], [31.6, 48.2], [29.0, 48.0], [26.4, 48.4],
        [24.0, 49.0], [22.0, 50.2]]),

    # ============================ BALKANS ===================================
    ("bulgaria", "First Bulgarian Empire", "balkan", [
        [22.4, 44.6], [25.6, 45.4], [28.6, 45.4], [29.4, 43.8], [28.2, 42.2],
        [26.6, 41.4], [24.0, 41.6], [22.6, 42.2], [22.4, 43.4], [22.4, 44.6]]),
    ("serbia", "Serbia & Rascia", "balkan", [
        [18.6, 45.4], [20.4, 45.2], [22.4, 44.6], [22.4, 43.4], [22.6, 42.2],
        [21.4, 41.4], [20.0, 41.6], [18.8, 42.6], [18.4, 43.6], [18.6, 45.4]]),
    ("croatia", "Croatia & Dalmatia", "balkan", [
        [13.4, 45.7], [15.6, 46.5], [17.6, 46.2], [18.6, 45.4], [18.4, 43.6],
        [17.2, 43.0], [16.0, 43.4], [14.6, 44.6], [13.6, 45.0], [13.4, 45.7]]),

    # ====================== STEPPE KHAGANATES ===============================
    ("avars", "Avar Khaganate", "steppe", [
        [16.0, 48.7], [17.0, 48.4], [19.0, 48.4], [21.4, 48.2], [22.0, 47.0],
        [21.4, 45.6], [20.4, 45.2], [18.6, 45.4], [17.6, 46.2], [16.6, 47.6],
        [16.0, 48.7]]),
    ("magyars", "Magyars", "steppe", [
        [29.0, 48.0], [31.6, 48.2], [33.4, 49.6], [36.0, 49.0], [38.6, 48.0],
        [40.0, 46.4], [38.0, 45.4], [34.0, 45.6], [31.0, 46.0], [28.6, 45.4],
        [25.6, 45.4], [26.0, 47.0], [29.0, 48.0]]),
    ("khazaria", "Khazar Khaganate", "steppe", [
        [38.0, 45.4], [40.0, 46.4], [43.0, 47.6], [47.0, 47.6], [49.6, 46.4],
        [49.0, 44.0], [48.4, 41.0], [45.0, 41.8], [42.0, 43.4], [39.6, 43.6],
        [38.0, 44.6], [38.0, 45.4]]),
    ("volga_bulgaria", "Volga Bulgars", "steppe", [
        [43.0, 47.6], [44.0, 50.0], [46.0, 51.6], [49.0, 52.0], [51.6, 51.0],
        [52.0, 49.0], [50.6, 47.4], [49.6, 46.4], [47.0, 47.6], [43.0, 47.6]]),

    # ===================== BALTIC & FINNIC TRIBES ===========================
    ("baltic", "Baltic Tribes", "northern_tribes", [
        [18.6, 54.6], [20.4, 55.4], [22.6, 56.4], [24.6, 57.6], [26.6, 57.8],
        [27.6, 56.4], [26.6, 54.6], [24.6, 53.6], [22.4, 53.4], [20.4, 53.2],
        [18.4, 53.4], [18.6, 54.6]]),
    ("finnic", "Finnic Tribes", "northern_tribes", [
        [21.0, 60.4], [22.0, 62.6], [25.0, 64.4], [29.0, 65.2], [31.6, 63.6],
        [31.0, 61.4], [29.0, 60.2], [26.0, 59.6], [23.0, 59.8], [21.0, 60.4]]),
    ("novgorod", "Northern Rus' (Novgorod)", "northern_tribes", [
        [27.6, 56.4], [29.0, 58.6], [31.6, 60.4], [35.0, 60.2], [38.0, 58.6],
        [40.0, 56.6], [38.6, 54.6], [35.4, 53.6], [33.0, 54.0], [31.0, 55.0],
        [28.6, 55.6], [27.6, 56.4]]),

    # ============================= MAGHREB ==================================
    ("ifriqiya", "Aghlabids (Ifriqiya)", "maghreb", [
        [8.0, 37.2], [10.2, 37.4], [11.4, 36.8], [11.0, 35.0], [10.4, 33.6],
        [8.6, 33.6], [7.4, 34.6], [6.6, 35.8], [8.0, 37.2]]),
    ("maghreb_west", "Idrisids & Rustamids", "maghreb", [
        [-9.6, 35.6], [-7.0, 35.4], [-4.0, 35.4], [-1.0, 35.8], [2.0, 36.6],
        [4.6, 36.8], [6.6, 35.8], [5.0, 34.0], [1.0, 33.6], [-3.0, 33.6],
        [-7.0, 33.4], [-9.4, 33.8], [-9.6, 35.6]]),
]

# --- Connections (geographic adjacency; "sea" = across water) ---------------
CONNECTIONS = [
    # Frankish internal
    ("brittannia", "neustria", "land"),
    ("neustria", "frisia", "land"), ("neustria", "austrasia", "land"),
    ("neustria", "aquitania", "land"), ("neustria", "burgundy", "land"),
    ("frisia", "austrasia", "land"), ("frisia", "saxony", "land"),
    ("austrasia", "saxony", "land"), ("austrasia", "burgundy", "land"),
    ("austrasia", "bavaria", "land"),
    ("saxony", "bavaria", "land"),
    ("bavaria", "burgundy", "land"), ("bavaria", "eastern_march", "land"),
    ("burgundy", "aquitania", "land"), ("burgundy", "gothia", "land"),
    ("burgundy", "frankish_italy", "land"),
    ("aquitania", "gothia", "land"), ("aquitania", "marca_hispanica", "land"),
    ("gothia", "marca_hispanica", "land"), ("gothia", "frankish_italy", "land"),
    ("eastern_march", "frankish_italy", "land"),
    # Frankish frontiers
    ("saxony", "denmark", "land"), ("frisia", "denmark", "sea"),
    ("saxony", "pomerania", "land"), ("saxony", "bohemia_moravia", "land"),
    ("bavaria", "bohemia_moravia", "land"),
    ("eastern_march", "bohemia_moravia", "land"),
    ("eastern_march", "avars", "land"), ("eastern_march", "croatia", "land"),
    ("frankish_italy", "croatia", "sea"),
    ("frankish_italy", "byzantine_italy", "land"),
    ("marca_hispanica", "toledo", "land"),
    ("wessex", "neustria", "sea"), ("brittannia", "wessex", "sea"),

    # British Isles
    ("ireland", "wales", "sea"), ("ireland", "scotland", "sea"),
    ("ireland", "northumbria", "sea"),
    ("scotland", "northumbria", "land"),
    ("northumbria", "mercia", "land"), ("northumbria", "wales", "land"),
    ("mercia", "wales", "land"), ("mercia", "wessex", "land"),
    ("wessex", "wales", "land"),
    ("northumbria", "denmark", "sea"), ("scotland", "norway", "sea"),

    # Iberia
    ("galicia_asturias", "toledo", "land"), ("galicia_asturias", "cordoba", "land"),
    ("toledo", "cordoba", "land"), ("galicia_asturias", "aquitania", "sea"),
    ("cordoba", "maghreb_west", "sea"),

    # Scandinavia
    ("norway", "sweden", "land"), ("norway", "denmark", "sea"),
    ("sweden", "denmark", "sea"), ("sweden", "baltic", "sea"),
    ("sweden", "finnic", "sea"), ("denmark", "pomerania", "sea"),

    # Eastern Roman
    ("thrace", "hellas", "land"), ("thrace", "roman_anatolia", "sea"),
    ("thrace", "bulgaria", "land"), ("thrace", "serbia", "land"),
    ("hellas", "roman_anatolia", "sea"), ("hellas", "byzantine_italy", "sea"),
    ("roman_anatolia", "armenia", "land"), ("roman_anatolia", "syria", "land"),
    ("byzantine_italy", "ifriqiya", "sea"),

    # Abbasid
    ("armenia", "syria", "land"), ("armenia", "khazaria", "land"),

    # Slavic
    ("pomerania", "lechia", "land"), ("pomerania", "baltic", "land"),
    ("bohemia_moravia", "lechia", "land"), ("bohemia_moravia", "avars", "land"),
    ("lechia", "baltic", "land"), ("lechia", "ruthenia", "land"),
    ("lechia", "avars", "land"),
    ("ruthenia", "magyars", "land"), ("ruthenia", "khazaria", "land"),
    ("ruthenia", "novgorod", "land"), ("ruthenia", "baltic", "land"),

    # Balkans
    ("bulgaria", "serbia", "land"), ("bulgaria", "magyars", "land"),
    ("bulgaria", "avars", "land"), ("serbia", "croatia", "land"),
    ("serbia", "avars", "land"),
    ("croatia", "avars", "land"),

    # Steppe
    ("avars", "magyars", "land"), ("magyars", "khazaria", "land"),
    ("khazaria", "volga_bulgaria", "land"),
    ("volga_bulgaria", "novgorod", "land"),

    # Northern tribes
    ("baltic", "novgorod", "land"), ("finnic", "novgorod", "land"),

    # Maghreb
    ("ifriqiya", "maghreb_west", "land"),
]


def project(lng, lat):
    """Linear equirectangular projection → flat canvas pixels (y is flipped)."""
    x = (lng - BOUNDS["minLng"]) / (BOUNDS["maxLng"] - BOUNDS["minLng"]) * CANVAS_W
    y = (BOUNDS["maxLat"] - lat) / (BOUNDS["maxLat"] - BOUNDS["minLat"]) * CANVAS_H
    return [round(x, 2), round(y, 2)]


def centroid(poly):
    """Area-weighted polygon centroid (canvas space)."""
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
    if abs(a) < 1e-9:  # degenerate fallback → arithmetic mean
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        return [round(sum(xs) / n, 2), round(sum(ys) / n, 2)]
    return [round(cx / (6 * a), 2), round(cy / (6 * a), 2)]


# Per-territory real-geometry refs (filled below): territory_id -> {"iso_codes":[...]} or
# {"geo_config":[{"iso":"FR","clip_bbox":[w,s,e,n]}, ...]}. Empty => geo_polygon fallback only.
ADMIN = {
    # ===================== FRANKISH EMPIRE =====================
    "brittannia": {"geo_config": [{"iso": "FR", "clip_bbox": [-5.1, 47.0, -1.2, 49.2]}]},
    "neustria": {"geo_config": [{"iso": "FR", "clip_bbox": [-1.9, 46.3, 3.5, 50.3]}]},
    "frisia": {"geo_config": [
        {"iso": "NL", "clip_bbox": [2.3, 49.3, 8.8, 53.9]},
        {"iso": "BE", "clip_bbox": [2.3, 49.3, 8.8, 53.9]},
        {"iso": "DE", "clip_bbox": [2.3, 49.3, 8.8, 53.9]},
    ]},
    "austrasia": {"geo_config": [
        {"iso": "FR", "clip_bbox": [2.9, 47.7, 8.5, 51.6]},
        {"iso": "DE", "clip_bbox": [2.9, 47.7, 8.5, 51.6]},
        {"iso": "BE", "clip_bbox": [2.9, 47.7, 8.5, 51.6]},
        {"iso": "LU", "clip_bbox": [2.9, 47.7, 8.5, 51.6]},
    ]},
    "aquitania": {"geo_config": [{"iso": "FR", "clip_bbox": [-1.9, 42.6, 2.9, 47.9]}]},
    "burgundy": {"geo_config": [
        {"iso": "FR", "clip_bbox": [1.9, 43.2, 7.3, 48.4]},
        {"iso": "CH", "clip_bbox": [1.9, 43.2, 7.3, 48.4]},
    ]},
    "gothia": {"geo_config": [{"iso": "FR", "clip_bbox": [1.5, 42.2, 5.2, 45.7]}]},
    "marca_hispanica": {"geo_config": [
        {"iso": "ES", "clip_bbox": [-0.9, 40.6, 3.3, 43.2]},
        {"iso": "AD", "clip_bbox": [-0.9, 40.6, 3.3, 43.2]},
    ]},
    "saxony": {"geo_config": [{"iso": "DE", "clip_bbox": [7.4, 49.3, 12.1, 54.3]}]},
    "bavaria": {"geo_config": [
        {"iso": "DE", "clip_bbox": [7.3, 46.9, 13.9, 51.3]},
        {"iso": "AT", "clip_bbox": [7.3, 46.9, 13.9, 51.3]},
    ]},
    "eastern_march": {"geo_config": [
        {"iso": "AT", "clip_bbox": [12.1, 45.9, 16.9, 49.2]},
        {"iso": "SI", "clip_bbox": [12.1, 45.9, 16.9, 49.2]},
    ]},
    "frankish_italy": {"geo_config": [{"iso": "IT", "clip_bbox": [6.7, 41.1, 14.3, 47.1]}]},

    # ========================= BRITISH ISLES ================================
    "ireland": {"geo_config": [
        {"iso": "IE", "clip_bbox": [-10.5, 51.2, -5.2, 55.6]},
        {"iso": "GB", "clip_bbox": [-10.5, 51.2, -5.2, 55.6]},
    ]},
    "scotland": {"geo_config": [{"iso": "GB", "clip_bbox": [-6.1, 55.5, -1.7, 58.9]}]},
    "northumbria": {"geo_config": [{"iso": "GB", "clip_bbox": [-5.3, 53.2, -0.9, 56.3]}]},
    "mercia": {"geo_config": [{"iso": "GB", "clip_bbox": [-3.5, 51.2, 0.6, 53.9]}]},
    "wessex": {"geo_config": [{"iso": "GB", "clip_bbox": [-4.3, 50.0, 1.7, 51.9]}]},
    "wales": {"geo_config": [{"iso": "GB", "clip_bbox": [-5.5, 50.7, -2.1, 53.8]}]},

    # ===================== IBERIA ===================
    "galicia_asturias": {"geo_config": [
        {"iso": "ES", "clip_bbox": [-9.3, 41.8, -2.7, 43.9]},
        {"iso": "PT", "clip_bbox": [-9.3, 41.8, -2.7, 43.9]},
    ]},
    "toledo": {"geo_config": [
        {"iso": "ES", "clip_bbox": [-7.1, 39.3, 0.1, 43.6]},
        {"iso": "PT", "clip_bbox": [-7.1, 39.3, 0.1, 43.6]},
    ]},
    "cordoba": {"geo_config": [
        {"iso": "ES", "clip_bbox": [-9.7, 35.9, 0.1, 40.9]},
        {"iso": "PT", "clip_bbox": [-9.7, 35.9, 0.1, 40.9]},
    ]},

    # ============================ SCANDINAVIA ===============================
    "norway": {"geo_config": [{"iso": "NO", "clip_bbox": [4.6, 57.7, 14.9, 65.9]}]},
    "denmark": {"geo_config": [{"iso": "DK", "clip_bbox": [7.7, 54.1, 12.9, 58.0]}]},
    "sweden": {"geo_config": [{"iso": "SE", "clip_bbox": [11.3, 55.1, 18.9, 63.7]}]},

    # ===================== EASTERN ROMAN ========================
    "thrace": {"geo_config": [
        {"iso": "GR", "clip_bbox": [21.7, 39.7, 29.5, 41.9]},
        {"iso": "TR", "clip_bbox": [21.7, 39.7, 29.5, 41.9]},
        {"iso": "BG", "clip_bbox": [21.7, 39.7, 29.5, 41.9]},
    ]},
    "hellas": {"geo_config": [{"iso": "GR", "clip_bbox": [20.1, 36.3, 24.3, 40.5]}]},
    "roman_anatolia": {"geo_config": [{"iso": "TR", "clip_bbox": [25.9, 35.9, 38.5, 42.3]}]},
    "byzantine_italy": {"geo_config": [{"iso": "IT", "clip_bbox": [12.1, 37.3, 18.7, 42.6]}]},

    # ===================== ABBASID / LEVANT =======================
    "armenia": {"geo_config": [
        {"iso": "AM", "clip_bbox": [37.7, 38.1, 48.7, 42.1]},
        {"iso": "AZ", "clip_bbox": [37.7, 38.1, 48.7, 42.1]},
        {"iso": "GE", "clip_bbox": [37.7, 38.1, 48.7, 42.1]},
        {"iso": "TR", "clip_bbox": [37.7, 38.1, 48.7, 42.1]},
    ]},
    "syria": {"geo_config": [
        {"iso": "SY", "clip_bbox": [35.3, 31.1, 44.7, 39.3]},
        {"iso": "IQ", "clip_bbox": [35.3, 31.1, 44.7, 39.3]},
        {"iso": "JO", "clip_bbox": [35.3, 31.1, 44.7, 39.3]},
        {"iso": "TR", "clip_bbox": [35.3, 31.1, 44.7, 39.3]},
    ]},

    # ========================= SLAVIC TRIBES ================================
    "pomerania": {"geo_config": [
        {"iso": "PL", "clip_bbox": [10.2, 52.3, 18.9, 54.9]},
        {"iso": "DE", "clip_bbox": [10.2, 52.3, 18.9, 54.9]},
    ]},
    "bohemia_moravia": {"geo_config": [
        {"iso": "CZ", "clip_bbox": [11.7, 48.1, 18.1, 51.3]},
        {"iso": "SK", "clip_bbox": [11.7, 48.1, 18.1, 51.3]},
    ]},
    "lechia": {"geo_config": [{"iso": "PL", "clip_bbox": [12.1, 48.9, 22.7, 53.7]}]},
    "ruthenia": {"geo_config": [
        {"iso": "UA", "clip_bbox": [21.7, 47.7, 33.7, 53.3]},
        {"iso": "BY", "clip_bbox": [21.7, 47.7, 33.7, 53.3]},
    ]},

    # ============================ BALKANS ===================================
    "bulgaria": {"geo_config": [
        {"iso": "BG", "clip_bbox": [22.1, 41.1, 29.7, 45.7]},
        {"iso": "RO", "clip_bbox": [22.1, 41.1, 29.7, 45.7]},
    ]},
    "serbia": {"geo_config": [
        {"iso": "RS", "clip_bbox": [18.1, 41.1, 22.9, 45.7]},
        {"iso": "MK", "clip_bbox": [18.1, 41.1, 22.9, 45.7]},
    ]},
    "croatia": {"geo_config": [
        {"iso": "HR", "clip_bbox": [13.1, 42.7, 18.9, 46.8]},
        {"iso": "BA", "clip_bbox": [13.1, 42.7, 18.9, 46.8]},
    ]},

    # ====================== STEPPE KHAGANATES ===============================
    "avars": {"geo_config": [
        {"iso": "HU", "clip_bbox": [15.7, 44.9, 22.3, 49.0]},
        {"iso": "RO", "clip_bbox": [15.7, 44.9, 22.3, 49.0]},
    ]},
    "magyars": {"geo_config": [
        {"iso": "UA", "clip_bbox": [25.3, 45.1, 40.3, 49.9]},
        {"iso": "RO", "clip_bbox": [25.3, 45.1, 40.3, 49.9]},
        {"iso": "MD", "clip_bbox": [25.3, 45.1, 40.3, 49.9]},
    ]},
    "khazaria": {"geo_config": [{"iso": "RU", "clip_bbox": [37.7, 40.7, 49.9, 47.9]}]},
    "volga_bulgaria": {"geo_config": [{"iso": "RU", "clip_bbox": [42.7, 46.1, 52.3, 52.3]}]},

    # ===================== BALTIC & FINNIC TRIBES ===========================
    "baltic": {"geo_config": [
        {"iso": "LT", "clip_bbox": [18.1, 52.9, 27.9, 58.1]},
        {"iso": "LV", "clip_bbox": [18.1, 52.9, 27.9, 58.1]},
    ]},
    "finnic": {"geo_config": [{"iso": "FI", "clip_bbox": [20.7, 59.3, 31.9, 65.5]}]},
    "novgorod": {"geo_config": [{"iso": "RU", "clip_bbox": [27.3, 53.3, 40.3, 60.7]}]},

    # ============================= MAGHREB ==================================
    "ifriqiya": {"geo_config": [
        {"iso": "TN", "clip_bbox": [6.3, 33.3, 11.7, 37.7]},
        {"iso": "DZ", "clip_bbox": [6.3, 33.3, 11.7, 37.7]},
    ]},
    "maghreb_west": {"geo_config": [
        {"iso": "MA", "clip_bbox": [-9.9, 33.1, 6.9, 37.1]},
        {"iso": "DZ", "clip_bbox": [-9.9, 33.1, 6.9, 37.1]},
    ]},
}


def build():
    region_members = {r["region_id"]: [] for r in REGIONS}
    territories = []
    for tid, name, region_id, geo in TERRITORIES:
        canvas_poly = [project(lng, lat) for lng, lat in geo]
        terr = {
            "territory_id": tid,
            "name": name,
            "polygon": canvas_poly,
            "center_point": centroid(canvas_poly),
            "region_id": region_id,
            "geo_polygon": [[round(lng, 3), round(lat, 3)] for lng, lat in geo],
        }
        # Real Natural Earth geometry (geo_polygon kept as fallback). For this
        # historical map each territory clips its modern country(ies) to its OWN
        # authored shape (clip_polygon) — real coastlines, clean non-overlapping
        # borders. We drop the agents' per-entry clip_bbox (which overlapped).
        ref = ADMIN.get(tid, {})
        if "iso_codes" in ref:
            terr["iso_codes"] = ref["iso_codes"]
        if "geo_config" in ref:
            terr["geo_config"] = [{"iso": e["iso"]} for e in ref["geo_config"] if e.get("iso")]
            terr["clip_polygon"] = [terr["geo_polygon"]]
        territories.append(terr)
        region_members[region_id].append(tid)

    regions = [{
        "region_id": r["region_id"],
        "name": r["name"],
        "bonus": r["bonus"],
        "territory_ids": region_members[r["region_id"]],
    } for r in REGIONS]

    connections = [{"from": a, "to": b, "type": t} for a, b, t in CONNECTIONS]

    return {
        "map_id": MAP_ID,
        "name": "Europe — Death of Charlemagne, 814 A.D.",
        "description": (
            "Europe at the death of Charlemagne in 814. The Frankish Empire towers "
            "over the continent, ringed by the Eastern Roman and Abbasid worlds, "
            "the Emirate of Córdoba, the Norse north, and a frontier of Slavic, "
            "Bulgar, Avar, Magyar and Khazar peoples. Hold the Carolingian heartland "
            "or rise from the marches to inherit the empire."
        ),
        "era_theme": "custom",
        "canvas_width": CANVAS_W,
        "canvas_height": CANVAS_H,
        "projection_bounds": BOUNDS,
        "globe_view": {
            "lock_rotation": True,
            "center_lat": 48.5,
            "center_lng": 18.0,
            "altitude": 1.05,
        },
        "territories": territories,
        "connections": connections,
        "regions": regions,
        "is_public": True,
        "play_count": 0,
        "creator_id": "system",
    }


def validate(m):
    errors, warnings = [], []
    t_ids = {t["territory_id"] for t in m["territories"]}
    r_ids = {r["region_id"] for r in m["regions"]}

    if len(t_ids) != len(m["territories"]):
        errors.append("Duplicate territory IDs")
    for t in m["territories"]:
        if t["region_id"] not in r_ids:
            errors.append(f"{t['territory_id']}: unknown region {t['region_id']}")
        if len(t["polygon"]) < 3:
            errors.append(f"{t['territory_id']}: <3 polygon points")
        crosses, repeats = ring_defects(t.get("geo_polygon", []))
        if crosses:
            errors.append(f"{t['territory_id']}: geo_polygon self-intersects at edge pair {crosses[0]}")
        if repeats:
            errors.append(f"{t['territory_id']}: geo_polygon has a repeated (pinch) vertex at {repeats[0]}")
    seen = set()
    adj = {tid: set() for tid in t_ids}
    for c in m["connections"]:
        for end in ("from", "to"):
            if c[end] not in t_ids:
                errors.append(f"connection references unknown territory {c[end]}")
        key = frozenset([c["from"], c["to"]])
        if key in seen:
            warnings.append(f"duplicate connection {c['from']} <-> {c['to']}")
        seen.add(key)
        if c["from"] in adj and c["to"] in adj:
            adj[c["from"]].add(c["to"])
            adj[c["to"]].add(c["from"])

    # BFS connectivity
    start = m["territories"][0]["territory_id"]
    visited, queue = set(), [start]
    while queue:
        n = queue.pop()
        if n in visited:
            continue
        visited.add(n)
        queue.extend(adj[n] - visited)
    isolated = t_ids - visited
    if isolated:
        errors.append(f"isolated territories: {sorted(isolated)}")

    return errors, warnings


if __name__ == "__main__":
    m = build()
    errs, warns = validate(m)
    print(f"Territories: {len(m['territories'])}  "
          f"Regions: {len(m['regions'])}  "
          f"Connections: {len(m['connections'])}")
    for w in warns:
        print("  WARN:", w)
    if errs:
        for e in errs:
            print("  ERROR:", e)
        raise SystemExit("Validation failed.")
    print("Validation OK — fully connected graph.")

    out = os.path.join(os.path.dirname(__file__), f"{MAP_ID}.json")
    with open(out, "w") as f:
        json.dump(m, f, indent=2)
    print("Wrote", out)
