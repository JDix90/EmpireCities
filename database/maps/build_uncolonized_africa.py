"""
Uncolonized Africa — the continent as a mosaic of its own indigenous powers, before
the Scramble. The Maghreb and its Atlas, the Sahelian empires of the Niger bend, the
Nile of Egypt and Nubia, the Abyssinian highlands and the Horn, the Swahili trading
coast, the Kongo and the rainforest basin, the stone cities of Zimbabwe and the Cape,
and the forest kingdoms of the Guinea Coast.

geo_polygon outlines trace the real African coastline (Atlantic, Mediterranean, Red Sea,
Indian Ocean) and interior frontiers (the Sahara, the Niger/Nile/Congo/Zambezi rivers,
the Ethiopian highlands, the Great Rift lakes). Madagascar sits offshore, sea-linked.
Built via mapkit.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from mapkit import build_map

BOUNDS = {"minLng": -18.0, "maxLng": 52.0, "minLat": -36.0, "maxLat": 38.0}

REGIONS = [
    {"region_id": "maghreb",   "name": "The Maghreb",            "bonus": 4},
    {"region_id": "sahel",     "name": "Sahelian Empires",       "bonus": 5},
    {"region_id": "nile",      "name": "Egypt & Nubia",          "bonus": 4},
    {"region_id": "abyssinia", "name": "Abyssinia & the Horn",   "bonus": 3},
    {"region_id": "swahili",   "name": "Swahili Coast",          "bonus": 4},
    {"region_id": "kongo",     "name": "Kongo & the Congo Basin","bonus": 5},
    {"region_id": "zimbabwe",  "name": "Zimbabwe & the South",   "bonus": 4},
    {"region_id": "guinea",    "name": "Guinea Coast",           "bonus": 3},
]

T = [
    # ---------------- The Maghreb (NW coast / Atlas) ----------------
    ("morocco", "Morocco & the Atlas", "maghreb", [
        [-9.8,32.0],[-8.5,33.3],[-6.0,35.2],[-2.5,35.3],[-1.5,34.0],[-3.0,32.0],
        [-4.5,30.5],[-7.0,29.0],[-9.5,29.5],[-9.9,31.0],[-9.8,32.0]]),
    ("algeria", "Algiers & the Tell", "maghreb", [
        [-1.5,34.0],[-2.5,35.3],[2.0,36.8],[6.0,37.0],[8.0,36.5],[8.5,35.0],
        [6.0,33.5],[2.0,33.0],[-1.0,32.5],[-1.5,34.0]]),
    ("ifriqiya", "Tunis & Ifriqiya", "maghreb", [
        [8.0,36.5],[11.0,37.3],[11.5,33.5],[10.0,31.0],[8.5,31.5],[8.5,35.0],
        [8.0,36.5]]),
    ("tripolitania", "Tripolitania", "maghreb", [
        [11.5,33.5],[15.5,32.5],[19.0,31.0],[18.5,29.0],[14.0,28.0],[10.0,28.5],
        [10.0,31.0],[11.5,33.5]]),

    # ---------------- Egypt & Nubia (lower + upper Nile) ----------------
    ("cyrenaica", "Cyrenaica", "nile", [
        [19.0,31.0],[23.0,32.5],[25.0,31.8],[25.0,28.0],[21.0,27.5],[18.5,29.0],
        [19.0,31.0]]),
    ("lower_egypt", "Lower Egypt", "nile", [
        [25.0,31.8],[30.0,31.6],[34.0,31.3],[34.5,29.5],[32.0,28.0],[28.0,28.5],
        [25.0,28.0],[25.0,31.8]]),
    ("upper_egypt", "Upper Egypt", "nile", [
        [25.0,28.0],[28.0,28.5],[32.0,28.0],[34.0,25.5],[35.0,23.0],[31.0,22.0],
        [25.0,22.0],[25.0,28.0]]),
    ("nubia", "Nubia & Kush", "nile", [
        [25.0,22.0],[31.0,22.0],[35.0,21.0],[37.0,19.0],[36.0,16.0],[33.0,15.5],
        [29.0,16.0],[24.0,17.0],[24.0,20.0],[25.0,22.0]]),

    # ---------------- Abyssinia & the Horn ----------------
    ("eritrea", "Eritrea & the Red Sea", "abyssinia", [
        [36.0,16.0],[37.0,19.0],[40.0,17.0],[43.0,12.5],[41.5,11.0],[39.0,13.0],
        [37.5,14.5],[36.0,16.0]]),
    ("tigray", "Tigray & Amhara", "abyssinia", [
        [33.0,15.5],[36.0,16.0],[37.5,14.5],[39.0,13.0],[39.5,10.5],[37.0,9.0],
        [34.5,10.5],[33.5,13.0],[33.0,15.5]]),
    ("shewa", "Shewa & the Highlands", "abyssinia", [
        [37.0,9.0],[39.5,10.5],[41.5,11.0],[43.5,9.0],[42.0,6.5],[39.0,5.0],
        [36.5,6.0],[35.5,7.5],[37.0,9.0]]),
    ("somalia", "The Somali Coast", "abyssinia", [
        [43.0,12.5],[48.0,11.5],[51.0,11.5],[51.0,8.0],[49.0,3.0],[44.0,1.5],
        [42.0,3.5],[42.0,6.5],[43.5,9.0],[41.5,11.0],[43.0,12.5]]),

    # ---------------- Sahelian Empires (Niger / Mali / Songhai / Sokoto) ----------------
    ("senegambia", "Senegambia & Tekrur", "sahel", [
        [-17.5,16.0],[-14.0,16.5],[-11.5,15.0],[-11.0,12.0],[-13.5,11.0],
        [-16.5,12.5],[-17.5,14.5],[-17.5,16.0]]),
    ("mali", "Mali & the Niger Bend", "sahel", [
        [-11.5,15.0],[-7.0,16.0],[-3.0,16.5],[-2.0,14.0],[-4.0,11.5],[-8.0,11.0],
        [-11.0,12.0],[-11.5,15.0]]),
    ("songhai", "Songhai & Gao", "sahel", [
        [-3.0,16.5],[2.0,16.5],[4.5,14.0],[3.5,12.0],[-1.0,12.5],[-2.0,14.0],
        [-3.0,16.5]]),
    ("hausa", "Hausaland & Sokoto", "sahel", [
        [4.5,14.0],[8.0,13.5],[11.0,13.0],[12.0,10.5],[10.0,9.0],[6.0,9.5],
        [3.5,12.0],[4.5,14.0]]),
    ("kanem", "Kanem-Bornu & Lake Chad", "sahel", [
        [11.0,13.0],[15.0,13.5],[18.0,13.0],[20.0,11.0],[18.0,8.5],[14.0,8.5],
        [12.0,10.5],[11.0,13.0]]),
    ("wadai", "Wadai & Darfur", "sahel", [
        [18.0,13.0],[22.0,14.0],[24.0,17.0],[29.0,16.0],[27.0,12.0],[23.0,9.5],
        [20.0,11.0],[18.0,13.0]]),

    # ---------------- Guinea Coast (W African forest / Yoruba-Benin-Ashanti) ----------------
    ("guinea_forest", "Guinea & Sierra Leone", "guinea", [
        [-13.5,11.0],[-11.0,12.0],[-8.0,11.0],[-7.5,9.0],[-9.0,7.0],[-12.0,7.5],
        [-13.5,9.0],[-13.5,11.0]]),
    ("ivory", "Ashanti & the Ivory Coast", "guinea", [
        [-8.0,11.0],[-4.0,11.5],[-1.0,11.0],[-0.5,8.0],[-2.5,5.0],[-7.5,4.3],
        [-7.5,9.0],[-8.0,11.0]]),
    ("dahomey", "Dahomey & Yorubaland", "guinea", [
        [-1.0,11.0],[3.5,12.0],[6.0,9.5],[6.5,6.5],[4.0,5.5],[1.0,5.8],[-0.5,8.0],
        [-1.0,11.0]]),
    ("benin", "Benin & the Niger Delta", "guinea", [
        [6.0,9.5],[10.0,9.0],[9.0,5.5],[7.0,4.3],[5.0,4.5],[4.0,5.5],[6.5,6.5],
        [6.0,9.5]]),

    # ---------------- Kongo & the Congo Basin (central) ----------------
    ("cameroon", "Cameroon & the Grasslands", "kongo", [
        [10.0,9.0],[14.0,8.5],[18.0,8.5],[18.5,5.0],[16.0,2.0],[12.0,2.0],
        [9.5,4.0],[9.0,5.5],[10.0,9.0]]),
    ("gabon", "Gabon & Loango", "kongo", [
        [9.0,5.5],[9.5,4.0],[12.0,2.0],[13.0,-1.0],[12.0,-4.0],[9.0,-3.5],
        [8.5,1.0],[9.0,5.5]]),
    ("kongo_kingdom", "Kingdom of Kongo", "kongo", [
        [12.0,-4.0],[16.0,-4.5],[18.0,-6.5],[16.5,-9.0],[12.5,-9.5],[11.5,-6.0],
        [12.0,-4.0]]),
    ("congo_basin", "The Congo Basin", "kongo", [
        [13.0,-1.0],[18.5,5.0],[24.0,4.5],[27.0,1.0],[27.0,-4.0],[22.0,-6.0],
        [18.0,-6.5],[16.0,-4.5],[13.0,-1.0]]),
    ("katanga", "Luba & Katanga", "kongo", [
        [22.0,-6.0],[27.0,-4.0],[29.0,-7.0],[28.5,-11.5],[24.0,-12.0],[21.0,-9.0],
        [18.0,-6.5],[22.0,-6.0]]),

    # ---------------- Swahili Coast (E African coast + Zanzibar + lakes) ----------------
    ("buganda", "Buganda & the Lakes", "swahili", [
        [27.0,1.0],[31.0,3.5],[34.5,3.0],[35.0,-1.0],[33.0,-3.0],[30.0,-3.0],
        [29.0,0.0],[27.0,1.0]]),
    ("kenya_coast", "Mombasa & the Galla", "swahili", [
        [34.5,3.0],[39.0,5.0],[42.0,3.5],[44.0,1.5],[42.0,-2.0],[39.5,-4.5],
        [37.0,-3.0],[35.0,-1.0],[34.5,3.0]]),
    ("tanzania", "Zanzibar & Kilwa", "swahili", [
        [33.0,-3.0],[35.0,-1.0],[37.0,-3.0],[39.5,-4.5],[40.5,-7.5],[40.0,-10.5],
        [37.0,-11.0],[33.0,-9.0],[31.0,-5.0],[33.0,-3.0]]),
    ("mozambique", "Mozambique & Sofala", "swahili", [
        [37.0,-11.0],[40.5,-11.0],[40.5,-16.0],[35.0,-19.5],[33.0,-19.0],
        [32.5,-15.0],[33.0,-9.0],[37.0,-11.0]]),
    ("madagascar", "Madagascar", "swahili", [
        [43.5,-12.0],[49.5,-15.5],[50.5,-20.0],[47.5,-25.0],[44.5,-23.5],
        [43.5,-19.0],[43.5,-12.0]]),

    # ---------------- Zimbabwe & the South ----------------
    ("angola", "Ndongo & Angola", "zimbabwe", [
        [11.5,-6.0],[12.5,-9.5],[13.5,-13.0],[12.5,-17.0],[18.0,-17.5],
        [21.0,-13.0],[21.0,-9.0],[16.5,-9.0],[11.5,-6.0]]),
    ("zambezi", "Barotseland & the Zambezi", "zimbabwe", [
        [21.0,-9.0],[24.0,-12.0],[28.5,-11.5],[31.0,-13.0],[30.0,-16.0],
        [25.0,-18.0],[21.0,-17.5],[21.0,-13.0],[21.0,-9.0]]),
    ("zimbabwe_plateau", "Great Zimbabwe", "zimbabwe", [
        [25.0,-18.0],[30.0,-16.0],[33.0,-19.0],[32.0,-22.5],[29.0,-22.0],
        [26.0,-21.5],[25.0,-18.0]]),
    ("kalahari", "Kalahari & Botswana", "zimbabwe", [
        [18.0,-17.5],[21.0,-17.5],[25.0,-18.0],[26.0,-21.5],[25.0,-26.0],
        [20.0,-28.0],[16.0,-24.0],[14.0,-19.0],[18.0,-17.5]]),
    ("cape", "The Cape", "zimbabwe", [
        [16.0,-24.0],[20.0,-28.0],[25.0,-26.0],[29.0,-25.0],[31.5,-29.0],
        [27.0,-33.5],[22.0,-34.8],[17.5,-34.0],[14.5,-30.0],[16.0,-24.0]]),
    ("natal", "Natal & the Zulu", "zimbabwe", [
        [29.0,-25.0],[32.0,-22.5],[33.0,-19.0],[35.0,-19.5],[34.0,-26.5],
        [31.5,-29.0],[29.0,-25.0]]),
]

C = [
    # Maghreb chain
    ("morocco","algeria","land"),("algeria","ifriqiya","land"),
    ("ifriqiya","tripolitania","land"),("algeria","tripolitania","land"),
    # Maghreb -> Sahara/Sahel/Egypt
    ("morocco","senegambia","land"),("morocco","mali","land"),
    ("algeria","mali","land"),("algeria","songhai","land"),
    ("tripolitania","cyrenaica","land"),("tripolitania","wadai","land"),
    ("tripolitania","kanem","land"),
    # Egypt & Nubia
    ("cyrenaica","lower_egypt","land"),("cyrenaica","wadai","land"),
    ("lower_egypt","upper_egypt","land"),("upper_egypt","nubia","land"),
    ("nubia","tigray","land"),("nubia","eritrea","land"),("nubia","wadai","land"),
    ("upper_egypt","cyrenaica","land"),
    # Abyssinia & the Horn
    ("eritrea","tigray","land"),("tigray","shewa","land"),("eritrea","shewa","land"),
    ("shewa","somalia","land"),("eritrea","somalia","land"),
    ("shewa","kenya_coast","land"),("somalia","kenya_coast","land"),
    ("shewa","buganda","land"),
    # Sahel chain
    ("senegambia","mali","land"),("mali","songhai","land"),("songhai","hausa","land"),
    ("hausa","kanem","land"),("kanem","wadai","land"),
    ("senegambia","guinea_forest","land"),
    # Sahel -> Guinea forest
    ("mali","guinea_forest","land"),("mali","ivory","land"),("songhai","ivory","land"),
    ("songhai","dahomey","land"),("hausa","dahomey","land"),("hausa","benin","land"),
    ("kanem","cameroon","land"),("wadai","cameroon","land"),
    # Guinea coast chain
    ("guinea_forest","ivory","land"),("ivory","dahomey","land"),
    ("dahomey","benin","land"),("benin","cameroon","land"),
    # Kongo / Congo basin
    ("cameroon","gabon","land"),("cameroon","congo_basin","land"),
    ("gabon","congo_basin","land"),("gabon","kongo_kingdom","land"),
    ("congo_basin","kongo_kingdom","land"),("congo_basin","katanga","land"),
    ("kongo_kingdom","katanga","land"),("kongo_kingdom","angola","land"),
    ("congo_basin","buganda","land"),("katanga","zambezi","land"),
    ("congo_basin","wadai","land"),
    # Swahili / lakes
    ("buganda","kenya_coast","land"),("buganda","tanzania","land"),
    ("kenya_coast","tanzania","land"),("tanzania","mozambique","land"),
    ("buganda","katanga","land"),("tanzania","katanga","land"),
    ("tanzania","zambezi","land"),("mozambique","zambezi","land"),
    # Madagascar by sea
    ("madagascar","mozambique","sea"),("madagascar","tanzania","sea"),
    # Zimbabwe & the South
    ("angola","zambezi","land"),("angola","kalahari","land"),
    ("zambezi","zimbabwe_plateau","land"),("zambezi","kalahari","land"),
    ("zimbabwe_plateau","kalahari","land"),("zimbabwe_plateau","natal","land"),
    ("zimbabwe_plateau","mozambique","land"),("mozambique","natal","land"),
    ("kalahari","cape","land"),("cape","natal","land"),("kalahari","natal","land"),
]

if __name__ == "__main__":
    build_map(
        map_id="community_uncolonized_africa",
        name="Uncolonized Africa",
        description=(
            "Africa as a mosaic of its own indigenous powers, before the Scramble — the "
            "Maghreb and its Atlas, the Sahelian empires of the Niger bend, the Nile of "
            "Egypt and Nubia, the Abyssinian highlands and the Horn, the Swahili trading "
            "coast, the Kongo and the rainforest basin, the stone cities of Zimbabwe and "
            "the Cape, and the forest kingdoms of the Guinea Coast. Madagascar rides "
            "offshore, joined by sea."
        ),
        bounds=BOUNDS,
        regions=REGIONS,
        territories=T,
        connections=C,
        globe_view={"center_lat": 2.0, "center_lng": 18.0, "altitude": 1.2},
    )
