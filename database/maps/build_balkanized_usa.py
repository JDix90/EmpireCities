"""
Balkanized United States — the contiguous USA fractured into nine successor nations.
Reference genre: r/imaginarymaps "balkanized America / divided States".

geo_polygon outlines trace the real coasts (Atlantic, Pacific, Gulf), the Appalachian
spine, the Mississippi & Missouri rivers, the Rockies, the Rio Grande, the Great Lakes
shorelines, and state lines. Built via mapkit.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from mapkit import build_map

BOUNDS = {"minLng": -125.0, "maxLng": -66.0, "minLat": 24.0, "maxLat": 50.0}

REGIONS = [
    {"region_id": "new_england", "name": "New England Commonwealth", "bonus": 3},
    {"region_id": "atlantic",    "name": "Mid-Atlantic States",      "bonus": 4},
    {"region_id": "dixie",       "name": "Confederation of Dixie",   "bonus": 6},
    {"region_id": "texas",       "name": "Republic of Texas & the Gulf", "bonus": 5},
    {"region_id": "deseret",     "name": "Deseret",                  "bonus": 4},
    {"region_id": "cascadia",    "name": "Cascadia",                 "bonus": 3},
    {"region_id": "california",  "name": "California Republic",      "bonus": 4},
    {"region_id": "great_lakes", "name": "Great Lakes Federation",   "bonus": 5},
    {"region_id": "plains",      "name": "the Heartland / Great Plains", "bonus": 6},
]

T = [
    # ---- New England Commonwealth (NE corner) ----
    ("ne_north", "Northern New England", "new_england", [
        [-73.4,45.0],[-71.5,45.0],[-71.1,45.3],[-70.7,46.0],[-69.0,47.4],[-67.8,47.1],
        [-67.0,45.7],[-70.0,43.8],[-71.6,44.0],[-73.4,43.6],[-73.4,45.0]]),
    ("ne_south", "Southern New England", "new_england", [
        [-73.7,43.6],[-71.6,44.0],[-70.0,43.8],[-70.0,42.3],[-70.9,41.3],[-71.9,41.3],
        [-73.7,41.0],[-73.5,42.0],[-73.7,43.6]]),
    # ---- Mid-Atlantic States ----
    ("at_newyork", "New York & Hudson", "atlantic", [
        [-79.8,42.5],[-76.9,43.3],[-74.5,45.0],[-73.4,45.0],[-73.4,43.6],[-73.7,43.6],
        [-73.5,42.0],[-73.7,41.0],[-74.3,40.5],[-75.4,41.0],[-79.8,42.0],[-79.8,42.5]]),
    ("at_penn", "Pennsylvania", "atlantic", [
        [-80.5,42.0],[-79.8,42.0],[-75.4,41.0],[-74.7,40.4],[-75.0,39.8],[-77.0,39.7],
        [-80.5,39.7],[-80.5,42.0]]),
    ("at_chesapeake", "Chesapeake & Delmarva", "atlantic", [
        [-79.5,39.7],[-77.0,39.7],[-75.0,39.8],[-75.0,38.5],[-75.9,37.0],[-76.5,37.9],
        [-77.3,38.4],[-78.4,39.2],[-79.5,39.7]]),
    ("at_virginia", "Virginia", "atlantic", [
        [-83.5,38.0],[-81.5,39.2],[-79.5,39.7],[-78.4,39.2],[-77.3,38.4],[-76.0,37.0],
        [-75.6,36.55],[-79.0,36.55],[-82.5,36.6],[-83.5,38.0]]),
    # ---- Great Lakes Federation ----
    ("gl_ohio", "Ohio", "great_lakes", [
        [-84.8,41.7],[-83.0,41.7],[-82.5,41.4],[-80.5,42.0],[-80.5,39.7],[-82.0,38.6],
        [-84.8,38.8],[-84.8,41.7]]),
    ("gl_michigan", "Michigan", "great_lakes", [
        [-87.0,45.0],[-84.4,45.8],[-83.0,44.0],[-82.4,43.0],[-83.0,41.7],[-84.8,41.7],
        [-86.6,41.8],[-87.0,42.5],[-87.0,45.0]]),
    ("gl_indiana", "Indiana", "great_lakes", [
        [-87.5,41.7],[-86.6,41.8],[-84.8,41.7],[-84.8,38.8],[-86.3,38.0],[-87.9,38.0],
        [-87.5,41.7]]),
    ("gl_illinois", "Illinois", "great_lakes", [
        [-90.6,42.5],[-87.8,42.5],[-87.5,41.7],[-87.9,38.0],[-89.5,37.0],[-91.4,40.4],
        [-90.6,42.5]]),
    ("gl_wisconsin", "Wisconsin", "great_lakes", [
        [-92.9,45.4],[-90.4,46.6],[-88.0,46.0],[-87.0,45.0],[-87.8,42.5],[-90.6,42.5],
        [-91.2,43.5],[-92.9,45.4]]),
    # ---- Confederation of Dixie (Southeast) ----
    ("dx_carolinas", "the Carolinas", "dixie", [
        [-83.5,38.0],[-82.5,36.6],[-79.0,36.55],[-75.6,36.55],[-75.5,35.2],[-78.5,33.9],
        [-80.9,34.8],[-82.4,35.2],[-83.5,38.0]]),
    ("dx_georgia", "Georgia", "dixie", [
        [-85.6,35.0],[-83.1,35.0],[-82.4,35.2],[-80.9,34.8],[-81.1,32.1],[-81.5,30.7],
        [-85.0,31.0],[-85.6,35.0]]),
    ("dx_florida", "Florida", "dixie", [
        [-87.6,31.0],[-85.0,31.0],[-81.5,30.7],[-80.0,26.8],[-80.4,25.2],[-81.8,24.5],
        [-82.8,27.8],[-84.0,30.1],[-87.6,30.4],[-87.6,31.0]]),
    ("dx_alabama", "Alabama", "dixie", [
        [-88.2,35.0],[-85.6,35.0],[-85.0,31.0],[-87.6,31.0],[-88.4,30.4],[-88.5,34.0],
        [-88.2,35.0]]),
    ("dx_tennessee", "Tennessee & Kentucky", "dixie", [
        [-89.5,37.0],[-87.9,38.0],[-86.3,38.0],[-84.8,38.8],[-82.0,38.6],[-83.5,38.0],
        [-83.1,35.0],[-85.6,35.0],[-88.2,35.0],[-89.7,36.0],[-89.5,37.0]]),
    ("dx_mississippi", "Mississippi", "dixie", [
        [-91.0,36.5],[-89.5,37.0],[-89.7,36.0],[-88.2,35.0],[-88.5,34.0],[-88.4,30.4],
        [-89.6,30.2],[-91.6,31.0],[-90.3,35.0],[-91.0,36.5]]),
    # ---- Republic of Texas & the Gulf ----
    ("tx_louisiana", "Louisiana", "texas", [
        [-94.0,33.0],[-91.0,33.0],[-91.0,31.0],[-89.6,30.2],[-90.3,29.0],[-93.0,29.7],
        [-93.8,29.8],[-94.0,33.0]]),
    ("tx_arkansas", "Arkansas", "texas", [
        [-94.6,36.5],[-91.0,36.5],[-90.3,35.0],[-91.6,31.0],[-94.0,33.0],[-94.6,33.6],
        [-94.6,36.5]]),
    ("tx_oklahoma", "Oklahoma", "texas", [
        [-103.0,37.0],[-94.6,36.5],[-94.6,33.6],[-99.0,34.2],[-100.0,36.5],[-103.0,36.5],
        [-103.0,37.0]]),
    ("tx_east", "East Texas", "texas", [
        [-99.0,34.2],[-94.6,33.6],[-94.0,33.0],[-93.8,29.8],[-95.0,28.8],[-96.5,28.4],
        [-98.0,26.1],[-99.2,26.4],[-99.0,29.5],[-100.0,31.0],[-99.0,34.2]]),
    ("tx_west", "West Texas & the Rio Grande", "texas", [
        [-103.0,36.5],[-100.0,36.5],[-99.0,34.2],[-100.0,31.0],[-99.0,29.5],[-99.2,26.4],
        [-101.0,29.3],[-103.0,29.0],[-104.5,29.7],[-106.5,31.8],[-103.0,32.0],[-103.0,36.5]]),
    # ---- the Heartland / Great Plains ----
    ("pl_dakotas", "the Dakotas", "plains", [
        [-104.0,49.0],[-96.6,49.0],[-96.5,46.0],[-96.5,42.9],[-104.0,43.0],[-104.0,49.0]]),
    ("pl_nebraska", "Nebraska", "plains", [
        [-104.0,43.0],[-96.5,42.9],[-95.4,40.0],[-102.0,40.0],[-104.0,41.0],[-104.0,43.0]]),
    ("pl_kansas", "Kansas", "plains", [
        [-102.0,40.0],[-95.4,40.0],[-94.6,37.0],[-102.0,37.0],[-102.0,40.0]]),
    ("pl_missouri", "Missouri", "plains", [
        [-95.4,40.0],[-91.4,40.4],[-89.5,37.0],[-90.3,35.0],[-91.0,36.5],[-94.6,36.5],
        [-94.6,37.0],[-95.4,40.0]]),
    ("pl_iowa", "Iowa & Minnesota", "plains", [
        [-96.6,49.0],[-91.2,48.0],[-90.4,46.6],[-92.9,45.4],[-91.2,43.5],[-90.6,42.5],
        [-91.4,40.4],[-95.4,40.0],[-96.5,42.9],[-96.5,46.0],[-96.6,49.0]]),
    # ---- Deseret (Mormon Mountain West: UT/NV/AZ + interior) ----
    ("ds_colorado", "Colorado", "deseret", [
        [-109.0,41.0],[-102.0,41.0],[-102.0,37.0],[-109.0,37.0],[-109.0,41.0]]),
    ("ds_utah", "Utah", "deseret", [
        [-114.0,42.0],[-111.0,42.0],[-111.0,41.0],[-109.0,41.0],[-109.0,37.0],[-114.0,37.0],
        [-114.0,42.0]]),
    ("ds_nevada", "Nevada", "deseret", [
        [-120.0,42.0],[-114.0,42.0],[-114.0,37.0],[-114.6,36.1],[-117.0,36.9],[-120.0,39.0],
        [-120.0,42.0]]),
    ("ds_arizona", "Arizona & New Mexico", "deseret", [
        [-114.6,36.1],[-114.0,37.0],[-109.0,37.0],[-103.0,37.0],[-103.0,32.0],[-106.5,31.8],
        [-108.2,31.3],[-111.0,31.3],[-114.8,32.5],[-114.6,36.1]]),
    # ---- Cascadia (Pacific NW: WA/OR/ID) ----
    ("cs_washington", "Washington", "cascadia", [
        [-124.7,48.4],[-123.0,49.0],[-117.0,49.0],[-117.0,46.0],[-121.0,45.6],[-123.7,46.3],
        [-124.7,47.3],[-124.7,48.4]]),
    ("cs_oregon", "Oregon", "cascadia", [
        [-124.6,46.3],[-123.7,46.3],[-121.0,45.6],[-117.0,46.0],[-117.0,42.0],[-124.4,42.0],
        [-124.6,46.3]]),
    ("cs_idaho", "Idaho, Montana & Wyoming", "cascadia", [
        [-117.0,49.0],[-104.0,49.0],[-104.0,41.0],[-111.0,41.0],[-111.0,42.0],[-117.0,42.0],
        [-117.0,49.0]]),
    # ---- California Republic ----
    ("ca_north", "Northern California", "california", [
        [-124.4,42.0],[-120.0,42.0],[-120.0,39.0],[-119.0,38.0],[-121.5,36.5],[-122.5,37.8],
        [-123.8,39.4],[-124.4,40.4],[-124.4,42.0]]),
    ("ca_south", "Southern California", "california", [
        [-121.5,36.5],[-119.0,38.0],[-117.0,36.9],[-114.6,36.1],[-114.8,32.5],[-117.1,32.5],
        [-119.0,34.0],[-120.6,34.6],[-121.9,36.3],[-121.5,36.5]]),
]

C = [
    # New England
    ("ne_north","ne_south","land"),
    ("ne_north","at_newyork","land"),("ne_south","at_newyork","land"),
    # Mid-Atlantic
    ("at_newyork","at_penn","land"),
    ("at_penn","at_chesapeake","land"),("at_penn","gl_ohio","land"),("at_penn","at_virginia","land"),
    ("at_chesapeake","at_virginia","land"),
    ("at_virginia","dx_carolinas","land"),("at_virginia","dx_tennessee","land"),("at_virginia","gl_ohio","land"),
    # Great Lakes
    ("gl_ohio","gl_michigan","land"),("gl_ohio","gl_indiana","land"),("gl_ohio","dx_tennessee","land"),
    ("gl_michigan","gl_indiana","land"),("gl_michigan","gl_wisconsin","land"),
    ("gl_indiana","gl_illinois","land"),("gl_indiana","dx_tennessee","land"),
    ("gl_illinois","gl_wisconsin","land"),("gl_illinois","dx_tennessee","land"),
    ("gl_illinois","pl_missouri","land"),("gl_illinois","pl_iowa","land"),
    ("gl_wisconsin","pl_iowa","land"),
    # Dixie
    ("dx_carolinas","dx_georgia","land"),("dx_carolinas","dx_tennessee","land"),
    ("dx_georgia","dx_florida","land"),("dx_georgia","dx_alabama","land"),("dx_georgia","dx_tennessee","land"),
    ("dx_florida","dx_alabama","land"),
    ("dx_alabama","dx_tennessee","land"),("dx_alabama","dx_mississippi","land"),
    ("dx_tennessee","dx_mississippi","land"),("dx_tennessee","pl_missouri","land"),
    ("dx_mississippi","tx_louisiana","land"),("dx_mississippi","tx_arkansas","land"),("dx_mississippi","pl_missouri","land"),
    # Texas & Gulf
    ("tx_louisiana","tx_arkansas","land"),("tx_louisiana","tx_east","land"),
    ("tx_arkansas","tx_oklahoma","land"),("tx_arkansas","tx_east","land"),("tx_arkansas","pl_missouri","land"),
    ("tx_oklahoma","tx_east","land"),("tx_oklahoma","tx_west","land"),("tx_oklahoma","pl_kansas","land"),
    ("tx_east","tx_west","land"),
    ("tx_west","ds_arizona","land"),
    # Plains
    ("pl_dakotas","pl_nebraska","land"),("pl_dakotas","pl_iowa","land"),("pl_dakotas","cs_idaho","land"),
    ("pl_nebraska","pl_kansas","land"),("pl_nebraska","pl_iowa","land"),("pl_nebraska","pl_missouri","land"),
    ("pl_nebraska","ds_colorado","land"),
    ("pl_kansas","pl_missouri","land"),("pl_kansas","ds_colorado","land"),
    ("pl_missouri","pl_iowa","land"),
    # Deseret
    ("ds_colorado","ds_utah","land"),("ds_colorado","ds_arizona","land"),("ds_colorado","cs_idaho","land"),
    ("ds_utah","ds_nevada","land"),("ds_utah","ds_arizona","land"),("ds_utah","cs_idaho","land"),
    ("ds_nevada","ds_arizona","land"),("ds_nevada","ca_north","land"),("ds_nevada","ca_south","land"),("ds_nevada","cs_oregon","land"),
    ("ds_arizona","ca_south","land"),
    # Cascadia
    ("cs_washington","cs_oregon","land"),("cs_washington","cs_idaho","land"),
    ("cs_oregon","cs_idaho","land"),("cs_oregon","ca_north","land"),
    # California
    ("ca_north","ca_south","land"),
]

# Real Natural Earth admin-1 (US state) geometry per territory.
# Every contiguous US state assigned exactly once; AK/HI and all territories
# (AS/GU/PR/VI/UM/MP) excluded as non-contiguous. DC merged into Chesapeake.
# California (one ISO unit, two territories) and Texas (one ISO unit, two
# territories) are split with clip_bbox into northern/southern and eastern/western halves.
ADMIN = {
    # ---- New England Commonwealth ----
    "ne_north":      {"admin1": ["US-ME", "US-NH", "US-VT"]},
    "ne_south":      {"admin1": ["US-MA", "US-CT", "US-RI"]},
    # ---- Mid-Atlantic States ----
    "at_newyork":    {"admin1": ["US-NY", "US-NJ"]},
    "at_penn":       {"admin1": ["US-PA"]},
    "at_chesapeake": {"admin1": ["US-MD", "US-DE", "US-DC"]},  # DC merged here
    "at_virginia":   {"admin1": ["US-VA", "US-WV"]},
    # ---- Great Lakes Federation ----
    "gl_ohio":       {"admin1": ["US-OH"]},
    "gl_michigan":   {"admin1": ["US-MI"]},
    "gl_indiana":    {"admin1": ["US-IN"]},
    "gl_illinois":   {"admin1": ["US-IL"]},
    "gl_wisconsin":  {"admin1": ["US-WI"]},
    # ---- Confederation of Dixie ----
    "dx_carolinas":  {"admin1": ["US-NC", "US-SC"]},
    "dx_georgia":    {"admin1": ["US-GA"]},
    "dx_florida":    {"admin1": ["US-FL"]},
    "dx_alabama":    {"admin1": ["US-AL"]},
    "dx_tennessee":  {"admin1": ["US-TN", "US-KY"]},
    "dx_mississippi":{"admin1": ["US-MS"]},
    # ---- Republic of Texas & the Gulf ----
    "tx_louisiana":  {"admin1": ["US-LA"]},
    "tx_arkansas":   {"admin1": ["US-AR"]},
    "tx_oklahoma":   {"admin1": ["US-OK"]},
    "tx_east":       {"admin1": ["US-TX"], "clip_bbox": [-99.5, 25.0, -93.0, 37.0]},
    "tx_west":       {"admin1": ["US-TX"], "clip_bbox": [-107.0, 25.0, -99.5, 37.0]},
    # ---- the Heartland / Great Plains ----
    "pl_dakotas":    {"admin1": ["US-ND", "US-SD"]},
    "pl_nebraska":   {"admin1": ["US-NE"]},
    "pl_kansas":     {"admin1": ["US-KS"]},
    "pl_missouri":   {"admin1": ["US-MO"]},
    "pl_iowa":       {"admin1": ["US-IA", "US-MN"]},
    # ---- Deseret ----
    "ds_colorado":   {"admin1": ["US-CO"]},
    "ds_utah":       {"admin1": ["US-UT"]},
    "ds_nevada":     {"admin1": ["US-NV"]},
    "ds_arizona":    {"admin1": ["US-AZ", "US-NM"]},
    # ---- Cascadia ----
    "cs_washington": {"admin1": ["US-WA"]},
    "cs_oregon":     {"admin1": ["US-OR"]},
    "cs_idaho":      {"admin1": ["US-ID", "US-MT", "US-WY"]},
    # ---- California Republic ----
    "ca_north":      {"admin1": ["US-CA"], "clip_bbox": [-125.0, 37.0, -114.0, 42.5]},
    "ca_south":      {"admin1": ["US-CA"], "clip_bbox": [-125.0, 32.0, -114.0, 37.0]},
}

if __name__ == "__main__":
    build_map(
        map_id="community_balkanized_usa",
        name="Balkanized United States",
        description=(
            "The contiguous United States shattered into nine successor nations along the "
            "old sectional fault lines — the New England Commonwealth, the Mid-Atlantic "
            "States, the Confederation of Dixie, the Republic of Texas, Deseret, Cascadia, "
            "the California Republic, the Great Lakes Federation, and the Heartland. Borders "
            "trace the Appalachian spine, the Mississippi and Missouri, the Rockies, the Rio "
            "Grande, and the Great Lakes shorelines."
        ),
        bounds=BOUNDS,
        regions=REGIONS,
        territories=T,
        connections=C,
        globe_view={"center_lat": 39.5, "center_lng": -97.0, "altitude": 0.9},
        admin_refs=ADMIN,
    )
