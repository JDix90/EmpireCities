#!/usr/bin/env python3
"""Generate era_space_age.json — 2100-projected Earth + Moon territories for the Space Age era."""

import json
from pathlib import Path


def rect_poly(min_lng: float, max_lng: float, min_lat: float, max_lat: float):
    """Closed ring in WGS84 [lng, lat] — counter-clockwise exterior."""
    return [
        [min_lng, min_lat],
        [max_lng, min_lat],
        [max_lng, max_lat],
        [min_lng, max_lat],
        [min_lng, min_lat],
    ]


def canvas_from_geo(min_lng, max_lng, min_lat, max_lat, canvas_w=1200, canvas_h=700,
                    proj=(-180, 180, -60, 85)):
    """Project a lat/lng bbox into the canvas pixel space used by the 2D view."""
    pmin_lng, pmax_lng, pmin_lat, pmax_lat = proj
    def proj_pt(lng, lat):
        x = (lng - pmin_lng) / (pmax_lng - pmin_lng) * canvas_w
        y = (pmax_lat - lat) / (pmax_lat - pmin_lat) * canvas_h
        return [round(x, 1), round(y, 1)]
    return [
        proj_pt(min_lng, min_lat),
        proj_pt(max_lng, min_lat),
        proj_pt(max_lng, max_lat),
        proj_pt(min_lng, max_lat),
    ]


def center(min_lng, max_lng, min_lat, max_lat, canvas_w=1200, canvas_h=700,
           proj=(-180, 180, -60, 85)):
    pmin_lng, pmax_lng, pmin_lat, pmax_lat = proj
    mid_lng = (min_lng + max_lng) / 2
    mid_lat = (min_lat + max_lat) / 2
    x = (mid_lng - pmin_lng) / (pmax_lng - pmin_lng) * canvas_w
    y = (pmax_lat - mid_lat) / (pmax_lat - pmin_lat) * canvas_h
    return [round(x, 1), round(y, 1)]


# ── Earth 2100 territories ────────────────────────────────────────────────
# Each tuple: (territory_id, name, region_id, min_lng, max_lng, min_lat, max_lat)
EARTH_TERRITORIES = [
    # North American Union (6)
    ('na_arctic_dominion',   'Arctic Dominion',         'north_america_2100', -141, -60, 60, 83),
    ('na_western_states',    'Pacific Megastate',       'north_america_2100', -125, -100, 32, 60),
    ('na_central_plains',    'Central Plains Bloc',     'north_america_2100', -100, -85, 32, 55),
    ('na_launch_base',       'Cape Canaveral Hub',      'north_america_2100', -85, -75, 25, 35),
    ('na_eastern_corridor',  'Eastern Corridor',        'north_america_2100', -85, -65, 35, 55),
    ('na_southern_belt',     'Gulf-Mexico Union',       'north_america_2100', -120, -85, 12, 32),

    # European Confederacy (6)
    ('euro_british_isles',   'British Isles',           'europe_2100',        -11, 3, 49, 61),
    ('euro_iberia',          'Iberian Federation',      'europe_2100',        -10, 5, 35, 44),
    ('euro_spaceport',       'Kourou Spaceport',        'europe_2100',        3, 15, 41, 50),  # relocated to central Europe for 2100 narrative
    ('euro_nordic',          'Nordic Commonwealth',     'europe_2100',        5, 31, 54, 71),
    ('euro_balkan',          'Balkan Belt',             'europe_2100',        12, 30, 38, 49),
    ('euro_east',            'Carpathian Union',        'europe_2100',        22, 45, 45, 58),

    # Sino-Pacific Zone (8)
    ('asia_cosmodrome',      'Gobi Cosmodrome',         'asia_2100',          95, 115, 40, 50),
    ('asia_heartland',       'Mandarin Heartland',      'asia_2100',          100, 125, 28, 40),
    ('asia_coastal',         'Coastal Megacities',      'asia_2100',          115, 125, 20, 32),
    ('asia_korea_archipelago','Korean Archipelago',     'asia_2100',          125, 145, 32, 45),
    ('asia_indochina',       'Indochina Federation',    'asia_2100',          95, 110, 8, 25),
    ('asia_malay_archipelago','Malay Archipelago',      'asia_2100',          95, 141, -11, 8),
    ('asia_japan_islands',   'Japan Islands',           'asia_2100',          130, 146, 30, 46),
    ('asia_siberia_belt',    'Siberian Corridor',       'asia_2100',          60, 140, 50, 75),

    # Sub-Saharan African Union (6)
    ('africa_sahel',         'Sahel Belt',              'sub_saharan_africa_2100', -17, 40, 10, 20),
    ('africa_west',          'West African Union',      'sub_saharan_africa_2100', -17, 10, -2, 14),
    ('africa_horn',          'Horn of Africa',          'sub_saharan_africa_2100', 35, 52, -2, 18),
    ('africa_congo_basin',   'Congo Basin Federation',  'sub_saharan_africa_2100', 10, 30, -13, 5),
    ('africa_east',          'East African Commonwealth','sub_saharan_africa_2100', 30, 42, -12, 5),
    ('africa_south',         'Southern African Union',  'sub_saharan_africa_2100', 12, 36, -35, -15),

    # Solar Caliphate Core (5)
    ('mena_levant',          'Levantine Prefecture',    'middle_east_2100',   32, 45, 29, 38),
    ('mena_arabia',          'Arabian Photovoltaic',    'middle_east_2100',   35, 55, 15, 30),
    ('mena_persia',          'Persian Sun Belt',        'middle_east_2100',   44, 63, 25, 40),
    ('mena_maghreb',         'Maghreb Array',           'middle_east_2100',   -17, 12, 22, 37),
    ('mena_nile',            'Nile Corridor',           'middle_east_2100',   24, 38, 18, 32),

    # Central Asia Corridor (5)
    ('ca_steppe',            'Steppe Federation',       'central_asia_2100',  50, 90, 40, 55),
    ('ca_tien_shan',         'Tien Shan Belt',          'central_asia_2100',  68, 85, 36, 45),
    ('ca_indus',             'Indus Riparian Zone',     'central_asia_2100',  60, 78, 22, 38),
    ('ca_ganges',            'Ganges Megaregion',       'central_asia_2100',  72, 92, 20, 32),
    ('ca_deccan',            'Deccan Plateau',          'central_asia_2100',  72, 88, 8, 22),

    # Latin American Bloc (5)
    ('la_amazonia',          'Amazon Preserve',         'latin_america_2100', -74, -46, -10, 5),
    ('la_andes',             'Andean Federation',       'latin_america_2100', -81, -62, -20, -2),
    ('la_pampas',            'Pampas Republic',         'latin_america_2100', -71, -53, -40, -22),
    ('la_patagonia',         'Patagonian Free Zone',    'latin_america_2100', -75, -52, -56, -40),
    ('la_caribbean',         'Caribbean Alliance',      'latin_america_2100', -90, -60, 10, 26),

    # Pacific Rim Alliance (4)
    ('oc_australia',         'Australian Meridian',     'oceania_2100',       115, 153, -40, -12),
    ('oc_new_zealand',       'New Zealand',             'oceania_2100',       166, 179, -47, -34),
    ('oc_micronesia',        'Micronesian Shield',      'oceania_2100',       135, 170, 0, 20),
    ('oc_polynesia',         'Polynesian Compact',      'oceania_2100',       -175, -140, -25, 5),

    # Coastal Megacity Belt (1 virtual special territory — represents worldwide megacity corporate zone)
    ('megacity_pacific_rim', 'Pacific Rim Megacities',  'coastal_megacities_2100', 130, 145, 22, 38),
]


# ── Moon territories ──────────────────────────────────────────────────────
# Lunar surface is mapped to lat [-85, 85], lng [-180, 180] so react-globe.gl can render it.
# 9 tiles cover the full visible surface with near/far sides, mare regions, and polar basins.
MOON_TERRITORIES = [
    ('moon_near_side_north',      'Mare Frigoris',        -60,  60, 40, 80),
    ('moon_mare_imbrium',         'Mare Imbrium',         -60, -10, 15, 40),
    ('moon_mare_tranquillitatis', 'Sea of Tranquility',   -10,  50, 10, 40),
    ('moon_oceanus_procellarum',  'Ocean of Storms',     -120, -60, -10, 40),
    ('moon_near_side_south',      'Mare Nubium',          -60,  30, -40, 10),
    ('moon_far_side_north',       'Far Side Highlands N',  60, 180, 10, 60),
    ('moon_far_side_south',       'Far Side Highlands S',  60, 180, -40, 10),
    ('moon_polar_north',          'North Polar Basin',   -180, 180, 60, 85),
    ('moon_polar_south',          'South Pole-Aitken',   -180, 180, -85, -40),
]


def main():
    territories_json = []

    # Earth territories — add geo_polygon + canvas polygon
    for tid, name, region, mn_lng, mx_lng, mn_lat, mx_lat in EARTH_TERRITORIES:
        territories_json.append({
            'territory_id': tid,
            'name': name,
            'polygon': canvas_from_geo(mn_lng, mx_lng, mn_lat, mx_lat),
            'center_point': center(mn_lng, mx_lng, mn_lat, mx_lat),
            'region_id': region,
            'geo_polygon': rect_poly(mn_lng, mx_lng, mn_lat, mx_lat),
        })

    # Moon territories
    for tid, name, mn_lng, mx_lng, mn_lat, mx_lat in MOON_TERRITORIES:
        territories_json.append({
            'territory_id': tid,
            'name': name,
            'polygon': canvas_from_geo(mn_lng, mx_lng, mn_lat, mx_lat),
            'center_point': center(mn_lng, mx_lng, mn_lat, mx_lat),
            'region_id': 'lunar_surface',
            'globe_id': 'moon',
            'geo_polygon': rect_poly(mn_lng, mx_lng, mn_lat, mx_lat),
        })

    regions = [
        {'region_id': 'north_america_2100',      'name': 'North American Union',     'bonus': 5},
        {'region_id': 'europe_2100',             'name': 'European Confederacy',     'bonus': 5},
        {'region_id': 'asia_2100',               'name': 'Sino-Pacific Zone',        'bonus': 7},
        {'region_id': 'sub_saharan_africa_2100', 'name': 'African Union',            'bonus': 4},
        {'region_id': 'middle_east_2100',        'name': 'Solar Caliphate Core',     'bonus': 4},
        {'region_id': 'central_asia_2100',       'name': 'Central Asia Corridor',    'bonus': 3},
        {'region_id': 'latin_america_2100',      'name': 'South American Bloc',      'bonus': 4},
        {'region_id': 'oceania_2100',            'name': 'Pacific Rim Alliance',     'bonus': 3},
        {'region_id': 'coastal_megacities_2100', 'name': 'Coastal Megacity Belt',    'bonus': 1},
        {'region_id': 'lunar_surface',           'name': 'Lunar Surface',            'bonus': 8},
    ]

    # ── Connections ────────────────────────────────────────────────────────
    connections = [
        # North American Union internal
        ('na_arctic_dominion',  'na_western_states',    'land'),
        ('na_arctic_dominion',  'na_central_plains',    'land'),
        ('na_arctic_dominion',  'na_eastern_corridor',  'land'),
        ('na_western_states',   'na_central_plains',    'land'),
        ('na_western_states',   'na_southern_belt',     'land'),
        ('na_central_plains',   'na_southern_belt',     'land'),
        ('na_central_plains',   'na_eastern_corridor',  'land'),
        ('na_eastern_corridor', 'na_launch_base',       'land'),
        ('na_launch_base',      'na_southern_belt',     'land'),

        # NA ↔ LA
        ('na_southern_belt',    'la_caribbean',         'land'),
        ('na_launch_base',      'la_caribbean',         'sea'),

        # Latin America internal
        ('la_caribbean',        'la_andes',             'sea'),
        ('la_andes',            'la_amazonia',          'land'),
        ('la_andes',            'la_pampas',            'land'),
        ('la_amazonia',         'la_pampas',            'land'),
        ('la_pampas',           'la_patagonia',         'land'),

        # NA ↔ Europe
        ('na_eastern_corridor', 'euro_british_isles',   'sea'),
        ('euro_british_isles',  'euro_nordic',          'sea'),
        ('euro_british_isles',  'euro_iberia',          'sea'),
        ('euro_british_isles',  'euro_spaceport',       'sea'),

        # Europe internal
        ('euro_iberia',         'euro_spaceport',       'land'),
        ('euro_spaceport',      'euro_nordic',          'land'),
        ('euro_spaceport',      'euro_balkan',          'land'),
        ('euro_spaceport',      'euro_east',            'land'),
        ('euro_nordic',         'euro_east',            'land'),
        ('euro_balkan',         'euro_east',            'land'),
        ('euro_iberia',         'euro_balkan',          'sea'),

        # Europe ↔ MENA
        ('euro_iberia',         'mena_maghreb',         'sea'),
        ('euro_balkan',         'mena_levant',          'sea'),
        ('euro_east',           'mena_levant',          'land'),

        # MENA internal
        ('mena_maghreb',        'mena_nile',            'land'),
        ('mena_nile',           'mena_arabia',          'land'),
        ('mena_nile',           'mena_levant',          'land'),
        ('mena_levant',         'mena_arabia',          'land'),
        ('mena_arabia',         'mena_persia',          'sea'),
        ('mena_levant',         'mena_persia',          'land'),

        # MENA ↔ Africa
        ('mena_nile',           'africa_sahel',         'land'),
        ('mena_nile',           'africa_horn',          'land'),
        ('mena_maghreb',        'africa_sahel',         'land'),

        # Africa internal
        ('africa_sahel',        'africa_west',          'land'),
        ('africa_sahel',        'africa_horn',          'land'),
        ('africa_sahel',        'africa_congo_basin',   'land'),
        ('africa_west',         'africa_congo_basin',   'land'),
        ('africa_horn',         'africa_east',          'land'),
        ('africa_congo_basin',  'africa_east',          'land'),
        ('africa_congo_basin',  'africa_south',         'land'),
        ('africa_east',         'africa_south',         'land'),

        # MENA ↔ Central Asia
        ('mena_persia',         'ca_indus',             'land'),
        ('mena_persia',         'ca_steppe',            'land'),

        # Central Asia internal
        ('ca_steppe',           'ca_tien_shan',         'land'),
        ('ca_tien_shan',        'ca_indus',             'land'),
        ('ca_indus',            'ca_ganges',            'land'),
        ('ca_ganges',           'ca_deccan',            'land'),

        # CA ↔ Europe/Asia
        ('ca_steppe',           'euro_east',            'land'),
        ('ca_steppe',           'asia_siberia_belt',    'land'),
        ('ca_tien_shan',        'asia_heartland',       'land'),
        ('ca_ganges',           'asia_indochina',       'land'),

        # Asia internal
        ('asia_siberia_belt',   'asia_cosmodrome',      'land'),
        ('asia_siberia_belt',   'asia_heartland',       'land'),
        ('asia_cosmodrome',     'asia_heartland',       'land'),
        ('asia_heartland',      'asia_coastal',         'land'),
        ('asia_heartland',      'asia_indochina',       'land'),
        ('asia_coastal',        'asia_korea_archipelago','sea'),
        ('asia_korea_archipelago','asia_japan_islands', 'sea'),
        ('asia_coastal',        'asia_japan_islands',   'sea'),
        ('asia_indochina',      'asia_malay_archipelago','sea'),
        ('asia_coastal',        'megacity_pacific_rim', 'sea'),
        ('asia_japan_islands',  'megacity_pacific_rim', 'sea'),

        # Asia ↔ Oceania
        ('asia_malay_archipelago', 'oc_australia',      'sea'),
        ('oc_australia',        'oc_new_zealand',       'sea'),
        ('oc_australia',        'oc_micronesia',        'sea'),
        ('oc_micronesia',       'oc_polynesia',         'sea'),
        ('asia_malay_archipelago','oc_micronesia',      'sea'),

        # Across Pacific
        ('oc_polynesia',        'la_andes',             'sea'),
        ('oc_polynesia',        'na_western_states',    'sea'),

        # ── Orbital connections (Earth → Moon) ────────────────────────────
        ('na_launch_base',      'moon_near_side_north',      'orbit'),
        ('euro_spaceport',      'moon_mare_tranquillitatis', 'orbit'),
        ('asia_cosmodrome',     'moon_oceanus_procellarum',  'orbit'),

        # Moon ↔ Moon
        ('moon_near_side_north',      'moon_mare_imbrium',         'land'),
        ('moon_near_side_north',      'moon_mare_tranquillitatis', 'land'),
        ('moon_mare_tranquillitatis', 'moon_near_side_south',      'land'),
        ('moon_mare_tranquillitatis', 'moon_oceanus_procellarum',  'land'),
        ('moon_mare_imbrium',         'moon_oceanus_procellarum',  'land'),
        ('moon_oceanus_procellarum',  'moon_near_side_south',      'land'),
        ('moon_oceanus_procellarum',  'moon_far_side_north',       'land'),
        ('moon_far_side_north',       'moon_far_side_south',       'land'),
        ('moon_far_side_south',       'moon_near_side_south',      'land'),
        ('moon_far_side_north',       'moon_mare_tranquillitatis', 'land'),
        ('moon_polar_north',          'moon_mare_imbrium',         'land'),
        ('moon_polar_north',          'moon_near_side_north',      'land'),
        ('moon_polar_north',          'moon_far_side_north',       'land'),
        ('moon_polar_south',          'moon_near_side_south',      'land'),
        ('moon_polar_south',          'moon_far_side_south',       'land'),
    ]

    conns_json = [{'from': a, 'to': b, 'type': t} for a, b, t in connections]

    out = {
        'map_id':             'era_space_age',
        'name':               'Space Age (2100 AD)',
        'description':        'The world as it may be in 2100 — climate-reshaped borders, corporate enclaves, planetary megastates — plus a second globe representing a contested lunar surface. Research Lunar Expansion, build a Launch Pad, and launch your Space Station to claim the Moon.',
        'era_theme':          'space_age',
        'canvas_width':       1200,
        'canvas_height':      700,
        'projection_bounds':  {'minLng': -180, 'maxLng': 180, 'minLat': -60, 'maxLat': 85},
        'globe_view':         {'lock_rotation': False, 'altitude': 2.5},
        'territories':        territories_json,
        'connections':        conns_json,
        'regions':            regions,
        'is_public':          True,
        'is_moderated':       True,
        'moderation_status':  'approved',
        'creator_id':         'system',
    }

    out_path = Path(__file__).parent / 'era_space_age.json'
    out_path.write_text(json.dumps(out, indent=2))
    print(f'Wrote {out_path}')
    print(f'  territories: {len(territories_json)} (earth: {len(EARTH_TERRITORIES)}, moon: {len(MOON_TERRITORIES)})')
    print(f'  connections: {len(conns_json)}')
    print(f'  regions:     {len(regions)}')


if __name__ == '__main__':
    main()
