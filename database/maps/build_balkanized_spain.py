"""
Balkanized Spain — the Iberian Peninsula fractured along its national/linguistic lines.
Reference genre: r/imaginarymaps "independent Catalonia / Basque / balkanized Iberia".

geo_polygon outlines trace the real Iberian coast and interior frontiers (Ebro, Tagus,
Guadalquivir, the Pyrenees and Cantabrian ranges). Built via mapkit.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from mapkit import build_map

BOUNDS = {"minLng": -10.0, "maxLng": 4.0, "minLat": 36.0, "maxLat": 44.0}

REGIONS = [
    {"region_id": "castile",    "name": "Crown of Castile",    "bonus": 5},
    {"region_id": "portugal",   "name": "Portugal",            "bonus": 4},
    {"region_id": "andalusia",  "name": "Andalusia",           "bonus": 3},
    {"region_id": "catalonia",  "name": "Catalonia",           "bonus": 3},
    {"region_id": "aragon",     "name": "Aragon & Valencia",   "bonus": 3},
    {"region_id": "galicia",    "name": "Galicia",             "bonus": 2},
    {"region_id": "basque",     "name": "Basque & Asturias",   "bonus": 2},
    {"region_id": "navarre",    "name": "Navarre & La Rioja",  "bonus": 2},
]

T = [
    # Portugal (Atlantic west)
    ("pt_north", "Minho & Douro", "portugal", [
        [-8.8,42.0],[-8.0,41.8],[-7.6,41.2],[-8.3,40.6],[-8.9,40.8],[-8.9,41.5],[-8.8,42.0]]),
    ("pt_center", "Estremadura", "portugal", [
        [-8.9,40.8],[-8.3,40.6],[-7.6,40.0],[-7.5,39.3],[-8.2,38.8],[-9.5,38.8],[-9.4,39.6],[-8.9,40.2],[-8.9,40.8]]),
    ("pt_south", "Alentejo & Algarve", "portugal", [
        [-9.5,38.8],[-8.2,38.8],[-7.4,38.2],[-7.4,37.2],[-8.6,37.0],[-9.0,37.6],[-9.5,38.8]]),
    # Galicia (NW)
    ("galicia_coast", "Galician Coast", "galicia", [
        [-9.3,43.0],[-8.7,43.5],[-7.8,43.7],[-7.2,43.5],[-7.6,42.6],[-8.2,42.2],[-8.9,42.0],[-9.3,42.5],[-9.3,43.0]]),
    ("galicia_inland", "Ourense & Lugo", "galicia", [
        [-7.2,43.5],[-6.9,43.4],[-6.8,42.4],[-7.2,41.9],[-8.2,42.2],[-7.6,42.6],[-7.2,43.5]]),
    # Basque & Asturias (Cantabrian north)
    ("asturias", "Asturias & Cantabria", "basque", [
        [-6.9,43.4],[-5.5,43.6],[-4.0,43.5],[-3.4,43.4],[-3.3,42.9],[-4.5,42.9],[-5.8,43.0],[-6.8,42.5],[-6.9,43.4]]),
    ("basque", "Basque Country", "basque", [
        [-3.4,43.4],[-2.4,43.4],[-1.7,43.3],[-1.6,42.8],[-2.5,42.6],[-3.3,42.9],[-3.4,43.4]]),
    # Navarre & La Rioja (upper Ebro)
    ("navarre", "Navarre", "navarre", [
        [-2.5,42.6],[-1.6,42.8],[-0.8,42.6],[-1.0,42.0],[-1.8,41.8],[-2.5,42.0],[-2.5,42.6]]),
    ("rioja", "La Rioja", "navarre", [
        [-3.3,42.9],[-2.5,42.6],[-2.5,42.0],[-1.8,41.8],[-2.6,41.6],[-3.4,42.0],[-3.3,42.9]]),
    # Catalonia (NE)
    ("catalonia_north", "Barcelona & Girona", "catalonia", [
        [0.7,42.8],[1.8,42.5],[3.2,42.4],[3.0,41.6],[2.0,41.3],[1.0,41.3],[0.7,41.8],[0.7,42.8]]),
    ("catalonia_west", "Lleida & the Pyrenees", "catalonia", [
        [-0.8,42.6],[0.7,42.8],[0.7,41.8],[0.4,41.2],[-0.6,41.2],[-0.8,42.0],[-0.8,42.6]]),
    ("tarragona", "Tarragona & the Ebro", "catalonia", [
        [0.4,41.2],[1.0,41.3],[1.0,40.8],[0.4,40.6],[0.0,40.9],[0.4,41.2]]),
    # Aragon & Valencia (east)
    ("aragon", "Aragon", "aragon", [
        [-1.0,42.0],[-0.8,42.6],[-0.6,41.2],[0.0,40.9],[-0.2,40.2],[-1.2,40.0],[-1.8,40.6],[-1.8,41.8],[-1.0,42.0]]),
    ("valencia", "Valencia", "aragon", [
        [0.0,40.9],[-0.2,40.2],[-0.4,39.4],[-0.2,38.4],[-0.9,38.1],[-1.2,39.0],[-1.0,40.0],[-0.5,40.6],[0.0,40.9]]),
    ("murcia", "Murcia & Alicante", "aragon", [
        [-0.9,38.1],[-0.5,38.0],[-0.7,37.4],[-1.6,37.4],[-2.0,38.0],[-1.2,38.3],[-0.9,38.1]]),
    # Castile (central core)
    ("leon", "León", "castile", [
        [-6.9,42.5],[-5.8,43.0],[-4.5,42.9],[-4.8,42.0],[-5.8,41.6],[-6.8,41.6],[-6.9,42.5]]),
    ("old_castile", "Old Castile", "castile", [
        [-4.5,42.9],[-3.3,42.9],[-3.4,42.0],[-2.6,41.6],[-3.6,41.0],[-4.8,41.2],[-4.8,42.0],[-4.5,42.9]]),
    ("madrid", "Madrid & the Sierra", "castile", [
        [-4.8,41.2],[-3.6,41.0],[-2.6,41.6],[-1.8,41.0],[-1.8,40.2],[-3.0,39.7],[-4.4,39.8],[-5.0,40.4],[-4.8,41.2]]),
    ("toledo", "Toledo & La Mancha", "castile", [
        [-4.4,39.8],[-3.0,39.7],[-1.8,40.2],[-1.2,39.2],[-2.6,38.5],[-4.0,38.6],[-4.6,38.9],[-4.4,39.8]]),
    ("extremadura", "Extremadura", "castile", [
        [-6.8,41.6],[-5.8,41.6],[-4.8,41.2],[-5.0,40.4],[-4.4,39.8],[-4.6,38.9],[-5.6,38.8],[-7.0,39.0],[-7.5,39.3],[-7.6,40.0],[-6.8,41.6]]),
    ("la_mancha", "Cuenca & Albacete", "castile", [
        [-1.8,40.2],[-1.2,40.0],[-0.2,40.2],[-0.9,38.1],[-1.2,38.3],[-2.0,38.0],[-2.6,38.5],[-1.2,39.2],[-1.8,40.2]]),
    # Andalusia (south)
    ("andalucia_west", "Western Andalusia", "andalusia", [
        [-7.4,38.2],[-5.6,38.8],[-4.6,38.9],[-4.8,37.6],[-5.2,36.8],[-6.3,36.2],[-7.4,37.0],[-7.4,38.2]]),
    ("andalucia_east", "Granada & Almería", "andalusia", [
        [-4.8,37.6],[-4.0,38.6],[-2.6,38.5],[-1.6,37.4],[-2.6,36.7],[-4.0,36.7],[-5.2,36.8],[-4.8,37.6]]),
    ("cordoba", "Córdoba & Jaén", "andalusia", [
        [-5.6,38.8],[-4.6,38.9],[-4.0,38.6],[-4.8,37.6],[-5.2,38.0],[-5.6,38.8]]),
]

C = [
    ("galicia_coast","galicia_inland","land"),("galicia_coast","asturias","land"),
    ("galicia_inland","asturias","land"),("galicia_inland","leon","land"),
    ("galicia_coast","pt_north","land"),("galicia_inland","pt_north","land"),
    ("asturias","leon","land"),("asturias","old_castile","land"),("asturias","basque","land"),
    ("basque","navarre","land"),("basque","rioja","land"),("basque","old_castile","land"),
    ("navarre","rioja","land"),("navarre","aragon","land"),
    ("rioja","aragon","land"),("rioja","old_castile","land"),
    ("leon","old_castile","land"),("leon","extremadura","land"),("leon","pt_north","land"),
    ("old_castile","madrid","land"),("old_castile","aragon","land"),
    ("madrid","toledo","land"),("madrid","extremadura","land"),("madrid","la_mancha","land"),("madrid","aragon","land"),
    ("toledo","extremadura","land"),("toledo","la_mancha","land"),("toledo","cordoba","land"),("toledo","andalucia_east","land"),
    ("extremadura","andalucia_west","land"),("extremadura","pt_center","land"),("extremadura","pt_south","land"),
    ("la_mancha","aragon","land"),("la_mancha","valencia","land"),("la_mancha","murcia","land"),("la_mancha","andalucia_east","land"),
    ("aragon","valencia","land"),("aragon","catalonia_west","land"),
    ("catalonia_west","catalonia_north","land"),("catalonia_west","tarragona","land"),
    ("catalonia_north","tarragona","land"),("tarragona","valencia","land"),
    ("valencia","murcia","land"),("murcia","andalucia_east","land"),
    ("cordoba","andalucia_west","land"),("cordoba","andalucia_east","land"),
    ("andalucia_west","andalucia_east","land"),("andalucia_west","pt_south","land"),
    ("pt_north","pt_center","land"),("pt_center","pt_south","land"),
]

if __name__ == "__main__":
    build_map(
        map_id="community_balkanized_spain",
        name="Balkanized Spain",
        description=(
            "The Iberian Peninsula shattered along its old national and linguistic faults — "
            "Castile, Portugal, Andalusia, Catalonia, Aragon-Valencia, Galicia, the Basque "
            "Country, and Navarre. A compact theater of mountain frontiers and river borders "
            "where every neighbor is a rival crown."
        ),
        bounds=BOUNDS,
        regions=REGIONS,
        territories=T,
        connections=C,
        globe_view={"center_lat": 40.0, "center_lng": -3.5, "altitude": 0.6},
    )
