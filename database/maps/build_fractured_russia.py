"""
Fractured Russia — the Eurasian heartland splintered into rival successor states.
Reference genre: r/imaginarymaps "balkanized Russia / collapse of the Federation".

geo_polygon outlines trace the real northern-Eurasian geography: the Arctic coast,
the Baltic/Black/Caspian seas, the Pacific shore (Vladivostok, Sakhalin), the Ural
divide, the great Siberian rivers (Ob, Yenisei, Lena), and the Caucasus and Central
Asian steppe/deserts. East is capped at 150E to dodge the antimeridian (no Chukotka).
Built via mapkit.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from mapkit import build_map, load_admin

BOUNDS = {"minLng": 19.0, "maxLng": 150.0, "minLat": 40.0, "maxLat": 73.0}

REGIONS = [
    {"region_id": "muscovy",      "name": "Muscovy",                  "bonus": 5},
    {"region_id": "northwest",    "name": "Northwest",                "bonus": 4},
    {"region_id": "south_russia", "name": "Don & Kuban",              "bonus": 3},
    {"region_id": "caucasus",     "name": "Caucasus",                 "bonus": 3},
    {"region_id": "urals",        "name": "Urals Republic",           "bonus": 4},
    {"region_id": "siberia",      "name": "Siberia",                  "bonus": 7},
    {"region_id": "far_east",     "name": "Far Eastern Republic",     "bonus": 4},
    {"region_id": "central_asia", "name": "Turkestan",                "bonus": 5},
]

T = [
    # ---- Northwest (St. Petersburg / Karelia / Baltic littoral) ----
    ("ingria", "Ingria & St. Petersburg", "northwest", [
        [27.5,60.5],[30.5,60.2],[31.5,59.5],[30.5,58.3],[28.5,57.8],[27.6,58.6],[27.5,59.6],[27.5,60.5]]),
    ("karelia", "Karelia", "northwest", [
        [29.5,63.8],[34.0,64.6],[36.5,64.2],[37.0,62.6],[34.5,61.2],[31.5,61.0],[30.5,62.4],[29.5,63.8]]),
    ("kola", "Kola & Murmansk", "northwest", [
        [28.5,69.6],[33.0,69.8],[40.5,67.8],[41.0,66.0],[37.0,65.8],[33.0,66.4],[30.0,67.6],[28.5,68.6],[28.5,69.6]]),
    ("novgorod", "Novgorod & Pskov", "northwest", [
        [27.6,58.6],[30.5,58.3],[33.5,58.4],[34.5,57.0],[31.5,56.2],[28.6,56.4],[27.6,57.4],[27.6,58.6]]),
    ("vologda", "Vologda & the North", "northwest", [
        [37.0,62.6],[43.0,62.0],[46.5,61.0],[45.5,59.2],[41.0,58.8],[37.0,59.4],[34.5,61.2],[37.0,62.6]]),

    # ---- Muscovy (European Russian core / Moscow) ----
    ("moscow", "Moscow", "muscovy", [
        [34.5,57.0],[38.5,57.2],[40.5,56.2],[40.0,54.6],[37.0,54.0],[34.0,54.8],[33.5,56.2],[34.5,57.0]]),
    ("tver_yaroslavl", "Tver & Yaroslavl", "muscovy", [
        [33.5,58.4],[37.0,59.4],[41.0,58.8],[42.0,57.6],[40.5,56.2],[38.5,57.2],[34.5,57.0],[33.5,58.4]]),
    ("nizhny", "Nizhny Novgorod", "muscovy", [
        [42.0,57.6],[46.0,57.8],[47.5,56.4],[46.5,54.8],[43.0,54.6],[40.0,54.6],[40.5,56.2],[42.0,57.6]]),
    ("smolensk", "Smolensk & Bryansk", "muscovy", [
        [31.5,56.2],[34.5,57.0],[33.5,56.2],[34.0,54.8],[33.5,53.2],[31.0,52.6],[29.5,54.0],[31.5,56.2]]),
    ("chernozem", "Black Earth", "muscovy", [
        [37.0,54.0],[40.0,54.6],[43.0,54.6],[44.0,52.6],[42.0,51.0],[38.0,51.2],[35.5,52.4],[33.5,53.2],[34.0,54.8],[37.0,54.0]]),

    # ---- Don & Kuban (Cossack south) ----
    ("don", "Don Host", "south_russia", [
        [38.0,51.2],[42.0,51.0],[45.5,50.0],[45.0,48.0],[42.0,47.2],[39.0,47.6],[38.5,49.4],[38.0,51.2]]),
    ("kuban", "Kuban & Azov", "south_russia", [
        [37.0,47.4],[39.0,47.6],[42.0,47.2],[43.5,45.6],[41.0,44.2],[38.0,44.0],[36.8,45.4],[37.0,47.4]]),
    ("volgograd", "Tsaritsyn & Lower Volga", "south_russia", [
        [45.0,48.0],[48.5,49.4],[49.0,47.0],[47.5,45.6],[44.5,45.8],[43.5,46.6],[45.0,48.0]]),

    # ---- Caucasus (N. Caucasus + Transcaucasia) ----
    ("north_caucasus", "North Caucasus", "caucasus", [
        [41.0,44.2],[43.5,45.6],[44.5,45.8],[47.5,45.6],[48.0,44.0],[45.5,43.0],[42.0,43.0],[40.0,43.4],[41.0,44.2]]),
    ("transcaucasia", "Transcaucasia", "caucasus", [
        [40.0,43.4],[42.0,43.0],[45.5,43.0],[48.5,42.4],[49.5,40.6],[46.0,40.0],[43.0,40.4],[41.0,41.0],[40.0,43.4]]),

    # ---- Urals Republic ----
    ("perm", "Perm & Kama", "urals", [
        [45.5,59.2],[50.5,60.0],[55.0,59.4],[56.5,57.6],[54.0,56.4],[50.0,56.6],[47.0,57.4],[45.5,59.2]]),
    ("yekaterinburg", "Yekaterinburg", "urals", [
        [56.5,57.6],[61.0,58.0],[63.5,56.6],[62.0,54.8],[58.0,54.4],[54.5,55.0],[54.0,56.4],[56.5,57.6]]),
    ("bashkir_tatar", "Bashkortostan & Tatarstan", "urals", [
        [47.5,56.4],[50.0,56.6],[54.0,56.4],[54.5,55.0],[58.0,54.4],[56.5,52.6],[53.0,51.6],[49.0,52.0],[47.0,53.8],[46.5,54.8],[47.5,56.4]]),
    ("orenburg", "Orenburg Steppe", "urals", [
        [49.0,52.0],[53.0,51.6],[56.5,52.6],[58.0,54.4],[62.0,54.8],[61.5,52.0],[57.0,50.4],[52.0,50.4],[48.5,51.0],[49.0,52.0]]),

    # ---- Siberia (the great central/eastern taiga) ----
    ("ob_north", "Yamal & Lower Ob", "siberia", [
        [63.5,66.0],[72.0,67.0],[78.0,68.0],[80.0,72.4],[70.0,72.6],[64.0,70.0],[62.0,67.6],[63.5,66.0]]),
    ("ob_south", "Tyumen & Upper Ob", "siberia", [
        [61.0,58.0],[68.0,58.6],[74.0,59.0],[78.0,62.0],[78.0,68.0],[72.0,67.0],[63.5,66.0],[62.0,63.0],[61.0,58.0]]),
    ("altai", "Altai & Kuzbass", "siberia", [
        [62.0,54.8],[63.5,56.6],[68.0,58.6],[74.0,59.0],[78.0,56.4],[77.0,53.0],[72.0,51.4],[66.0,51.6],[62.0,52.4],[62.0,54.8]]),
    ("yenisei_north", "Taimyr & Lower Yenisei", "siberia", [
        [80.0,72.4],[88.0,73.0],[100.0,73.0],[105.0,72.0],[98.0,69.0],[90.0,67.4],[82.0,66.6],[78.0,68.0],[80.0,72.4]]),
    ("krasnoyarsk", "Krasnoyarsk & Central Yenisei", "siberia", [
        [78.0,56.4],[78.0,62.0],[82.0,66.6],[90.0,67.4],[98.0,65.0],[97.0,58.0],[94.0,54.0],[88.0,52.4],[82.0,52.6],[78.0,53.0],[78.0,56.4]]),
    ("baikal", "Irkutsk & Baikal", "siberia", [
        [97.0,58.0],[98.0,65.0],[104.0,64.0],[110.0,62.0],[113.0,57.0],[110.0,53.6],[104.0,51.8],[98.0,52.0],[94.0,54.0],[97.0,58.0]]),
    ("sakha_west", "Sakha & Central Lena", "siberia", [
        [105.0,72.0],[118.0,73.0],[128.0,72.4],[130.0,68.0],[124.0,62.0],[114.0,60.0],[110.0,62.0],[104.0,64.0],[98.0,65.0],[105.0,72.0]]),

    # ---- Far Eastern Republic (Pacific coast / Amur / Primorye) ----
    ("yakutia_east", "Verkhoyansk & Kolyma", "far_east", [
        [128.0,72.4],[140.0,72.0],[149.0,69.0],[149.0,62.0],[140.0,60.0],[130.0,60.0],[124.0,62.0],[130.0,68.0],[128.0,72.4]]),
    ("magadan", "Magadan & Okhotsk Coast", "far_east", [
        [140.0,60.0],[149.0,62.0],[149.0,55.0],[143.0,52.0],[137.0,54.0],[135.0,58.0],[140.0,60.0]]),
    ("amur", "Amur & Zabaikalye", "far_east", [
        [113.0,57.0],[124.0,62.0],[135.0,58.0],[137.0,54.0],[132.0,50.4],[124.0,49.6],[116.0,50.0],[110.0,53.6],[113.0,57.0]]),
    ("primorye", "Primorye & Vladivostok", "far_east", [
        [132.0,50.4],[137.0,54.0],[140.0,51.0],[136.0,47.0],[131.0,43.2],[130.0,46.0],[130.5,48.6],[132.0,50.4]]),
    ("sakhalin", "Sakhalin", "far_east", [
        [142.0,54.0],[144.5,53.0],[144.0,50.0],[143.0,46.5],[141.5,48.0],[142.0,51.5],[142.0,54.0]]),

    # ---- Turkestan (Kazakh steppe + Central Asian khanates) ----
    ("west_kazakhstan", "West Kazakh Steppe", "central_asia", [
        [48.5,51.0],[52.0,50.4],[57.0,50.4],[61.5,52.0],[62.0,52.4],[62.0,48.0],[58.0,45.6],[52.0,45.0],[49.0,46.4],[48.0,48.6],[48.5,51.0]]),
    ("central_kazakhstan", "Sary-Arka", "central_asia", [
        [62.0,52.4],[66.0,51.6],[72.0,51.4],[77.0,53.0],[78.0,50.0],[77.0,46.0],[72.0,44.6],[66.0,44.6],[62.0,48.0],[62.0,52.4]]),
    ("turkestan_south", "Khiva & Bukhara", "central_asia", [
        [52.0,45.0],[58.0,45.6],[62.0,48.0],[66.0,44.6],[65.0,41.0],[60.0,40.0],[55.0,40.2],[51.0,41.6],[52.0,45.0]]),
    ("ferghana", "Tashkent & Ferghana", "central_asia", [
        [66.0,44.6],[72.0,44.6],[77.0,46.0],[78.0,43.0],[74.0,40.6],[69.0,40.0],[65.0,41.0],[66.0,44.6]]),
]

C = [
    # Northwest internal
    ("ingria","karelia","land"),("ingria","novgorod","land"),
    ("karelia","kola","land"),("karelia","vologda","land"),("karelia","novgorod","land"),
    ("kola","vologda","land"),
    ("novgorod","vologda","land"),("novgorod","moscow","land"),("novgorod","tver_yaroslavl","land"),("novgorod","smolensk","land"),
    ("vologda","tver_yaroslavl","land"),("vologda","perm","land"),("vologda","nizhny","land"),
    # Muscovy internal
    ("moscow","tver_yaroslavl","land"),("moscow","smolensk","land"),("moscow","chernozem","land"),("moscow","nizhny","land"),
    ("tver_yaroslavl","nizhny","land"),
    ("nizhny","chernozem","land"),("nizhny","bashkir_tatar","land"),("nizhny","perm","land"),
    ("smolensk","chernozem","land"),
    ("chernozem","don","land"),("chernozem","bashkir_tatar","land"),
    # Don & Kuban
    ("don","kuban","land"),("don","volgograd","land"),
    ("kuban","volgograd","land"),("kuban","north_caucasus","land"),
    ("volgograd","north_caucasus","land"),("volgograd","west_kazakhstan","land"),("volgograd","bashkir_tatar","land"),("volgograd","orenburg","land"),
    # Caucasus
    ("north_caucasus","transcaucasia","land"),("north_caucasus","west_kazakhstan","land"),
    # Urals
    ("perm","yekaterinburg","land"),("perm","bashkir_tatar","land"),("perm","ob_south","land"),
    ("yekaterinburg","bashkir_tatar","land"),("yekaterinburg","orenburg","land"),("yekaterinburg","ob_south","land"),("yekaterinburg","altai","land"),
    ("bashkir_tatar","orenburg","land"),
    ("orenburg","west_kazakhstan","land"),("orenburg","central_kazakhstan","land"),("orenburg","altai","land"),
    # Siberia
    ("ob_north","ob_south","land"),("ob_north","yenisei_north","land"),
    ("ob_south","altai","land"),("ob_south","krasnoyarsk","land"),("ob_south","yenisei_north","land"),
    ("altai","krasnoyarsk","land"),("altai","central_kazakhstan","land"),
    ("yenisei_north","krasnoyarsk","land"),("yenisei_north","sakha_west","land"),
    ("krasnoyarsk","baikal","land"),("krasnoyarsk","sakha_west","land"),
    ("baikal","sakha_west","land"),("baikal","amur","land"),
    ("sakha_west","yakutia_east","land"),("sakha_west","amur","land"),
    # Far East
    ("yakutia_east","magadan","land"),("yakutia_east","amur","land"),
    ("magadan","amur","land"),
    ("amur","primorye","land"),
    ("primorye","sakhalin","sea"),
    ("magadan","sakhalin","sea"),
    # Turkestan
    ("west_kazakhstan","central_kazakhstan","land"),("west_kazakhstan","turkestan_south","land"),
    ("central_kazakhstan","turkestan_south","land"),("central_kazakhstan","ferghana","land"),
    ("turkestan_south","ferghana","land"),
]

ADMIN = load_admin("community_fractured_russia")

if __name__ == "__main__":
    build_map(
        map_id="community_fractured_russia",
        name="Fractured Russia",
        description=(
            "The largest country on Earth comes apart at the seams. From the Baltic littoral "
            "to the Pacific shore, eight successor states carve up northern Eurasia — Muscovy's "
            "European core, the Northwest of St. Petersburg and Karelia, the Cossack Don and "
            "Kuban, the volatile Caucasus, an independent Urals Republic, the boundless Siberian "
            "taiga, the Pacific-facing Far Eastern Republic, and the Central Asian steppe of "
            "Turkestan. Rivers, ranges, and frozen coasts draw every frontier."
        ),
        bounds=BOUNDS,
        regions=REGIONS,
        territories=T,
        connections=C,
        admin_refs=ADMIN,
        globe_view={"center_lat": 60.0, "center_lng": 80.0, "altitude": 1.25},
    )
