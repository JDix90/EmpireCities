"""
Balkanized South America — the continent fractured into its post-Bolivarian
successor states. The map traces the real Pacific and Atlantic coasts, the
Caribbean rim, the Andean cordillera spine, the Amazon/Orinoco/Paraná river
systems, and Patagonia tapering toward Tierra del Fuego.

Six powers: Greater Argentina / Río de la Plata, the Empire of Brazil, Gran
Colombia, the Andean Federation, Chile (the long Pacific ribbon), and the
landlocked Guaraní heartland of Paraguay. Built via mapkit.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from mapkit import build_map, load_admin

BOUNDS = {"minLng": -82.0, "maxLng": -34.0, "minLat": -56.0, "maxLat": 13.0}

REGIONS = [
    {"region_id": "plata",         "name": "Greater Argentina / Río de la Plata", "bonus": 6},
    {"region_id": "brazil",        "name": "Empire of Brazil",                    "bonus": 7},
    {"region_id": "gran_colombia", "name": "Gran Colombia",                       "bonus": 5},
    {"region_id": "andes",         "name": "Andean Federation",                   "bonus": 4},
    {"region_id": "chile",         "name": "Chile",                               "bonus": 4},
    {"region_id": "guarani",       "name": "Guaraní / Paraguay",                  "bonus": 2},
]

T = [
    # ---- Gran Colombia (the northern bulge: Colombia, Venezuela, Ecuador) ----
    ("gc_caribbean", "Caribbean Coast", "gran_colombia", [
        [-77.5,8.0],[-75.5,9.4],[-73.5,11.0],[-71.5,11.8],[-69.0,11.6],[-68.5,10.3],
        [-71.0,9.2],[-73.0,8.0],[-75.5,7.6],[-77.5,8.0]]),
    ("gc_venezuela", "Venezuelan Llanos", "gran_colombia", [
        [-68.5,10.3],[-69.0,11.6],[-64.0,10.6],[-61.0,9.8],[-60.0,8.0],[-62.0,6.0],
        [-66.0,6.2],[-69.0,7.0],[-71.0,9.2],[-68.5,10.3]]),
    ("gc_orinoco", "Orinoco Delta & Guayana", "gran_colombia", [
        [-60.0,8.0],[-61.0,9.8],[-59.5,8.4],[-58.5,6.8],[-60.5,4.5],[-63.0,3.8],
        [-64.0,5.0],[-62.0,6.0],[-60.0,8.0]]),
    ("gc_bogota", "Andean Colombia", "gran_colombia", [
        [-77.5,8.0],[-75.5,7.6],[-73.0,8.0],[-71.0,9.2],[-69.0,7.0],[-70.5,4.5],
        [-73.5,2.5],[-76.0,2.0],[-77.5,4.0],[-77.0,6.0],[-77.5,8.0]]),
    ("gc_ecuador", "Ecuador", "gran_colombia", [
        [-77.5,4.0],[-76.0,2.0],[-73.5,2.5],[-74.5,0.0],[-75.5,-2.0],[-79.0,-2.5],
        [-80.5,-1.0],[-80.0,1.0],[-78.5,2.5],[-77.5,4.0]]),

    # ---- Brazil (the Atlantic east and the Amazon basin) ----
    ("br_amazonas", "Amazonas", "brazil", [
        [-69.0,7.0],[-66.0,6.2],[-62.0,6.0],[-63.0,3.8],[-60.5,4.5],[-58.5,6.8],
        [-56.0,4.0],[-54.0,2.0],[-56.0,-2.0],[-62.0,-5.0],[-68.0,-5.0],[-70.5,-2.5],
        [-69.5,2.0],[-69.0,7.0]]),
    ("br_para", "Pará & the Amazon Mouth", "brazil", [
        [-56.0,4.0],[-51.0,4.0],[-48.5,0.0],[-44.0,-2.5],[-47.0,-5.5],[-52.0,-5.0],
        [-56.0,-2.0],[-54.0,2.0],[-56.0,4.0]]),
    ("br_nordeste", "Nordeste", "brazil", [
        [-44.0,-2.5],[-38.0,-4.0],[-35.0,-7.0],[-37.0,-11.0],[-41.0,-12.0],[-44.0,-10.0],
        [-47.0,-9.0],[-47.0,-5.5],[-44.0,-2.5]]),
    ("br_bahia", "Bahia", "brazil", [
        [-41.0,-12.0],[-37.0,-11.0],[-38.5,-15.5],[-39.5,-18.0],[-43.0,-17.5],[-45.0,-14.0],
        [-44.0,-10.0],[-41.0,-12.0]]),
    ("br_minas", "Minas Gerais", "brazil", [
        [-47.0,-9.0],[-44.0,-10.0],[-45.0,-14.0],[-43.0,-17.5],[-45.5,-20.5],[-49.0,-20.0],
        [-51.0,-17.0],[-50.5,-13.0],[-47.0,-9.0]]),
    ("br_rio", "Rio de Janeiro & Espírito Santo", "brazil", [
        [-39.5,-18.0],[-40.5,-21.0],[-43.5,-23.5],[-46.0,-24.0],[-45.5,-20.5],[-43.0,-17.5],
        [-39.5,-18.0]]),
    ("br_saopaulo", "São Paulo", "brazil", [
        [-46.0,-24.0],[-48.5,-25.5],[-51.0,-24.0],[-53.0,-22.5],[-51.0,-20.0],[-49.0,-20.0],
        [-45.5,-20.5],[-46.0,-24.0]]),
    ("br_sul", "Brazilian South", "brazil", [
        [-48.5,-25.5],[-50.5,-28.5],[-52.5,-31.0],[-56.0,-30.5],[-57.5,-28.0],[-55.0,-25.5],
        [-53.0,-22.5],[-51.0,-24.0],[-48.5,-25.5]]),
    ("br_matogrosso", "Mato Grosso & Pantanal", "brazil", [
        [-62.0,-5.0],[-56.0,-2.0],[-52.0,-5.0],[-47.0,-5.5],[-47.0,-9.0],[-50.5,-13.0],
        [-51.0,-17.0],[-55.0,-17.5],[-58.5,-16.0],[-60.0,-13.0],[-65.0,-11.0],[-63.0,-8.5],
        [-62.0,-5.0]]),

    # ---- Andean Federation (Peru + Bolivia, the high cordillera) ----
    ("an_peru_north", "Northern Peru", "andes", [
        [-79.0,-2.5],[-75.5,-2.0],[-73.5,-4.5],[-72.0,-7.0],[-74.5,-9.5],[-77.5,-9.0],
        [-79.5,-7.0],[-81.0,-5.0],[-80.5,-3.5],[-79.0,-2.5]]),
    ("an_peru_central", "Lima & Central Peru", "andes", [
        [-77.5,-9.0],[-74.5,-9.5],[-72.0,-11.5],[-73.0,-14.0],[-75.5,-15.0],[-77.0,-12.5],
        [-77.5,-9.0]]),
    ("an_peru_south", "Cusco & Arequipa", "andes", [
        [-75.5,-15.0],[-73.0,-14.0],[-70.0,-14.5],[-68.5,-16.0],[-70.5,-17.5],[-72.5,-17.0],
        [-75.5,-15.0]]),
    ("an_altiplano", "Bolivian Altiplano", "andes", [
        [-72.0,-11.5],[-69.0,-11.0],[-66.5,-12.5],[-66.0,-16.0],[-67.5,-19.0],[-68.5,-16.0],
        [-70.0,-14.5],[-73.0,-14.0],[-72.0,-11.5]]),
    ("an_bolivia_east", "Santa Cruz & the Chaco Frontier", "andes", [
        [-65.0,-11.0],[-60.0,-13.0],[-58.5,-16.0],[-58.0,-19.5],[-62.0,-21.5],[-66.0,-19.5],
        [-67.5,-19.0],[-66.0,-16.0],[-66.5,-12.5],[-65.0,-11.0]]),

    # ---- Chile (the long thin Pacific ribbon, west of the Andes spine) ----
    ("cl_norte", "Norte Grande (Atacama)", "chile", [
        [-70.5,-17.5],[-68.5,-19.5],[-68.5,-23.0],[-70.0,-25.5],[-71.5,-23.0],[-70.5,-20.0],
        [-70.5,-17.5]]),
    ("cl_centro", "Central Chile", "chile", [
        [-70.0,-25.5],[-69.5,-28.0],[-70.0,-32.0],[-71.5,-34.5],[-73.0,-33.0],[-72.0,-29.0],
        [-71.5,-26.0],[-70.0,-25.5]]),
    ("cl_araucania", "Araucanía & the Lakes", "chile", [
        [-71.5,-34.5],[-71.0,-37.5],[-72.0,-40.5],[-73.5,-41.5],[-74.0,-39.0],[-73.5,-36.0],
        [-73.0,-33.0],[-71.5,-34.5]]),
    ("cl_patagonia", "Chilean Patagonia & Magallanes", "chile", [
        [-73.5,-41.5],[-72.0,-40.5],[-71.5,-44.0],[-72.5,-48.0],[-72.0,-52.0],[-70.0,-54.5],
        [-74.0,-53.0],[-75.5,-49.0],[-74.5,-44.0],[-73.5,-41.5]]),

    # ---- Guaraní / Paraguay (the landlocked interior, between the rivers) ----
    ("gu_chaco", "Gran Chaco", "guarani", [
        [-62.0,-21.5],[-58.0,-19.5],[-57.5,-22.0],[-59.0,-24.5],[-61.5,-24.0],[-62.5,-22.5],
        [-62.0,-21.5]]),
    ("gu_oriental", "Eastern Paraguay", "guarani", [
        [-57.5,-22.0],[-55.0,-22.5],[-54.5,-25.0],[-56.0,-27.0],[-58.0,-26.5],[-59.0,-24.5],
        [-57.5,-22.0]]),

    # ---- Greater Argentina / Río de la Plata (Argentina + Uruguay) ----
    ("pl_norte", "Argentine Northwest", "plata", [
        [-66.0,-19.5],[-62.0,-21.5],[-62.5,-22.5],[-63.5,-25.0],[-65.0,-27.0],[-67.5,-25.5],
        [-66.5,-22.0],[-66.0,-19.5]]),
    ("pl_litoral", "Litoral & Mesopotamia", "plata", [
        [-61.5,-24.0],[-59.0,-24.5],[-54.5,-25.5],[-55.5,-28.5],[-58.0,-31.5],
        [-60.5,-31.0],[-61.5,-28.0],[-61.5,-24.0]]),
    ("pl_cordoba", "Córdoba & Cuyo", "plata", [
        [-67.5,-25.5],[-65.0,-27.0],[-63.5,-25.0],[-61.5,-28.0],[-62.0,-32.0],[-64.5,-33.5],
        [-68.0,-33.0],[-69.0,-30.0],[-68.0,-27.0],[-67.5,-25.5]]),
    ("pl_buenosaires", "Buenos Aires & the Pampas", "plata", [
        [-61.5,-28.0],[-60.5,-31.0],[-58.0,-31.5],[-57.0,-34.0],[-57.5,-37.5],[-60.5,-38.5],
        [-63.0,-37.0],[-64.5,-33.5],[-62.0,-32.0],[-61.5,-28.0]]),
    ("pl_uruguay", "Uruguay", "plata", [
        [-58.0,-31.5],[-55.0,-31.0],[-53.5,-33.0],[-54.5,-34.8],[-57.0,-34.8],[-57.0,-34.0],
        [-58.0,-31.5]]),
    ("pl_mendoza", "Mendoza & the Andean Frontier", "plata", [
        [-69.0,-30.0],[-68.0,-33.0],[-69.5,-35.5],[-70.5,-36.0],[-70.5,-33.0],[-70.0,-32.0],
        [-69.5,-28.0],[-69.0,-30.0]]),
    ("pl_pampa_sur", "La Pampa & Neuquén", "plata", [
        [-68.0,-33.0],[-64.5,-33.5],[-63.0,-37.0],[-64.0,-39.5],[-67.5,-39.5],[-70.5,-38.5],
        [-70.5,-36.0],[-69.5,-35.5],[-68.0,-33.0]]),
    ("pl_patagonia", "Argentine Patagonia", "plata", [
        [-70.5,-38.5],[-67.5,-39.5],[-64.0,-39.5],[-65.5,-43.0],[-68.0,-45.5],[-71.5,-44.0],
        [-72.0,-40.5],[-71.0,-37.5],[-70.5,-38.5]]),
    ("pl_santacruz", "Santa Cruz & Tierra del Fuego", "plata", [
        [-71.5,-44.0],[-68.0,-45.5],[-66.0,-49.0],[-68.5,-52.5],[-66.5,-54.8],[-70.0,-54.5],
        [-72.0,-52.0],[-72.5,-48.0],[-71.5,-44.0]]),
]

C = [
    # Gran Colombia internal
    ("gc_caribbean","gc_venezuela","land"),("gc_caribbean","gc_bogota","land"),
    ("gc_venezuela","gc_orinoco","land"),("gc_venezuela","gc_bogota","land"),
    ("gc_orinoco","gc_bogota","land"),("gc_bogota","gc_ecuador","land"),
    # Gran Colombia -> Brazil & Andes
    ("gc_venezuela","br_amazonas","land"),("gc_orinoco","br_amazonas","land"),
    ("gc_bogota","br_amazonas","land"),("gc_ecuador","br_amazonas","land"),
    ("gc_ecuador","an_peru_north","land"),
    # Brazil internal
    ("br_amazonas","br_para","land"),("br_amazonas","br_matogrosso","land"),
    ("br_para","br_nordeste","land"),("br_para","br_matogrosso","land"),
    ("br_nordeste","br_bahia","land"),("br_nordeste","br_minas","land"),
    ("br_nordeste","br_matogrosso","land"),
    ("br_bahia","br_minas","land"),("br_bahia","br_rio","land"),
    ("br_minas","br_rio","land"),("br_minas","br_saopaulo","land"),("br_minas","br_matogrosso","land"),
    ("br_rio","br_saopaulo","land"),
    ("br_saopaulo","br_sul","land"),("br_saopaulo","br_matogrosso","land"),
    ("br_sul","pl_litoral","land"),("br_sul","pl_uruguay","land"),("br_sul","gu_oriental","land"),
    ("br_matogrosso","an_bolivia_east","land"),("br_matogrosso","gu_chaco","land"),
    ("br_matogrosso","gu_oriental","land"),
    # Brazil -> Andes (Amazonas/Matogrosso to Bolivia/Peru)
    ("br_amazonas","an_peru_north","land"),("br_amazonas","an_altiplano","land"),
    ("br_matogrosso","an_altiplano","land"),
    # Andes internal (spine)
    ("an_peru_north","an_peru_central","land"),("an_peru_north","an_altiplano","land"),
    ("an_peru_central","an_peru_south","land"),("an_peru_central","an_altiplano","land"),
    ("an_peru_south","an_altiplano","land"),
    ("an_altiplano","an_bolivia_east","land"),
    # Chile along the Andes -> Andes & Plata
    ("cl_norte","an_peru_south","land"),("cl_norte","an_altiplano","land"),
    ("cl_norte","cl_centro","land"),
    ("cl_centro","cl_araucania","land"),("cl_centro","pl_mendoza","land"),("cl_centro","pl_cordoba","land"),
    ("cl_araucania","cl_patagonia","land"),("cl_araucania","pl_pampa_sur","land"),
    ("cl_araucania","pl_patagonia","land"),
    ("cl_patagonia","pl_patagonia","land"),("cl_patagonia","pl_santacruz","land"),
    ("cl_norte","pl_norte","land"),
    # Guaraní
    ("gu_chaco","gu_oriental","land"),("gu_chaco","an_bolivia_east","land"),
    ("gu_chaco","pl_norte","land"),("gu_chaco","pl_litoral","land"),
    ("gu_oriental","pl_litoral","land"),
    # Plata internal
    ("pl_norte","pl_cordoba","land"),("pl_norte","an_bolivia_east","land"),
    ("pl_litoral","pl_buenosaires","land"),("pl_litoral","pl_cordoba","land"),
    ("pl_litoral","pl_uruguay","land"),
    ("pl_cordoba","pl_buenosaires","land"),("pl_cordoba","pl_mendoza","land"),
    ("pl_buenosaires","pl_pampa_sur","land"),("pl_buenosaires","pl_uruguay","land"),
    ("pl_mendoza","pl_pampa_sur","land"),
    ("pl_pampa_sur","pl_patagonia","land"),
    ("pl_patagonia","pl_santacruz","land"),
]

ADMIN = load_admin("community_south_america")

if __name__ == "__main__":
    build_map(
        map_id="community_south_america",
        name="Balkanized South America",
        description=(
            "South America shattered into its post-Bolivarian successor states — "
            "Greater Argentina on the Pampas, the Empire of Brazil across the Atlantic "
            "east and the Amazon, Gran Colombia along the Caribbean and Orinoco, the "
            "Andean Federation high on the cordillera, the long ribbon of Chile pinned "
            "between the mountains and the Pacific, and the landlocked Guaraní heartland. "
            "Borders run with the great rivers, the Andean spine, and Patagonia's long "
            "tapering reach toward Tierra del Fuego."
        ),
        bounds=BOUNDS,
        regions=REGIONS,
        territories=T,
        connections=C,
        admin_refs=ADMIN,
        globe_view={"center_lat": -20.0, "center_lng": -60.0, "altitude": 1.15},
    )
