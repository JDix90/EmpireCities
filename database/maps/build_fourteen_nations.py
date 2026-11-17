"""
The 14 Nations — North America where no fleet ever came to stay.

Fourteen indigenous confederacies, each grown from a real nation or alliance,
hold the continent from Lingít Aaní to the K'iche' highlands. Every border
follows something on the ground: a river (the Missouri, the Mississippi, the
Ohio, the Rio Grande, the Saskatchewans, the Lerma–Santiago), a crest (the
Coast Mountains, the Cascades and Sierra Nevada, the Continental Divide, the
two Sierras Madre, the Appalachians), or a divide or frontier traced by hand
from the land itself (the Cross Timbers, the Mogollon Rim, the Ozark edge, the
height of land around Hudson Bay). Nothing is a grid line.

How it is built:

1. Land is Natural Earth ne_50m admin-0 (US, Canada, Mexico, Guatemala,
   Belize, El Salvador, Honduras) inside BOARD, minus the large lakes.
2. The land is cut by RIVERS (Natural Earth ne_10m river centerlines) and the
   hand-traced LINES. A line's loose end that stops short of another line or
   the shore is carried on to it, so every border closes.
3. Each face of the cut gets the territory whose claim point lies in it; a
   face nobody claims joins the neighbour it shares the longest border with,
   and an island goes to the nearest territory (islets under 400 km² drop).
4. The territories are simplified together (shapely coverage_simplify), so
   neighbours keep one shared border, then written as:
     frontend/public/geo/fourteen_nations_admin1.json  — the globe's outlines,
       one feature per territory, exterior rings clockwise (d3-geo fills a
       counter-clockwise ring as the rest of the world);
     database/maps/community_fourteen_nations.json     — the map (mapkit);
     frontend/public/maps/regional/community_fourteen_nations.json — its copy.

Inputs not in the repo (Natural Earth, public domain), from
https://github.com/nvkelso/natural-earth-vector/tree/master/geojson :
  ne_50m_lakes.geojson, ne_10m_rivers_lake_centerlines.geojson

Run:  python3 database/maps/build_fourteen_nations.py --ne-dir /path/to/geojson
Needs shapely >= 2.1 (GEOS >= 3.12, for coverage_simplify).
"""
import argparse
import json
import math
import os
import sys
from collections import defaultdict

import shapely
from shapely.geometry import LineString, Point, Polygon, box, mapping, shape
from shapely.geometry.polygon import orient
from shapely.ops import nearest_points, polygonize, unary_union
from shapely.strtree import STRtree

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
from mapkit import build_map  # noqa: E402

MAP_ID = "community_fourteen_nations"
SUBSET_PATH = os.path.join(REPO, "frontend", "public", "geo", "fourteen_nations_admin1.json")
PUBLIC_COPY = os.path.join(REPO, "frontend", "public", "maps", "regional", f"{MAP_ID}.json")
COUNTRIES = ("US", "CA", "MX", "GT", "BZ", "SV", "HN")
MIN_ISLAND_KM2 = 400
SIMPLIFY_DEG = 0.02          # globe outlines: about 2 km
OUTLINE_SIMPLIFY_DEG = 0.06  # geo_polygon fallback and the flat canvas

# The board: the coast to Yakutat; the interior of British Columbia to 53.5°N;
# the plains and Hudson Bay lowlands to 57°N; Quebec to about 54°N and the
# Côte-Nord to the Natashquan. Newfoundland, the Caribbean and Honduras east
# of Copán are off the board.
BOARD = Polygon([
    (-141.6, 60.4), (-138.0, 60.2), (-136.6, 59.75), (-135.2, 59.75), (-133.6, 58.9),
    (-132.6, 57.9), (-131.5, 56.8), (-130.2, 56.0), (-129.9, 55.5), (-129.0, 54.7),
    (-127.9, 53.9), (-127.4, 53.5), (-119.6, 53.5), (-118.8, 55.6), (-118.6, 57.2),
    (-86.0, 57.2), (-79.5, 53.6), (-70.0, 54.0), (-63.5, 53.2), (-61.8, 50.25), (-60.8, 49.5),
    (-59.9, 47.3), (-59.5, 46.2), (-62.0, 40.0), (-75.5, 33.5), (-79.6, 30.5), (-79.6, 25.0),
    (-81.0, 24.15), (-84.3, 24.0), (-85.6, 21.4), (-86.6, 18.0), (-87.6, 16.0),
    (-88.0, 15.4), (-88.6, 14.4), (-88.0, 13.4), (-88.5, 12.5), (-95.0, 13.5),
    (-106.0, 18.0), (-111.0, 21.5), (-116.0, 27.5), (-122.0, 33.0), (-126.5, 40.0),
    (-129.0, 47.0), (-134.5, 52.5), (-141.6, 57.5),
])

# Rivers from ne_10m_rivers_lake_centerlines, by name, clipped to a box where the
# name is shared ("Red#N" is the Red River of the North). Natural Earth spells the
# Río Grande de Santiago without its í.
RIVERS = {
    "Missouri": None, "Yellowstone": None, "Mississippi": None, "Ohio": None, "Wabash": None,
    "Tennessee": None, "Arkansas": None, "Red": (-104, 30, -90, 36.6), "Red#N": (-98, 45.4, -96, 51),
    "Rio Grande": (-110, 24, -96, 39), "Pecos": None, "Colorado": (-118, 31, -105, 41.5),
    "San Juan": (-111.5, 36, -106, 38), "North Saskatchewan": None, "Lerma": (-102.5, 19, -99, 21),
    "Ro Grande de Santiago": (-106, 20, -102, 22.5), "Balsas": (-104, 17, -97, 20),
    "Savannah": None, "Tugaloo": None, "Tombigbee": None, "Illinois": None, "Kankakee": None,
    "Roanoke": None, "Chattahoochee": (-85.3, 29.5, -84.5, 30.75), "Altamaha": None,
}
# Border rivers whose source (or mouth) must be carried on to the divide or shore it
# stops short of; every other river only closes the small gap at its mouth.
REACHING_RIVERS = {"North Saskatchewan", "Lerma", "Tombigbee", "Colorado", "Tugaloo", "Savannah",
                   "Roanoke", "Altamaha"}

# Hand-traced borders, [lng, lat]. An end may stop a little short of, or overshoot,
# the line or shore it meets.
LINES = {
    # Mountains
    "coast_mountains": [(-127.5, 53.7), (-127.4, 53.5), (-126.4, 52.4), (-125.2, 51.3), (-123.8, 50.3), (-122.4, 49.6), (-121.5, 49.2)],
    "cascade_sierra": [(-121.5, 49.2), (-121.2, 48.3), (-121.3, 47.4), (-121.5, 46.6), (-121.75, 45.6), (-121.8, 44.6),
                       (-122.1, 43.5), (-122.2, 42.4), (-122.0, 41.4), (-121.5, 40.5), (-120.7, 39.7), (-120.15, 39.1),
                       (-119.6, 38.4), (-119.2, 37.8), (-118.75, 37.1), (-118.3, 36.4), (-118.25, 35.7), (-118.55, 35.05),
                       (-117.9, 34.35), (-117.0, 34.15), (-116.65, 33.6), (-116.45, 32.9), (-115.9, 32.65), (-114.6, 32.75)],
    "continental_divide": [(-119.9, 53.9), (-119.1, 53.4), (-118.5, 52.9), (-117.6, 52.2), (-116.4, 51.45), (-115.6, 50.7),
                           (-114.7, 49.6), (-114.1, 49.0), (-113.4, 48.35), (-112.75, 47.3), (-112.35, 46.5), (-112.6, 45.75),
                           (-113.45, 44.97), (-112.3, 44.55), (-111.1, 44.5), (-110.4, 44.35), (-110.05, 43.75), (-109.1, 42.6),
                           (-108.4, 42.0), (-107.5, 41.7), (-106.9, 41.2), (-106.35, 40.6), (-105.85, 39.8), (-106.1, 39.35),
                           (-106.3, 38.55), (-106.7, 37.85), (-106.8, 37.45), (-106.55, 36.95), (-107.0, 36.1), (-107.7, 35.45),
                           (-108.3, 35.25), (-108.15, 34.3), (-108.3, 33.3), (-108.25, 32.75), (-108.55, 31.85), (-108.6, 31.2)],
    # The Sierra Madre Occidental's edge: Yoeme on the coastal plain, Rarámuri in the barrancas.
    "sierra_madre_occidental": [(-108.6, 31.2), (-108.9, 30.2), (-108.7, 29.0), (-108.4, 28.0), (-107.9, 27.0), (-107.3, 26.0),
                                (-106.6, 25.0), (-105.9, 24.0), (-105.4, 23.0), (-104.9, 22.2), (-104.3, 21.3)],
    # The Soto la Marina, then the crest of the Sierra Madre Oriental south to the isthmus.
    "sierra_madre_oriental": [(-97.55, 23.78), (-97.85, 23.85), (-98.2, 23.95), (-98.6, 23.85), (-98.95, 23.8), (-99.2, 23.7),
                              (-99.45, 23.5), (-99.4, 22.6), (-99.2, 21.6), (-98.6, 20.6), (-97.8, 19.8), (-97.3, 19.0),
                              (-96.9, 18.4), (-96.3, 17.9), (-95.4, 17.5), (-94.3, 17.2)],
    "appalachian_crest": [(-78.15, 42.0), (-78.4, 41.3), (-78.7, 40.6), (-78.9, 39.9), (-79.2, 39.3), (-79.6, 38.6), (-80.1, 37.9),
                          (-80.4, 37.3), (-80.9, 36.6), (-81.7, 36.1), (-82.4, 35.6), (-83.1, 35.1), (-83.8, 34.7), (-84.5, 34.1)],
    # The Front Range and the Sangre de Cristo, then south of the Pueblos to the Pecos.
    "front_range": [(-105.3, 41.0), (-105.3, 40.2), (-105.25, 39.3), (-105.0, 38.4), (-104.95, 37.6), (-105.1, 36.9), (-105.2, 36.3),
                    (-105.3, 35.6), (-105.5, 35.1), (-104.7, 34.9), (-104.45, 34.9)],
    "laramie_range": [(-106.4, 42.95), (-105.9, 42.3), (-105.65, 41.7), (-105.4, 41.2), (-105.3, 40.95)],
    # The Mogollon Rim, then the Jornada and the Sacramento Mountains' north end to the Pecos.
    "mogollon_rim": [(-114.25, 36.05), (-113.3, 35.5), (-112.5, 35.0), (-111.7, 34.55), (-110.9, 34.4), (-110.0, 34.15),
                     (-109.2, 33.9), (-108.5, 34.0), (-106.9, 33.95), (-105.6, 34.1), (-104.1, 34.3)],
    # Where the Canadian Shield's granite meets the farmland of the lower lakes.
    "canadian_shield_edge": [(-80.1, 44.85), (-79.3, 44.75), (-78.3, 44.65), (-77.0, 44.45), (-76.2, 44.25)],
    # The Cross Timbers and the 98th-meridian grass line: Comanchería west, Wichita and Caddo east.
    "cross_timbers": [(-98.8, 38.45), (-98.7, 37.7), (-98.55, 37.0), (-98.6, 36.4), (-98.45, 35.8), (-98.2, 35.4), (-98.0, 35.0),
                      (-98.1, 34.6), (-98.0, 34.1), (-98.2, 33.4), (-97.9, 32.7), (-97.6, 32.2), (-97.35, 31.6), (-97.0, 31.0),
                      (-96.6, 30.2), (-96.35, 29.6), (-95.6, 28.75), (-95.5, 28.6)],
    # The Osage Plains' edge of the Ozark Plateau, then the Boston Mountains east to the Mississippi.
    "ozark_edge": [(-94.6, 39.3), (-94.35, 38.7), (-94.1, 38.2), (-94.05, 37.6), (-94.3, 37.05), (-94.7, 36.45), (-94.85, 35.95),
                   (-94.6, 35.55), (-94.4, 35.45), (-93.5, 35.65), (-92.4, 35.6), (-91.4, 36.2), (-90.4, 36.5), (-89.45, 36.6)],
    # The Smoky Hill and the Kansas: Pawnee north, Wichita south.
    "smoky_hill": [(-98.8, 38.25), (-98.7, 38.9), (-97.6, 38.9), (-96.9, 39.05), (-96.0, 39.15), (-94.45, 39.12)],
    # Rivers traced by hand where Natural Earth's are fragmentary or missing
    "nelson": [(-98.0, 53.75), (-97.85, 53.95), (-97.4, 54.6), (-96.6, 55.4), (-95.9, 56.2), (-94.5, 56.4), (-93.3, 56.8), (-92.4, 57.15)],
    "saskatchewan": [(-105.0, 53.2), (-104.0, 53.4), (-102.3, 53.85), (-101.2, 53.8), (-100.2, 53.3), (-99.3, 53.15), (-99.1, 53.1)],
    "south_saskatchewan": [(-110.3, 50.7), (-110.0, 50.75), (-109.0, 50.9), (-107.6, 51.0), (-106.9, 51.7), (-106.65, 52.13),
                           (-106.0, 52.8), (-105.0, 53.2)],
    # The Winnipeg River and the Albany: the Ojibwe's lakes south, the Cree's muskeg north.
    "winnipeg_albany": [(-96.4, 50.6), (-95.6, 50.2), (-94.9, 49.8), (-94.5, 49.85), (-93.2, 50.2), (-91.8, 50.6), (-90.6, 51.1),
                        (-88.5, 51.25), (-86.5, 51.5), (-85.2, 51.6)],
    # The height of land between Hudson Bay and the St. Lawrence: Cree north of it.
    "height_of_land": [(-85.2, 51.6), (-82.5, 50.6), (-80.0, 49.9), (-77.5, 49.8), (-75.0, 50.6), (-73.0, 51.6), (-71.5, 53.8)],
    "st_lawrence": [(-76.35, 44.2), (-75.9, 44.35), (-75.5, 44.7), (-74.75, 45.0), (-74.0, 45.3), (-73.55, 45.5), (-73.1, 46.05),
                    (-72.55, 46.35), (-71.9, 46.6), (-71.2, 46.8), (-70.6, 47.1), (-70.0, 47.5), (-69.5, 48.0)],
    "st_maurice": [(-72.55, 46.3), (-72.65, 46.6), (-72.8, 47.0), (-73.1, 47.5), (-73.7, 48.0), (-74.2, 48.8), (-74.8, 49.7), (-75.3, 50.8)],
    # The Hudson, Lake Champlain and the Richelieu: one corridor from the sea to the St. Lawrence.
    "hudson_champlain": [(-73.95, 41.6), (-73.95, 42.1), (-73.75, 42.65), (-73.65, 43.1), (-73.6, 43.3), (-73.4, 43.6), (-73.38, 43.8),
                         (-73.35, 44.2), (-73.3, 44.55), (-73.35, 44.95), (-73.25, 45.5), (-73.1, 46.05), (-73.05, 46.1)],
    "potomac": [(-79.4, 39.2), (-78.77, 39.65), (-78.2, 39.7), (-77.73, 39.32), (-77.45, 39.1), (-77.05, 38.88), (-77.1, 38.4),
                (-76.6, 38.15), (-76.25, 37.95), (-76.2, 37.9)],
    "conchos": [(-107.85, 26.95), (-107.0, 27.2), (-106.4, 27.5), (-105.6, 27.85), (-105.2, 28.3), (-105.0, 28.9), (-104.6, 29.4),
                (-104.35, 29.6), (-104.3, 29.7)],
    "st_croix": [(-92.75, 45.65), (-92.65, 45.3), (-92.75, 44.9), (-92.8, 44.72)],
    "niagara": [(-79.07, 43.3), (-79.05, 43.0), (-78.9, 42.85), (-78.95, 42.7)],
    "st_clair_detroit": [(-82.4, 43.2), (-82.42, 42.95), (-82.5, 42.6), (-83.1, 42.32), (-83.15, 42.0), (-83.2, 41.9)],
    # The Northwest Coast
    "lingit_south": [(-134.0, 54.5), (-132.5, 54.6), (-131.2, 54.7), (-130.6, 54.8), (-130.05, 55.2), (-129.95, 55.9), (-129.6, 56.1)],
    "wakashan_north": [(-130.5, 52.9), (-129.2, 53.0), (-128.4, 53.3), (-127.3, 53.6)],
    # Across Vancouver Island at the Kwakwaka'wakw–Coast Salish line, then Desolation Sound.
    "salish_wakashan": [(-124.8, 48.5), (-124.6, 48.55), (-124.2, 48.9), (-124.4, 49.4), (-124.9, 49.8), (-125.0, 50.1), (-124.6, 50.35),
                        (-123.9, 50.45), (-123.5, 50.5)],
    # The Umpqua divide: Chinook and Kalapuya north, the Klamath rivers south.
    "oregon_california": [(-124.7, 43.3), (-123.8, 43.15), (-123.0, 43.1), (-121.9, 43.2)],
    # The Russian River and the Yuba; Cambria, the Temblor Range and the Tehachapi.
    "california_north_central": [(-123.3, 38.45), (-122.4, 38.5), (-121.6, 38.9), (-120.7, 39.3), (-120.0, 39.4)],
    "california_central_south": [(-121.2, 35.6), (-120.4, 35.35), (-119.5, 35.1), (-118.8, 35.0), (-118.35, 35.05)],
    # Baja: the Kumeyaay frontier at San Quintín and the Sierra San Pedro Mártir.
    "kumeyaay_cochimi": [(-116.3, 30.45), (-115.5, 30.6), (-114.9, 30.75), (-114.3, 30.8)],
    # The Columbia Plateau: the big bend of the Columbia, south of Spokane, Lolo Pass.
    "plateau_split": [(-121.4, 47.8), (-120.3, 47.45), (-119.4, 47.4), (-118.1, 47.35), (-117.0, 47.2), (-115.8, 46.9), (-114.6, 46.6),
                      (-113.7, 46.5), (-112.3, 46.45)],
    # The Blue Mountains and the Salmon River Mountains: the Plateau north, the Great Basin south.
    "plateau_south": [(-122.1, 44.6), (-120.9, 44.3), (-119.7, 44.45), (-118.6, 44.85), (-117.6, 44.95), (-116.75, 45.1), (-115.9, 45.3),
                      (-114.9, 45.25), (-113.9, 45.0), (-113.0, 44.95)],
    # The Great Basin
    # Hells Canyon, the Owyhee, then the Santa Rosa, Sonoma and Toiyabe ranges.
    "numu_newe": [(-116.9, 45.05), (-117.0, 44.3), (-117.05, 43.8), (-117.35, 43.3), (-117.6, 42.8), (-117.45, 42.2), (-117.3, 41.6),
                  (-117.25, 41.0), (-117.0, 40.4), (-117.1, 39.7), (-116.9, 39.1), (-116.6, 38.6), (-115.2, 38.4), (-113.8, 39.3)],
    # Mono Lake and Walker River country: Northern Paiute above, Southern Paiute and Timbisha below.
    "numu_nuwuvi": [(-119.6, 38.05), (-118.6, 38.1), (-117.6, 38.3), (-116.6, 38.6)],
    # The Wasatch, the crest of the Uintas, the Yampa, then the Park Range and Medicine Bow.
    "newe_nuuchiu": [(-113.8, 39.3), (-112.2, 40.2), (-111.6, 40.6), (-111.0, 40.72), (-110.2, 40.75), (-109.5, 40.8), (-108.95, 40.52),
                     (-108.2, 40.5), (-107.55, 40.5), (-106.85, 40.45), (-106.7, 40.8), (-106.3, 41.15), (-105.9, 41.25), (-105.3, 41.1)],
    # The Pine Valley Mountains and the Kaiparowits to Glen Canyon.
    "nuwuvi_nuuchiu": [(-113.8, 39.3), (-113.0, 38.3), (-111.8, 37.6), (-111.0, 36.9)],
    # The Tusas Mountains and the Taos Plateau: the San Luis Valley is Ute, Taos is Pueblo.
    "nuuchiu_pueblo": [(-106.75, 36.95), (-106.35, 36.8), (-105.95, 36.72), (-105.6, 36.7), (-105.35, 36.65), (-105.0, 36.62)],
    # The Southwest and the Sierra Madre
    # The Verde, the San Pedro and the Sierra de los Ajos: O'odham desert west, Apache mountains east.
    "san_pedro": [(-111.4, 34.7), (-111.4, 33.4), (-110.6, 32.6), (-110.2, 31.6), (-110.0, 31.3), (-109.3, 30.8), (-108.6, 30.5)],
    # The Río Mátape and the Sierra de Bacatete: O'odham above, the Yaqui and Mayo valleys below.
    "oodham_yoeme": [(-112.2, 28.4), (-111.3, 28.6), (-110.4, 28.8), (-109.6, 29.1), (-109.0, 29.4), (-108.5, 29.5)],
    "yoeme_south": [(-107.7, 23.4), (-106.2, 24.2), (-105.6, 24.5)],
    # The Concho and the Colorado of Texas: the Llano Estacado above, the Edwards Plateau below.
    "penateka_north": [(-103.1, 31.5), (-102.3, 31.4), (-101.5, 31.3), (-100.9, 31.4), (-100.44, 31.46), (-99.95, 31.6), (-99.45, 31.5),
                       (-99.0, 31.25), (-98.7, 31.05), (-98.45, 30.75), (-98.27, 30.58), (-97.95, 30.4), (-97.74, 30.27), (-97.3, 30.1),
                       (-96.87, 29.9), (-96.4, 29.6), (-96.0, 29.4)],
    # Mexico
    # The Nazas and the Laguna: Tepehuán and Zacateco country below, the Coahuiltecan north above.
    "coahuila_south": [(-106.4, 24.7), (-105.0, 25.0), (-103.8, 24.9), (-102.6, 24.8), (-101.5, 24.5), (-100.6, 24.1), (-99.8, 23.85),
                       (-99.5, 23.8)],
    # The Mezquital and the Sierra Gorda: the Chichimec frontier of the Valley of Mexico.
    "chichimeca_anahuac": [(-100.1, 19.95), (-99.6, 20.5), (-99.3, 20.9), (-98.6, 21.6)],
    # Zitácuaro and the Sierra de Angangueo: the old Tarascan–Aztec war frontier.
    "purepecha_anahuac": [(-100.55, 18.2), (-100.45, 18.8), (-100.3, 19.4), (-100.3, 20.3)],
    "anahuac_oaxaca": [(-98.0, 18.6), (-97.6, 18.8), (-97.2, 19.05)],
    "isthmus": [(-94.45, 18.4), (-94.5, 17.5), (-94.6, 16.8), (-94.4, 16.1), (-94.3, 15.8)],
    # The Maya
    "mayapan_south": [(-90.9, 19.4), (-90.3, 19.25), (-89.6, 19.0), (-89.0, 18.85), (-88.5, 18.7), (-88.25, 18.55), (-87.9, 18.6)],
    # The Chiapas and Cuchumatanes highlands' northern scarp: Petén lowlands north, K'iche' highlands south.
    "maya_highlands": [(-94.7, 17.05), (-93.4, 17.3), (-92.5, 17.1), (-91.6, 16.5), (-90.6, 15.9), (-89.6, 15.6), (-88.6, 15.7), (-88.0, 15.9)],
    # The northern plains and the Hudson Bay lowlands
    # The Sturgeon-Weir and Reindeer country, Cumberland House north.
    "nehiyaw_east": [(-102.3, 53.8), (-102.6, 54.6), (-102.8, 55.4), (-102.5, 56.3), (-102.3, 57.4)],
    # The Severn: Manitoba's Swampy Cree west of it, the Omushkego of the Bay coast east.
    "omushkego_west": [(-87.6, 56.15), (-88.4, 55.5), (-89.4, 54.8), (-90.3, 53.9), (-90.6, 53.0), (-90.6, 52.0), (-90.6, 51.0)],
    # The Harricana to James Bay: Omushkego west, Eeyou Istchee east.
    "eeyou_west": [(-79.6, 51.45), (-79.4, 50.6), (-79.2, 49.85), (-79.15, 49.6)],
    # The Cypress Hills and the Milk River divide: Blackfoot country west, the Assiniboine east.
    "niitsitapi_east": [(-110.0, 53.8), (-110.0, 51.0), (-109.5, 49.6), (-108.0, 48.6), (-107.8, 47.4)],
    # Three Forks to the divide.
    "missouri_headwaters": [(-111.4, 45.95), (-112.0, 46.0), (-112.75, 46.0)],
    "apsaalooke_east": [(-107.95, 47.75), (-107.6, 46.9), (-106.65, 46.2)],
    # The Powder River: the Crow's Bighorn country west, the Lakota's east.
    "powder": [(-105.4, 46.85), (-105.6, 45.6), (-106.0, 44.7), (-106.3, 43.9), (-106.35, 42.9), (-106.35, 42.75)],
    # The Owl Creek and Bridger mountains: the Bighorn Basin above, the Wind River below.
    "apsaalooke_south": [(-106.2, 43.05), (-107.0, 43.25), (-107.8, 43.45), (-108.8, 43.6), (-109.6, 43.55), (-110.1, 43.5)],
    # The North Platte to Fort Laramie, then the Niobrara to the Missouri.
    "lakota_south": [(-106.35, 42.8), (-104.5, 42.25), (-103.5, 42.6), (-101.5, 42.8), (-99.5, 42.75), (-97.95, 42.78), (-97.9, 42.9)],
    # The Heart River and the Sheyenne: the earth-lodge villages north, the Dakota prairie south.
    "mandan_south": [(-100.9, 46.6), (-99.0, 46.8), (-97.5, 47.3), (-96.6, 47.6)],
    # Leech Lake and Mille Lacs, the wild-rice frontier of Dakota and Ojibwe.
    "dakota_ojibwe": [(-96.95, 47.0), (-95.0, 46.6), (-93.7, 46.2), (-92.8, 45.9), (-92.75, 45.65)],
    # The Great Lakes
    # The Pigeon River and the Boundary Waters: Saulteaux west, the Lake Superior Ojibwe east.
    "saulteaux_east": [(-89.7, 47.85), (-90.2, 48.1), (-91.0, 48.3), (-91.7, 48.7), (-91.9, 49.4), (-91.5, 50.1), (-91.6, 50.8)],
    "saulteaux_south": [(-91.9, 46.85), (-92.15, 46.5), (-92.4, 46.1), (-92.7, 45.85), (-92.85, 45.6)],
    # The Chippewa and the Menominee: the northwoods above, the prairie lake country below.
    "ojibwe_potawatomi": [(-92.9, 45.75), (-91.0, 45.4), (-89.5, 45.4), (-88.0, 45.6), (-87.6, 45.1), (-87.5, 45.0)],
    # The Iowa River, Des Moines, the Raccoon and the Boyer.
    "iowa_line": [(-90.6, 41.45), (-91.0, 41.55), (-91.55, 41.65), (-92.05, 41.75), (-92.6, 41.85), (-93.2, 41.7), (-93.62, 41.6),
                  (-94.1, 41.75), (-94.6, 41.95), (-95.1, 42.05), (-95.4, 41.85), (-95.75, 41.65), (-96.1, 41.5)],
    # Rock Island to the Illinois River's great bend, and the Kankakee to the Wabash.
    "rock_hennepin": [(-90.6, 41.45), (-90.1, 41.4), (-89.6, 41.33), (-89.25, 41.3)],
    "kankakee_wabash": [(-87.5, 41.15), (-87.2, 40.8), (-86.95, 40.45), (-86.8, 40.35)],
    # The Grand and the Maumee.
    "potawatomi_odawa": [(-86.3, 43.05), (-85.0, 42.75), (-84.3, 42.25), (-83.6, 41.8), (-83.45, 41.7)],
    "potawatomi_ohio": [(-85.4, 40.7), (-84.8, 40.9), (-84.3, 41.25), (-83.5, 41.7), (-83.35, 41.75)],
    # The French River, Lake Nipissing, Lake Timiskaming and the Abitibi.
    "ojibwe_algonquin": [(-80.75, 45.9), (-80.4, 46.05), (-79.8, 46.25), (-79.7, 46.8), (-80.0, 47.5), (-80.6, 48.5), (-81.5, 49.5), (-82.6, 50.7)],
    # The Haudenosaunee and the Dawnland
    "oswego": [(-76.2, 43.6), (-76.0, 43.0), (-75.75, 42.5)],
    # The Catskills and the Finger Lakes' southern hills.
    "haudenosaunee_south": [(-73.85, 42.15), (-74.3, 42.2), (-74.8, 42.4), (-75.4, 42.7), (-76.3, 42.6), (-77.3, 42.4), (-78.15, 42.0)],
    # The Delaware–Susquehanna divide and the Pocono front.
    "delaware_susquehanna": [(-74.75, 42.5), (-75.4, 41.9), (-75.7, 41.4), (-76.0, 40.8), (-76.3, 40.2), (-76.15, 39.6), (-76.1, 39.45)],
    "lenape_wabanaki": [(-73.95, 41.65), (-73.5, 41.3), (-73.6, 41.0)],
    # The St. John River and the Notre Dame Mountains.
    "wabanaki_mikmaq": [(-65.8, 45.2), (-66.0, 46.0), (-66.6, 46.9), (-67.5, 47.6), (-68.3, 48.3), (-68.5, 48.5)],
    # French Creek and the Allegheny Front.
    "ohio_seneca": [(-80.5, 42.1), (-80.0, 41.4), (-79.3, 40.9), (-78.5, 40.5)],
    # The Southeast
    "big_sandy": [(-82.6, 38.45), (-82.5, 37.9), (-81.9, 37.5)],
    # Pine Mountain and the Cumberland Plateau's eastern escarpment.
    "pine_mountain": [(-81.9, 37.5), (-82.6, 37.15), (-83.67, 36.6), (-84.3, 36.25), (-84.8, 35.8), (-85.2, 35.3), (-85.45, 34.95)],
    "ohio_cherokee": [(-81.9, 37.5), (-81.2, 37.35), (-80.3, 37.25)],
    # The Coosa–Etowah valley's northern ridges.
    "cherokee_south": [(-83.2, 34.75), (-84.0, 34.35), (-84.8, 34.25), (-85.6, 34.3), (-86.35, 34.65)],
    "tombigbee_tennessee": [(-88.65, 34.4), (-88.4, 34.8), (-88.15, 35.1)],
    # The Flint to the Altamaha: Muscogee above, Timucua and Guale below.
    "flint_altamaha": [(-84.9, 30.75), (-84.55, 31.1), (-84.2, 31.5), (-83.6, 31.7), (-83.05, 31.8), (-82.6, 31.95)],
    # The Natchez hold the Mississippi's floodplain: the loess bluffs east, the Ouachita and Atchafalaya west.
    "natchez_east": [(-90.25, 35.15), (-90.0, 34.5), (-90.2, 33.6), (-90.6, 32.7), (-91.0, 31.9), (-91.0, 31.0), (-90.6, 30.5), (-90.25, 30.3)],
    "natchez_west": [(-91.35, 29.35), (-91.6, 29.9), (-91.75, 30.5), (-91.85, 31.2), (-92.1, 31.9), (-92.1, 32.5), (-92.4, 33.1),
                     (-92.8, 33.6), (-93.0, 34.1), (-92.9, 34.6), (-92.5, 35.2), (-92.4, 35.7)],
    # The Ouachita Mountains' western end and the Kiamichi.
    "wichita_caddo": [(-96.0, 33.6), (-95.6, 34.6), (-95.2, 35.4), (-94.2, 35.5)],
}

NATIONS = [
    ("salmon_league", "Salmon League"),
    ("acorn_league", "Acorn League"),
    ("numic", "Numic Confederacy"),
    ("pueblo_alliance", "Pueblo Alliance"),
    ("triple_alliance", "Triple Alliance"),
    ("mayapan", "League of Mayapán"),
    ("seven_fires", "Seven Council Fires"),
    ("iron_confederacy", "Iron Confederacy"),
    ("three_fires", "Council of Three Fires"),
    ("haudenosaunee", "Haudenosaunee"),
    ("dawnland", "Dawnland"),
    ("cahokia", "Cahokia"),
    ("muscogee", "Muscogee League"),
    ("caddo", "Caddo Confederacy"),
]

# (territory_id, name, nation, claim points [lng, lat]). A claim point is a place in
# the territory; every face of the cut that holds one belongs to it.
TERRITORIES = [
    # Salmon League — the Northwest Coast and the Columbia Plateau
    ("lingit", "Lingít & Haida", "salmon_league", [(-134.3, 58.4), (-135.25, 57.15), (-131.65, 55.4), (-132.1, 53.4), (-132.0, 53.0)]),
    ("wakashan", "Ts'msyen & Wakashan", "salmon_league", [(-128.1, 52.15), (-130.3, 54.3), (-127.4, 50.7), (-126.0, 49.6)]),
    ("coast_salish", "Coast Salish & Chinook", "salmon_league", [(-122.3, 47.6), (-123.4, 48.45), (-123.1, 49.25), (-122.7, 45.5), (-123.6, 47.8), (-123.1, 44.05)]),
    ("interior_salish", "Interior Salish", "salmon_league", [(-120.3, 50.7), (-119.5, 49.9), (-117.4, 47.75), (-114.1, 47.9), (-114.0, 46.9)]),
    ("sahaptin", "Sahaptin & Nimiipuu", "salmon_league", [(-120.5, 46.6), (-118.8, 45.7), (-117.0, 46.4), (-117.3, 45.3)]),
    # Acorn League — California and Baja
    ("yurok_pomo", "Yurok & Pomo", "acorn_league", [(-124.15, 40.8), (-123.2, 39.15), (-122.4, 40.6)]),
    ("ohlone_yokuts", "Ohlone & Yokuts", "acorn_league", [(-122.25, 37.8), (-121.5, 38.4), (-119.8, 36.75), (-121.75, 36.65)]),
    ("chumash_kumeyaay", "Chumash & Kumeyaay", "acorn_league", [(-119.7, 34.45), (-118.25, 34.05), (-117.15, 32.75), (-116.6, 31.85), (-115.45, 32.6)]),
    ("cochimi", "Cochimí & Pericú", "acorn_league", [(-111.34, 26.01), (-110.3, 24.15), (-112.4, 27.4), (-114.0, 28.5), (-113.5, 29.5)]),
    # Numic Confederacy — the Great Basin, and the Comanche plains
    ("numu", "Numu", "numic", [(-119.8, 39.5), (-119.05, 43.6), (-120.5, 41.5), (-118.7, 39.5), (-117.7, 40.97)]),
    ("nuwuvi", "Nuwuvi & Timbisha", "numic", [(-115.15, 36.17), (-113.6, 37.1), (-117.0, 34.9), (-118.4, 37.36), (-116.9, 36.5)]),
    ("newe", "Newe", "numic", [(-116.2, 43.6), (-112.45, 42.87), (-115.76, 40.83), (-111.9, 40.76), (-109.2, 41.6), (-110.8, 43.5), (-108.73, 42.83), (-107.5, 41.8)]),
    ("nuuchiu", "Nuuchiu", "numic", [(-111.66, 40.23), (-108.55, 39.06), (-109.55, 38.57), (-106.3, 39.25), (-107.88, 37.27), (-106.9, 40.0), (-105.9, 37.5), (-106.3, 37.75), (-105.8, 39.2), (-110.5, 37.55)]),
    ("comanche", "Nʉmʉnʉʉ", "numic", [(-101.83, 35.2), (-101.85, 33.58), (-103.5, 37.9), (-100.0, 37.75), (-102.5, 35.6)]),
    ("penateka", "Penateka", "numic", [(-98.5, 29.42), (-97.4, 27.8), (-100.4, 30.3), (-99.5, 28.5), (-100.6, 30.8)]),
    # Pueblo Alliance — the Southwest and the Sierra Madre
    ("dine", "Diné Bikéyah", "pueblo_alliance", [(-109.05, 35.68), (-111.65, 35.2), (-109.55, 36.15), (-108.2, 36.65), (-111.5, 36.3), (-113.2, 35.9), (-113.9, 35.98)]),
    ("pueblo", "Rio Grande Pueblos", "pueblo_alliance", [(-105.94, 35.69), (-106.65, 35.08), (-105.57, 36.41), (-107.6, 34.9), (-106.4, 35.9), (-105.8, 35.6)]),
    ("oodham", "O'odham", "pueblo_alliance", [(-110.97, 32.22), (-112.07, 33.45), (-110.95, 29.07), (-114.0, 35.2), (-113.0, 31.5)]),
    ("yoeme", "Yoeme & Yoreme", "pueblo_alliance", [(-109.93, 27.48), (-107.4, 24.8), (-108.99, 25.79), (-110.9, 27.95)]),
    ("nde", "Ndé & Rarámuri", "pueblo_alliance", [(-108.28, 32.77), (-106.78, 32.32), (-106.08, 28.63), (-107.6, 27.75), (-105.7, 32.9), (-109.5, 33.5), (-104.0, 31.0), (-103.5, 29.4)]),
    # Triple Alliance — Anáhuac and its provinces
    ("anahuac", "Anáhuac", "triple_alliance", [(-99.13, 19.43), (-98.2, 19.04), (-99.23, 18.92), (-99.66, 19.29), (-99.9, 19.9)]),
    ("huasteca", "Huasteca & Totonacapan", "triple_alliance", [(-97.86, 22.25), (-96.13, 19.18), (-97.32, 20.45), (-99.0, 21.99), (-95.5, 18.3)]),
    ("oaxaca", "Ñuu Savi & Zapoteca", "triple_alliance", [(-96.73, 17.06), (-99.9, 16.86), (-95.24, 16.32), (-98.5, 17.5)]),
    ("purepecha", "Purépecha", "triple_alliance", [(-101.58, 19.63), (-103.72, 19.24), (-103.4, 20.6), (-104.9, 21.5), (-106.2, 23.4)]),
    ("chichimeca", "Gran Chichimeca", "triple_alliance", [(-102.57, 22.77), (-100.98, 22.15), (-104.67, 24.02), (-102.3, 21.88), (-101.25, 21.0)]),
    ("coahuila", "Coahuiltec & Tamaulipec", "triple_alliance", [(-100.31, 25.67), (-101.0, 25.42), (-103.4, 25.54), (-98.5, 24.5), (-101.0, 28.0), (-98.3, 25.9)]),
    # League of Mayapán
    ("mayapan", "Mayapán", "mayapan", [(-89.62, 20.97), (-90.53, 19.85), (-87.47, 20.21)]),
    ("peten", "Petén & Usumacinta", "mayapan", [(-92.93, 17.99), (-89.62, 17.22), (-88.4, 17.5), (-91.98, 17.51)]),
    ("kiche", "K'iche' Highlands", "mayapan", [(-90.51, 14.63), (-91.52, 14.84), (-92.64, 16.74), (-89.19, 13.69), (-89.15, 14.84)]),
    # Seven Council Fires — the northern plains
    ("lakota", "Lakota", "seven_fires", [(-103.23, 44.08), (-101.5, 44.0), (-105.5, 44.29), (-103.0, 43.2), (-102.0, 46.3), (-106.2, 47.3)]),
    ("dakota", "Dakota", "seven_fires", [(-96.73, 43.55), (-93.27, 44.98), (-98.49, 45.46), (-93.4, 42.4), (-97.3, 46.6), (-94.0, 45.7)]),
    ("nakota", "Nakota & Mandan", "seven_fires", [(-104.6, 50.45), (-99.95, 49.85), (-101.3, 48.23), (-103.6, 48.15), (-106.6, 48.2), (-98.0, 51.0), (-97.6, 50.3)]),
    ("apsaalooke", "Apsáalooke", "seven_fires", [(-108.5, 45.78), (-106.96, 44.8), (-109.05, 44.53), (-111.04, 45.68), (-107.3, 46.4), (-108.0, 44.0)]),
    # Iron Confederacy — the Cree, and the Blackfoot who made peace with them
    ("niitsitapi", "Niitsitapi", "iron_confederacy", [(-114.07, 51.05), (-112.84, 49.69), (-111.9, 48.3), (-113.8, 52.27)]),
    ("nehiyaw", "Nehiyaw", "iron_confederacy", [(-113.0, 55.5), (-107.5, 55.5), (-108.0, 52.4), (-104.0, 54.5), (-112.5, 54.6)]),
    ("maskekowak", "Maskekowak", "iron_confederacy", [(-96.0, 55.5), (-97.85, 55.74), (-93.0, 54.5)]),
    ("omushkego", "Omushkego", "iron_confederacy", [(-84.0, 52.5), (-88.0, 54.0), (-80.8, 51.1), (-86.0, 55.2)]),
    ("eeyou", "Eeyou Istchee", "iron_confederacy", [(-78.0, 52.5), (-77.0, 50.5), (-75.5, 52.5)]),
    # Council of Three Fires — the upper Great Lakes
    ("ojibwe", "Ojibwe", "three_fires", [(-89.25, 48.38), (-87.4, 46.55), (-84.0, 46.6), (-82.0, 47.5), (-90.6, 46.3)]),
    ("saulteaux", "Saulteaux", "three_fires", [(-94.88, 47.47), (-93.5, 49.0), (-92.4, 47.0), (-94.8, 49.75), (-92.5, 50.0)]),
    ("odawa", "Odawa", "three_fires", [(-84.55, 42.8), (-85.62, 44.76), (-83.95, 43.42), (-82.2, 45.76)]),
    ("potawatomi", "Potawatomi", "three_fires", [(-87.63, 41.88), (-87.91, 43.04), (-89.4, 43.07), (-88.0, 44.5), (-85.59, 42.29), (-86.25, 41.68), (-90.5, 44.5)]),
    ("algonquin", "Omàmiwininì", "three_fires", [(-75.7, 45.6), (-78.4, 45.6), (-77.8, 48.1), (-75.97, 46.38), (-74.0, 45.9), (-79.0, 47.0)]),
    # Haudenosaunee
    ("kanienkehaka", "Kanien'kehá:ka & Oneida", "haudenosaunee", [(-74.2, 42.9), (-75.23, 43.1), (-74.3, 44.1), (-73.6, 44.6)]),
    ("onondaga_seneca", "Onondaga & Seneca", "haudenosaunee", [(-76.15, 43.05), (-77.6, 43.16), (-78.88, 42.89), (-78.43, 42.08), (-80.0, 42.0)]),
    ("susquehannock", "Susquehannock", "haudenosaunee", [(-76.88, 40.27), (-77.0, 41.24), (-77.86, 40.79), (-76.6, 39.29), (-75.9, 42.1)]),
    ("wendake", "Wendake", "haudenosaunee", [(-79.38, 43.7), (-81.25, 42.98), (-79.69, 44.39), (-77.5, 44.3)]),
    # Dawnland — the Eastern Algonquian league
    ("nitassinan", "Nitassinan", "dawnland", [(-71.07, 48.43), (-66.6, 50.3), (-71.21, 46.85), (-72.0, 48.6)]),
    ("mikmaq", "Mi'kma'ki", "dawnland", [(-63.65, 44.7), (-64.78, 46.09), (-64.6, 48.85), (-60.19, 46.14), (-63.2, 46.3)]),
    ("wabanaki", "Wabanaki", "dawnland", [(-70.26, 43.66), (-71.06, 42.36), (-73.21, 44.48), (-72.68, 41.76), (-68.77, 44.8), (-66.64, 45.96), (-73.7, 42.5)]),
    ("lenape_powhatan", "Lenape & Powhatan", "dawnland", [(-75.17, 39.95), (-73.97, 40.78), (-77.44, 37.54), (-76.29, 36.85), (-75.52, 39.16), (-73.0, 40.8), (-74.3, 41.9), (-74.0, 41.2)]),
    # Cahokia — the Mississippian heartland
    ("cahokia", "Cahokia", "cahokia", [(-90.06, 38.66), (-90.4, 38.6), (-89.65, 39.8), (-92.33, 38.95), (-93.3, 37.2), (-92.0, 40.8), (-94.5, 40.5), (-91.2, 41.2), (-90.6, 40.5)]),
    ("ohio_valley", "Ohio Valley", "cahokia", [(-82.99, 39.96), (-84.51, 39.15), (-86.16, 39.77), (-81.63, 38.35), (-80.2, 40.3)]),
    ("tennessee_cumberland", "Tennessee & Cumberland", "cahokia", [(-86.78, 36.16), (-84.5, 38.04), (-85.76, 38.2), (-86.44, 36.99), (-83.0, 37.5), (-87.5, 35.8)]),
    ("natchez", "Natchez", "cahokia", [(-91.4, 31.56), (-91.2, 32.5), (-90.9, 33.6), (-91.7, 34.5), (-90.7, 35.8), (-91.4, 30.5)]),
    # Muscogee League — the Southeast
    ("ani_yunwiya", "Ani-Yunwiya & Catawba", "muscogee", [(-82.55, 35.6), (-83.9, 36.1), (-84.0, 35.7), (-81.03, 34.0), (-80.84, 35.23), (-78.64, 35.78), (-77.94, 34.23), (-81.5, 36.9), (-85.6, 34.8)]),
    ("muscogee", "Muscogee", "muscogee", [(-86.3, 32.37), (-83.63, 32.84), (-84.39, 33.75), (-81.3, 32.3), (-87.0, 34.5)]),
    ("chahta_chikasha", "Chahta & Chikasha", "muscogee", [(-89.4, 32.3), (-88.7, 34.26), (-88.2, 31.0), (-89.0, 35.6), (-88.7, 36.9)]),
    ("timucua_calusa", "Timucua & Calusa", "muscogee", [(-82.3, 29.65), (-81.4, 28.5), (-81.8, 26.2), (-81.7, 30.3), (-84.28, 30.44)]),
    # Caddo Confederacy — the Caddo, Wichita and Pawnee
    ("hasinai", "Hasinai & Kadohadacho", "caddo", [(-94.65, 31.6), (-94.05, 33.43), (-93.75, 32.5), (-95.37, 29.76), (-93.05, 34.5), (-94.4, 35.2), (-93.5, 35.45), (-96.8, 32.8)]),
    ("wichita", "Wichita", "caddo", [(-97.6, 37.9), (-97.2, 37.4), (-97.52, 35.47), (-96.0, 36.3), (-97.9, 34.5), (-96.0, 35.9)]),
    ("pawnee", "Pawnee", "caddo", [(-96.7, 40.8), (-98.34, 40.92), (-100.77, 41.12), (-104.99, 39.74), (-96.0, 39.6), (-101.7, 39.35), (-105.0, 41.8), (-104.8, 41.14), (-102.5, 38.6)]),
]

# Crossings by water. Every other link is a shared land border, found from the geometry.
SEA_LINKS = [
    ("lingit", "wakashan"),           # Dixon Entrance: the Portland Canal is water all the way up
    ("ojibwe", "odawa"),              # the Straits of Mackinac, and Manitoulin
    ("ohio_valley", "wendake"),       # across Lake Erie at Point Pelee
    ("nitassinan", "wabanaki"),       # the narrows at Kebec
    ("nitassinan", "mikmaq"),         # the Gulf of St. Lawrence, Côte-Nord to Gaspé
    ("cochimi", "yoeme"),             # Santa Rosalía to Guaymas
    ("cochimi", "oodham"),            # the Midriff islands
]

DESCRIPTION = (
    "North America in an age when no fleet came to stay — 62 territories held by fourteen nations, from "
    "Lingít Aaní and the Salmon League to the Triple Alliance and the League of Mayapán. Every border "
    "follows the land: the Missouri and the Mississippi, the Rio Grande, the Continental Divide, the "
    "Sierras Madre and the Appalachian crest. Hold a nation's homeland, or break it at the river."
)
BOUNDS = {"minLng": -142.0, "maxLng": -58.0, "minLat": 12.5, "maxLat": 60.5}
GLOBE_VIEW = {"center_lat": 38.0, "center_lng": -99.0, "altitude": 1.9}


# ── Geometry ───────────────────────────────────────────────────────────────────

def km2(geom):
    """Area in km² (equal-area enough at one latitude: degrees scaled by cos(lat))."""
    return geom.area * 111.32 * 111.32 * math.cos(math.radians(geom.centroid.y))


def load_land(ne_dir):
    with open(os.path.join(REPO, "frontend", "public", "geo", "ne_50m_admin_0_countries.json")) as f:
        countries = json.load(f)
    parts = []
    for feat in countries["features"]:
        p = feat["properties"]
        iso = p.get("ISO_A2") if p.get("ISO_A2") not in (None, "-99") else p.get("ISO_A2_EH")
        if iso in COUNTRIES:
            parts.append(shape(feat["geometry"]).buffer(0))
    land = unary_union(parts).intersection(BOARD)
    with open(os.path.join(ne_dir, "ne_50m_lakes.geojson")) as f:
        lakes = [shape(x["geometry"]).buffer(0) for x in json.load(f)["features"]]
    # The great lakes of the board (about 2,000 km² and up) are water; smaller ones are land.
    lake = unary_union([g for g in lakes if g.intersects(BOARD) and g.area > 0.25])
    return land.difference(lake).buffer(0)


def overshoot(start, through, by):
    """A segment from `start` through `through` and `by` degrees past it, so the noder meets what it hits."""
    dx, dy = through[0] - start[0], through[1] - start[1]
    n = math.hypot(dx, dy) or 1
    return LineString([start, through, (through[0] + dx / n * by, through[1] + dy / n * by)])


def load_rivers(ne_dir):
    with open(os.path.join(ne_dir, "ne_10m_rivers_lake_centerlines.geojson")) as f:
        feats = json.load(f)["features"]
    pieces = defaultdict(list)
    for feat in feats:
        if not feat["geometry"]:
            continue
        name = feat["properties"].get("name") or ""
        for key, bb in RIVERS.items():
            if key.split("#")[0] != name:
                continue
            g = shape(feat["geometry"])
            if bb is not None:
                if not g.intersects(box(*bb)):
                    continue
                g = g.intersection(box(*bb))
            pieces[key].append(g)
    rivers = {}
    for key, gs in pieces.items():
        u = unary_union(gs)
        lines = [u] if u.geom_type == "LineString" else [x for x in u.geoms if x.geom_type == "LineString"]
        # Bridge the gaps reservoirs and braids leave between pieces of one river.
        bridges = []
        for i, line in enumerate(lines):
            others = unary_union([o for j, o in enumerate(lines) if j != i]) if len(lines) > 1 else None
            if others is None:
                continue
            for end in (line.coords[0], line.coords[-1]):
                d = Point(end).distance(others)
                if 1e-6 < d < 0.6:
                    q = nearest_points(Point(end), others)[1]
                    bridges.append(overshoot(end, (q.x, q.y), 0.01))
        rivers[key] = unary_union(lines + bridges)
    missing = sorted(set(RIVERS) - set(rivers))
    if missing:
        raise SystemExit(f"rivers not found in Natural Earth: {missing}")
    return rivers


def free_ends(g):
    parts = [g] if g.geom_type == "LineString" else list(g.geoms)
    out = []
    for p in parts:
        for c in (p.coords[0], p.coords[-1]):
            if not any(q is not p and q.distance(Point(c)) < 1e-7 for q in parts):
                out.append(c)
    return out


def close_network(land, rivers, hand):
    """Carry each loose end on land to the nearest other line or shore."""
    named = {**{f"river:{k}": v for k, v in rivers.items()}, **hand}
    coast = land.boundary
    extensions = []
    for name, g in named.items():
        reach = 0.05 if name.startswith("river:") and name[6:] not in REACHING_RIVERS else 1.3
        target = unary_union([coast] + [o for n, o in named.items() if n != name])
        for end in free_ends(g):
            pt = Point(end)
            d = pt.distance(target)
            if d < 1e-7 or d > reach or not land.contains(pt):
                continue
            q = nearest_points(pt, target)[1]
            extensions.append(overshoot(end, (q.x, q.y), 0.02))
    return list(named.values()) + extensions


def cut(land, lines):
    """The faces of land cut by `lines`, noded on a 1e-6° grid."""
    grid = lambda g: shapely.set_precision(g, 1e-6)  # noqa: E731
    net = unary_union([grid(land.boundary)] + [grid(l.intersection(land.buffer(0.05))) for l in lines])
    return [p for p in polygonize(net) if p.area > 1e-5 and land.contains(p.representative_point())]


def assign(faces):
    tree = STRtree(faces)
    owner = [None] * len(faces)
    problems = []
    for tid, _name, _nation, claims in TERRITORIES:
        for x, y in claims:
            p = Point(x, y)
            hits = [i for i in tree.query(p) if faces[i].contains(p)]
            if not hits:
                problems.append(f"{tid}: claim ({x}, {y}) is not on the board's land")
                continue
            i = hits[0]
            if owner[i] not in (None, tid):
                problems.append(f"{tid}: claim ({x}, {y}) falls in {owner[i]}'s face — a border is open")
            owner[i] = tid
    if problems:
        raise SystemExit("claims:\n  " + "\n  ".join(problems))

    claimed = [i for i, o in enumerate(owner) if o]
    shared = defaultdict(dict)
    for i, f in enumerate(faces):
        for j in tree.query(f.buffer(1e-6)):
            if j > i:
                s = f.boundary.intersection(faces[j].boundary).length
                if s > 1e-6:
                    shared[i][j] = shared[j][i] = s
    # Unclaimed faces join the owner they share the longest border with, largest faces first.
    changed = True
    while changed:
        changed = False
        for i in sorted((i for i, o in enumerate(owner) if not o), key=lambda i: -faces[i].area):
            border = defaultdict(float)
            for j, s in shared[i].items():
                if owner[j]:
                    border[owner[j]] += s
            if border:
                owner[i] = max(border, key=border.get)
                changed = True
    # Islands: the big ones go to the nearest territory, islets drop.
    for i, o in enumerate(owner):
        if o is None and km2(faces[i]) >= MIN_ISLAND_KM2:
            owner[i] = owner[min(claimed, key=lambda j: faces[i].distance(faces[j]))]

    territories = {}
    for tid, *_ in TERRITORIES:
        parts = [faces[i] for i, o in enumerate(owner) if o == tid]
        territories[tid] = unary_union(parts).buffer(0)
    return territories


def round_geom(g, nd=4):
    return shapely.set_precision(g, 10 ** -nd)


def clockwise(g):
    """Exterior rings clockwise, holes counter-clockwise (the globe's fill convention)."""
    polys = [g] if g.geom_type == "Polygon" else list(g.geoms)
    out = [orient(p, sign=-1.0) for p in polys]
    return out[0] if len(out) == 1 else shapely.MultiPolygon(out)


def polygons(g):
    return [g] if g.geom_type == "Polygon" else [p for p in g.geoms if p.geom_type == "Polygon"]


def outline(g):
    """The largest part's exterior, simplified, clockwise, without the closing point."""
    largest = max(polygons(g), key=lambda p: p.area)
    ring = Polygon(largest.exterior).simplify(OUTLINE_SIMPLIFY_DEG, preserve_topology=True)
    ring = orient(ring, sign=-1.0)
    return [[round(x, 3), round(y, 3)] for x, y in ring.exterior.coords[:-1]]


def land_links(geoms):
    ids = list(geoms)
    tree = STRtree([geoms[t] for t in ids])
    links = []
    for i, a in enumerate(ids):
        for j in tree.query(geoms[a]):
            if j <= i:
                continue
            b = ids[j]
            border = geoms[a].boundary.intersection(geoms[b].boundary).length
            if border > 0.05:  # a real shared border, not a corner
                links.append((a, b))
    return links


def region_bonus(members, links, nation_of):
    """Three quarters of a reinforcement per territory and half per territory on the frontier,
    about one per territory across the board, as on the era maps of this size."""
    frontier = {t for a, b in links for t in (a, b)
                if nation_of[a] != nation_of[b] and t in members}
    return max(1, int(0.75 * len(members) + 0.5 * len(frontier) - 1 + 0.5))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ne-dir", required=True, help="directory holding ne_50m_lakes.geojson and ne_10m_rivers_lake_centerlines.geojson")
    args = ap.parse_args()

    land = load_land(args.ne_dir)
    rivers = load_rivers(args.ne_dir)
    hand = {k: LineString(v) for k, v in LINES.items()}
    faces = cut(land, close_network(land, rivers, hand))
    territories = assign(faces)

    ids = [t[0] for t in TERRITORIES]
    simplified = shapely.coverage_simplify([territories[t] for t in ids], SIMPLIFY_DEG)
    if not shapely.coverage_is_valid(simplified):
        raise SystemExit("simplified territories overlap")
    geoms = {t: clockwise(round_geom(g.buffer(0))) for t, g in zip(ids, simplified)}

    code = lambda tid: f"N14~{tid.upper()}"  # noqa: E731
    subset = {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": {
                "iso_3166_2": code(tid),
                "territory_id": tid,
                "name": name,
                "source": "Natural Earth ne_50m land cut by ne_10m rivers and traced crests (build_fourteen_nations.py)",
            },
            "geometry": mapping(geoms[tid]),
        } for tid, name, _n, _c in TERRITORIES],
    }
    with open(SUBSET_PATH, "w") as f:
        json.dump(subset, f, separators=(",", ":"))

    nation_of = {t[0]: t[2] for t in TERRITORIES}
    links = land_links(geoms)
    linked = {frozenset(l) for l in links}
    for a, b in SEA_LINKS:
        if frozenset((a, b)) in linked:
            raise SystemExit(f"sea link {a}–{b} is already a land border")
    regions = [{
        "region_id": nid,
        "name": nname,
        "bonus": region_bonus({t for t in ids if nation_of[t] == nid}, links + SEA_LINKS, nation_of),
    } for nid, nname in NATIONS]

    m, path = build_map(
        map_id=MAP_ID,
        name="The 14 Nations",
        description=DESCRIPTION,
        bounds=BOUNDS,
        regions=regions,
        territories=[(tid, name, nation, outline(geoms[tid])) for tid, name, nation, _c in TERRITORIES],
        connections=[(a, b, "land") for a, b in links] + [(a, b, "sea") for a, b in SEA_LINKS],
        globe_view=GLOBE_VIEW,
        admin_refs={tid: {"admin1": [code(tid)]} for tid in ids},
    )
    with open(PUBLIC_COPY, "w") as f:
        json.dump(m, f, indent=2)
    print(f"wrote {SUBSET_PATH} ({os.path.getsize(SUBSET_PATH) // 1024} KB) and {PUBLIC_COPY}")
    for r in m["regions"]:
        print(f"  {r['name']:24s} {len(r['territory_ids'])} territories, bonus {r['bonus']}")


if __name__ == "__main__":
    main()
