/**
 * Maps Borderfall territory IDs to GeoJSON country codes and optional clip regions.
 * Used by GlobeMap to render real geographic boundaries.
 *
 * Resolution order:
 * 1. territory.geo_config or (territory.iso_codes + territory.clip_bbox) from map data
 * 2. TERRITORY_GEO_CONFIG or TERRITORY_ISO_MAP (preset lookups)
 * 3. Canvas projection fallback
 *
 * IMPORTANT: Within each era, every ISO country code must appear in at most ONE
 * territory. If two territories share a country, use clip_bbox in GEO_CONFIG to
 * split the polygon. Failing to do so causes overlapping renders on the globe.
 *
 * Source: Natural Earth ne_110m_admin_0_countries.geojson
 */

/** [minLng, minLat, maxLng, maxLat] - clips country polygon to this bbox */
export type ClipBbox = [number, number, number, number];

/** Per-country config: iso code + optional bbox to clip that country's polygon */
export interface GeoConfigItem {
  iso: string;
  clip_bbox?: ClipBbox;
}

/** Full geo config for a territory: list of countries, each optionally clipped */
export type TerritoryGeoConfig = GeoConfigItem[];

/**
 * Territories with split regions (clipped by bbox).
 * Each item: { iso, clip_bbox? }. When clip_bbox present, intersect country poly with bbox.
 */
export const TERRITORY_GEO_CONFIG: Record<string, TerritoryGeoConfig> = {
  // ═══════════════════════════════════════════════════════════════════════════
  // ANCIENT ERA — shared-country splits
  // ═══════════════════════════════════════════════════════════════════════════
  northern_china: [{ iso: 'CN', clip_bbox: [105, 34, 118, 42] }],
  central_china: [{ iso: 'CN', clip_bbox: [100, 26, 120, 34] }],
  southern_china: [{ iso: 'CN', clip_bbox: [98, 18, 118, 26] }],
  manchuria: [
    { iso: 'CN', clip_bbox: [118, 38, 135, 55] },
    { iso: 'KP' },
    { iso: 'KR' },
  ],
  northern_india: [
    { iso: 'IN', clip_bbox: [68, 21, 90, 37] },
    { iso: 'NP' },
  ],
  southern_india: [
    { iso: 'IN', clip_bbox: [72, 6, 88, 21] },
  ],
  central_steppe: [
    { iso: 'KZ', clip_bbox: [46, 38, 70, 56] },
    { iso: 'UZ' },
    { iso: 'TM' },
  ],
  eastern_steppe: [
    { iso: 'KZ', clip_bbox: [70, 42, 90, 56] },
    { iso: 'MN' },
  ],
  // Era-growth frontier: real Volga-region geometry (central/European Russia,
  // north of the Kazakh steppe, east of Scandinavia/Sarmatia) so it fills the
  // gap between those territories naturally instead of as a floating block. RU is
  // otherwise unused on the Ancient board (the `siberia` frontier clips RU east of 60°E).
  volga_bulgaria: [{ iso: 'RU', clip_bbox: [27, 49, 58, 64] }],
  // Era-growth frontier: the Sahara as a real desert band — Sudan fills the gap
  // between Egypt and Aksum, and the northern deserts of Mauritania/Mali/Niger
  // (carved from West Africa) and Chad (carved from Central Africa) give it a
  // natural shape. The base West/Central Africa territories below are clipped to
  // their southern halves at the SAME boundary latitudes so the carve has no gap.
  sahara: [
    { iso: 'SD' },
    { iso: 'MR', clip_bbox: [-17, 19, -4.5, 28] },
    { iso: 'ML', clip_bbox: [-12, 17, 4.5, 25] },
    { iso: 'NE', clip_bbox: [0, 16.5, 16, 24] },
    { iso: 'TD', clip_bbox: [13, 15, 24, 24] },
  ],
  // West/Central Africa carved: desert north ceded to `sahara` (matched latitudes).
  west_africa: [
    { iso: 'MR', clip_bbox: [-17, 14.5, -4.5, 19] },
    { iso: 'SN' },
    { iso: 'GM' },
    { iso: 'GN' },
    { iso: 'ML', clip_bbox: [-12, 10, 4.5, 17] },
    { iso: 'BF' },
    { iso: 'NE', clip_bbox: [0, 11.5, 16, 16.5] },
    { iso: 'NG' },
  ],
  central_africa: [
    { iso: 'TD', clip_bbox: [13, 7, 24, 15] },
    { iso: 'CF' },
    { iso: 'CM' },
    { iso: 'GA' },
    { iso: 'CG' },
    { iso: 'GQ' },
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // MEDIEVAL ERA — shared-country splits
  // ═══════════════════════════════════════════════════════════════════════════
  northern_china_med: [{ iso: 'CN', clip_bbox: [105, 34, 118, 45] }],
  song_china: [{ iso: 'CN', clip_bbox: [100, 24, 122, 34] }],
  southern_china_med: [{ iso: 'CN', clip_bbox: [98, 18, 115, 24] }],
  kievan_rus: [
    { iso: 'UA' },
    { iso: 'BY' },
    { iso: 'RU', clip_bbox: [20, 48, 60, 72] },
  ],
  siberia: [
    { iso: 'RU', clip_bbox: [60, 48, 180, 82] },
  ],
  holy_roman: [
    { iso: 'DE' },
    { iso: 'AT' },
    { iso: 'CH' },
    { iso: 'NL' },
    { iso: 'BE' },
  ],
  byzantine: [
    { iso: 'GR' },
    { iso: 'BG' },
    { iso: 'MK' },
    { iso: 'AL' },
    { iso: 'CY' },
    { iso: 'BA' },
    { iso: 'ME' },
  ],
  delhi_sultanate: [
    { iso: 'IN', clip_bbox: [68, 21, 92, 37] },
    { iso: 'PK' },
    { iso: 'NP' },
    { iso: 'BD' },
  ],
  south_india_med: [
    { iso: 'IN', clip_bbox: [72, 6, 88, 21] },
    { iso: 'LK' },
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // WW2 ERA — split regions
  // ═══════════════════════════════════════════════════════════════════════════
  usa_west: [{ iso: 'US', clip_bbox: [-125, 24, -100, 50] }],
  usa_east: [
    { iso: 'US', clip_bbox: [-100, 24, -66, 50] },
    { iso: 'CA' },
  ],
  russia_west: [{ iso: 'RU', clip_bbox: [20, 50, 60, 75] }],
  russia_central: [{ iso: 'RU', clip_bbox: [60, 50, 100, 75] }],
  russia_east: [{ iso: 'RU', clip_bbox: [100, 50, 180, 72] }],
  // China Theatre — three CN clip_bboxes tile without overlap; Korea is full
  // KR/KP on manchuria only. north_china previously extended to lng 125 while
  // manchuria CN started at 118, double-rendering northeast China on the globe.
  manchuria_ww2: [
    { iso: 'CN', clip_bbox: [120, 38, 135, 50] },
    { iso: 'KP' },
    { iso: 'KR' },
  ],
  north_china_ww2: [{ iso: 'CN', clip_bbox: [98, 32, 120, 42] }],
  south_china_ww2: [{ iso: 'CN', clip_bbox: [98, 18, 120, 32] }],

  // ═══════════════════════════════════════════════════════════════════════════
  // DISCOVERY ERA — shared-country splits
  // ═══════════════════════════════════════════════════════════════════════════
  north_america_west: [
    { iso: 'US', clip_bbox: [-125, 24, -100, 50] },
    { iso: 'CA', clip_bbox: [-125, 48, -100, 72] },
  ],
  north_america_east: [
    { iso: 'US', clip_bbox: [-100, 24, -66, 50] },
    { iso: 'CA', clip_bbox: [-100, 42, -52, 72] },
  ],
  ming_north: [{ iso: 'CN', clip_bbox: [105, 32, 125, 42] }],
  ming_south: [{ iso: 'CN', clip_bbox: [98, 18, 118, 32] }],
  mughal_north: [
    { iso: 'IN', clip_bbox: [68, 21, 90, 37] },
    { iso: 'PK' },
    { iso: 'NP' },
    { iso: 'BD' },
  ],
  mughal_south: [
    { iso: 'IN', clip_bbox: [72, 6, 88, 21] },
  ],
  holy_roman_disc: [
    { iso: 'DE' },
    { iso: 'CZ' },
    { iso: 'AT' },
    { iso: 'CH' },
    { iso: 'NL' },
    { iso: 'BE' },
  ],
  ottoman_balkans: [
    { iso: 'GR' },
    { iso: 'BG' },
    { iso: 'MK' },
    { iso: 'RS' },
    { iso: 'BA' },
    { iso: 'ME' },
    { iso: 'AL' },
    { iso: 'HR' },
    { iso: 'SI' },
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // COLD WAR ERA — shared-country splits
  // ═══════════════════════════════════════════════════════════════════════════
  usa_northeast: [
    { iso: 'US', clip_bbox: [-95, 38, -66, 48] },
    { iso: 'CA', clip_bbox: [-95, 42, -52, 62] },
  ],
  usa_south: [{ iso: 'US', clip_bbox: [-100, 24, -80, 38] }],
  usa_west_cw: [{ iso: 'US', clip_bbox: [-125, 31, -100, 49] }],
  russia_west_cw: [{ iso: 'RU', clip_bbox: [20, 50, 60, 75] }],
  russia_central_cw: [{ iso: 'RU', clip_bbox: [60, 50, 100, 75] }],
  russia_east_cw: [{ iso: 'RU', clip_bbox: [100, 50, 180, 72] }],
  china_north_cw: [{ iso: 'CN', clip_bbox: [105, 32, 125, 42] }],
  china_south_cw: [{ iso: 'CN', clip_bbox: [98, 18, 120, 32] }],
  canada: [
    { iso: 'CA', clip_bbox: [-141, 48, -95, 84] },
  ],
  west_germany: [
    { iso: 'DE', clip_bbox: [5, 47, 12, 55] },
  ],
  east_germany: [
    { iso: 'DE', clip_bbox: [12, 50, 16, 55] },
    { iso: 'PL' },
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // MODERN ERA — USA, Russia, China splits
  // ═══════════════════════════════════════════════════════════════════════════
  usa_east_mod: [
    { iso: 'US', clip_bbox: [-100, 24, -66, 50] },
  ],
  usa_west_mod: [
    { iso: 'US', clip_bbox: [-125, 24, -100, 50] },
  ],
  russia_west_mod: [{ iso: 'RU', clip_bbox: [20, 42, 60, 82] }],
  russia_east_mod: [{ iso: 'RU', clip_bbox: [60, 42, 180, 82] }],
  china_west_mod: [{ iso: 'CN', clip_bbox: [73, 18, 105, 50] }],
  china_east_mod: [
    { iso: 'CN', clip_bbox: [105, 18, 135, 50] },
    { iso: 'TW' },
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // AMERICAN CIVIL WAR — each territory_id MUST map to real geography for that
  // name (Natural Earth US polygon ∩ bbox). Keys are NOT ordered by abstract
  // map grid — never assign “row 0 west→east” boxes to unrelated ids (that put
  // Kentucky in the Rockies and Missouri in the Southwest on the globe).
  //
  // Bboxes are tight CONUS partitions; borders touch but do not overlap.
  // Reference: approximate state bounds (1860s CONUS = lower 48; HI/AK excluded).
  // ═══════════════════════════════════════════════════════════════════════════
  acw_new_england:   [{ iso: 'US', clip_bbox: [-73.6, 41.0, -66.9, 47.5] }], // ME NH VT MA RI CT
  acw_mid_atlantic:  [{ iso: 'US', clip_bbox: [-80.6, 38.8, -73.5, 42.5] }], // NY NJ PA DE MD
  acw_great_lakes:   [{ iso: 'US', clip_bbox: [-92.2, 41.0, -80.5, 49.0] }], // MI WI northern IL + north OH/IN
  acw_appalachia:    [{ iso: 'US', clip_bbox: [-82.5, 37.0, -77.2, 40.6] }], // WV (split from KY at -82.5°W)
  acw_upper_south:   [{ iso: 'US', clip_bbox: [-83.6, 36.5, -75.6, 39.6] }], // VA + MD south of PA
  acw_carolinas:     [{ iso: 'US', clip_bbox: [-82.5, 32.0, -78.0, 34.9] }], // NC SC (split from GA at 35°N)
  acw_ohio_indiana:  [{ iso: 'US', clip_bbox: [-88.6, 38.4, -80.5, 40.95] }], // OH IN (below Great Lakes 41°N band)
  acw_kentucky:      [{ iso: 'US', clip_bbox: [-89.6, 36.5, -82.5, 39.2] }], // KY
  acw_tennessee:     [{ iso: 'US', clip_bbox: [-90.4, 34.9, -81.6, 36.7] }], // TN
  acw_georgia_fl:    [{ iso: 'US', clip_bbox: [-85.6, 24.5, -79.8, 35.0] }], // GA FL (north edge meets Carolinas at 35°N)
  acw_alabama:       [{ iso: 'US', clip_bbox: [-88.6, 30.2, -84.8, 35.0] }], // AL
  acw_mississippi:   [{ iso: 'US', clip_bbox: [-91.7, 30.2, -88.0, 35.0] }], // MS (state + river corridor)
  acw_plains:        [{ iso: 'US', clip_bbox: [-104.1, 40.0, -95.9, 49.0] }], // ND SD NE KS (Great Plains)
  acw_missouri:      [{ iso: 'US', clip_bbox: [-95.9, 36.0, -89.1, 40.6] }], // MO
  acw_arkansas:      [{ iso: 'US', clip_bbox: [-94.6, 33.0, -89.8, 36.0] }], // AR (below MO)
  acw_louisiana:     [{ iso: 'US', clip_bbox: [-94.1, 28.9, -88.8, 33.1] }], // LA + Gulf coast
  acw_texas:         [{ iso: 'US', clip_bbox: [-106.6, 25.8, -93.5, 36.5] }], // TX
  acw_far_west:      [{ iso: 'US', clip_bbox: [-125.0, 31.0, -106.6, 49.0] }], // CA OR WA NV AZ NM UT CO MT WY ID

  // ═══════════════════════════════════════════════════════════════════════════
  // SPACE AGE 2100 — alt-future political bodies. Bboxes derived from each
  // territory's existing geo_polygon in database/maps/era_space_age.json.
  // Earth-half migration from raw rectangular geo_polygons (which fail
  // earcut triangulation on the sphere) to admin-0 country clipping.
  // ═══════════════════════════════════════════════════════════════════════════

  // North America
  na_arctic_dominion: [
    { iso: 'CA', clip_bbox: [-141, 60, -60, 83] },
    // ALL of Alaska including the south coast + Aleutian chain (was lat 60+ only,
    // leaving Anchorage/Juneau/Aleutians as a visible gap on the globe).
    { iso: 'US', clip_bbox: [-180, 50, -130, 72] },
    { iso: 'GL', clip_bbox: [-75, 60, -10, 84] }, // Greenland
  ],
  na_western_states: [
    { iso: 'US', clip_bbox: [-125, 32, -100, 50] },
    { iso: 'CA', clip_bbox: [-141, 49, -100, 60] }, // BC, AB, SK, MB south
  ],
  na_central_plains: [
    { iso: 'US', clip_bbox: [-100, 32, -85, 50] },
    { iso: 'CA', clip_bbox: [-100, 49, -75, 60] }, // ON, QC, central
  ],
  na_launch_base: [{ iso: 'US', clip_bbox: [-85, 25, -75, 35] }], // Florida + SE coast
  na_eastern_corridor: [
    { iso: 'US', clip_bbox: [-85, 35, -65, 50] },
    { iso: 'CA', clip_bbox: [-75, 49, -55, 60] }, // QC east, NB, NS, NL
  ],
  na_southern_belt: [
    { iso: 'MX' },
    { iso: 'GT' },
    { iso: 'BZ' },
    { iso: 'HN' },
    { iso: 'SV' },
    { iso: 'NI' },
    { iso: 'CR' },
    { iso: 'PA' },
    // Extended US strip to lng -85 (was -100). Now covers TX east + LA + MS +
    // AL + AR south + N FL panhandle that were previously a brown gap on the
    // globe between na_central_plains (lat 32+) and na_launch_base (lng -85+).
    { iso: 'US', clip_bbox: [-115, 25, -85, 32] },
  ],

  // Latin America
  la_amazonia: [
    { iso: 'BR', clip_bbox: [-74, -10, -46, 5] },
    { iso: 'CO', clip_bbox: [-74, -4, -67, 5] },
    { iso: 'VE', clip_bbox: [-74, 1, -60, 8] }, // S Venezuela (N coast claimed by la_caribbean)
    { iso: 'GY' },
    { iso: 'SR' },
    { iso: 'GF' },
  ],
  la_andes: [
    { iso: 'PE' },
    { iso: 'BO' },
    { iso: 'EC' },
    { iso: 'CL', clip_bbox: [-75, -22, -68, -17] },
    { iso: 'BR', clip_bbox: [-74, -22, -57, -10] }, // SW Brazil interior
  ],
  la_pampas: [
    { iso: 'AR', clip_bbox: [-71, -40, -53, -22] },
    { iso: 'UY' },
    { iso: 'PY' },
    { iso: 'CL', clip_bbox: [-75, -40, -68, -22] },
    { iso: 'BR', clip_bbox: [-58, -33, -48, -22] }, // S Brazil
  ],
  la_patagonia: [
    { iso: 'AR', clip_bbox: [-75, -56, -52, -40] },
    { iso: 'CL', clip_bbox: [-78, -56, -65, -40] },
  ],
  la_caribbean: [
    { iso: 'CU' },
    { iso: 'JM' },
    { iso: 'HT' },
    { iso: 'DO' },
    { iso: 'PR' },
    { iso: 'BS' },
    { iso: 'TT' },
    { iso: 'CO', clip_bbox: [-78, 8, -71, 13] }, // Colombia north coast
    { iso: 'VE', clip_bbox: [-72, 8, -60, 13] }, // Venezuela north coast
  ],

  // Europe
  euro_british_isles: [
    { iso: 'GB' },
    { iso: 'IE' },
    { iso: 'IS' },
  ],
  euro_iberia: [
    { iso: 'ES' },
    { iso: 'PT' },
  ],
  euro_spaceport: [
    { iso: 'FR' },
    { iso: 'BE' },
    { iso: 'NL' },
    { iso: 'LU' },
    { iso: 'CH' },
    { iso: 'IT', clip_bbox: [6, 41, 14, 47] }, // N Italy
    { iso: 'DE', clip_bbox: [3, 47, 14, 52] }, // SW Germany
  ],
  euro_nordic: [
    { iso: 'NO' },
    { iso: 'SE' },
    { iso: 'FI' },
    { iso: 'DK' },
    { iso: 'EE' },
    { iso: 'LV' },
    { iso: 'LT' },
    { iso: 'DE', clip_bbox: [5, 52, 16, 56] }, // N Germany
  ],
  euro_balkan: [
    { iso: 'IT', clip_bbox: [6, 36, 19, 41] }, // S Italy (N caught by spaceport)
    { iso: 'GR' },
    { iso: 'BG' },
    { iso: 'AL' },
    { iso: 'MK' },
    { iso: 'RS' },
    { iso: 'BA' },
    { iso: 'HR' },
    { iso: 'SI' },
    { iso: 'ME' },
    { iso: 'XK' },
    { iso: 'AT' },
    { iso: 'HU' },
    { iso: 'RO' },
  ],
  euro_east: [
    { iso: 'PL' },
    { iso: 'CZ' },
    { iso: 'SK' },
    { iso: 'BY' },
    { iso: 'UA' },
    { iso: 'MD' },
    { iso: 'RU', clip_bbox: [22, 45, 50, 60] }, // W Russia
  ],

  // Middle East / North Africa
  mena_levant: [
    { iso: 'TR', clip_bbox: [25, 29, 45, 36] }, // S Turkey (Mediterranean coast)
    { iso: 'SY' },
    { iso: 'LB' },
    { iso: 'IL' },
    { iso: 'JO' },
    { iso: 'PS' },
    { iso: 'IQ', clip_bbox: [38, 30, 45, 38] },
  ],
  mena_arabia: [
    { iso: 'SA' },
    { iso: 'YE' },
    { iso: 'OM' },
    { iso: 'AE' },
    { iso: 'QA' },
    { iso: 'BH' },
    { iso: 'KW' },
  ],
  mena_persia: [
    { iso: 'IR' },
    { iso: 'IQ', clip_bbox: [44, 25, 50, 38] }, // E Iraq (Persian Gulf side)
    // (Afghanistan is owned entirely by ca_indus to avoid double-claim.)
  ],
  mena_maghreb: [
    { iso: 'MA' },
    { iso: 'DZ' },
    { iso: 'TN' },
    { iso: 'LY', clip_bbox: [-17, 22, 18, 37] },
    { iso: 'EH' },
    { iso: 'MR', clip_bbox: [-17, 22, 0, 28] }, // N Mauritania
  ],
  mena_nile: [
    { iso: 'EG' },
    { iso: 'SD', clip_bbox: [22, 15, 38, 22] }, // N Sudan
    { iso: 'TR', clip_bbox: [25, 36, 45, 42] }, // S Turkey portion
  ],

  // Sub-Saharan Africa
  africa_sahel: [
    { iso: 'NE' },
    { iso: 'TD' },
    { iso: 'ML', clip_bbox: [-12, 10, 5, 25] },
    { iso: 'MR', clip_bbox: [-17, 10, 0, 22] },
    { iso: 'BF' },
    { iso: 'SD', clip_bbox: [22, 8, 38, 15] }, // S Sudan portion (N owned by mena_nile)
    { iso: 'SS' },
    { iso: 'ER' },
    { iso: 'DJ' },
    { iso: 'NG', clip_bbox: [3, 10, 14, 14] }, // N Nigeria
  ],
  africa_west: [
    { iso: 'SN' },
    { iso: 'GM' },
    { iso: 'GW' },
    { iso: 'GN' },
    { iso: 'SL' },
    { iso: 'LR' },
    { iso: 'CI' },
    { iso: 'GH' },
    { iso: 'TG' },
    { iso: 'BJ' },
    { iso: 'NG', clip_bbox: [3, -2, 14, 10] }, // S Nigeria
    { iso: 'CM', clip_bbox: [8, 0, 16, 14] },
  ],
  africa_horn: [
    { iso: 'ET' },
    { iso: 'SO' },
    { iso: 'KE' },
    { iso: 'YE', clip_bbox: [42, 12, 54, 18] }, // S Yemen / Aden
  ],
  africa_congo_basin: [
    { iso: 'CD' },
    { iso: 'CG' },
    { iso: 'GA' },
    { iso: 'GQ' },
    { iso: 'CF' },
    { iso: 'AO', clip_bbox: [11, -13, 25, -4] },
  ],
  africa_east: [
    { iso: 'TZ' },
    { iso: 'UG' },
    { iso: 'RW' },
    { iso: 'BI' },
    { iso: 'MW' },
    { iso: 'MZ', clip_bbox: [30, -12, 42, -10] }, // N Mozambique
  ],
  africa_south: [
    { iso: 'ZA' },
    { iso: 'NA' },
    { iso: 'BW' },
    { iso: 'ZW' },
    { iso: 'ZM' },
    { iso: 'MZ', clip_bbox: [30, -27, 42, -12] },
    { iso: 'AO', clip_bbox: [11, -18, 25, -13] }, // S Angola
    { iso: 'LS' },
    { iso: 'SZ' },
    { iso: 'MG' },
  ],

  // Central Asia
  ca_steppe: [
    { iso: 'KZ' },
    { iso: 'MN' },
    { iso: 'RU', clip_bbox: [50, 50, 90, 65] }, // S Siberia
  ],
  ca_tien_shan: [
    { iso: 'UZ' },
    { iso: 'KG' },
    { iso: 'TJ' },
    { iso: 'TM' },
  ],
  ca_indus: [
    { iso: 'PK' },
    { iso: 'AF' }, // Entire Afghanistan
  ],
  ca_ganges: [
    { iso: 'IN', clip_bbox: [72, 20, 92, 32] },
    { iso: 'NP' },
    { iso: 'BT' },
    { iso: 'BD' },
  ],
  ca_deccan: [
    { iso: 'IN', clip_bbox: [72, 6, 92, 22] },
    { iso: 'LK' },
  ],

  // Asia — China is partitioned into 4 territories. The four CN clip_bboxes
  // tile cleanly (no overlap, no gap) across CN's full extent.
  asia_cosmodrome: [
    // North China + Inner Mongolia + Manchuria (was 73-115, 36-50; expanded
    // east to lng 135 to absorb the Manchuria piece previously stuffed into
    // asia_korea_archipelago, which produced a visible rectangular cut).
    { iso: 'CN', clip_bbox: [73, 38, 135, 54] },
  ],
  asia_heartland: [
    // Central China — Tibet, Yunnan, Sichuan, Hubei, Hunan, Henan inland.
    // Was [100, 22, 115, 36] — left Tibet (73-100) and W Yunnan as gaps.
    // Now covers full lng 73-115 from southern border up to lat 38.
    { iso: 'CN', clip_bbox: [73, 22, 115, 38] },
  ],
  asia_coastal: [
    // South China coast: Guangxi, Guangdong, Hainan, Fujian, plus HK/MO/TW.
    // Was [115, 18, 125, 24] — too narrow. Extended west to lng 100 to
    // capture Hainan and southern Guangxi.
    { iso: 'CN', clip_bbox: [100, 18, 125, 24] },
    { iso: 'HK' },
    { iso: 'MO' },
    { iso: 'TW' },
  ],
  asia_korea_archipelago: [
    // Korea peninsula only — dropped the CN [125-135, 38-45] (Manchuria) clip
    // that produced an unnatural rectangular cut on the China mainland.
    { iso: 'KR' },
    { iso: 'KP' },
  ],
  asia_indochina: [
    { iso: 'TH' },
    { iso: 'VN' },
    { iso: 'LA' },
    { iso: 'KH' },
    { iso: 'MM' },
    { iso: 'MY', clip_bbox: [99, 1, 105, 8] },
  ],
  asia_malay_archipelago: [
    { iso: 'ID' },
    { iso: 'MY', clip_bbox: [108, 0, 119, 8] },
    { iso: 'BN' },
    { iso: 'PH' },
    { iso: 'TL' },
    { iso: 'PG' },
    { iso: 'SG' },
  ],
  asia_japan_islands: [{ iso: 'JP' }],
  asia_siberia_belt: [
    // Two non-overlapping slices: arctic strip west of ca_steppe + everything
    // east of ca_steppe lng. Together this covers central Siberia (Yakutsk,
    // Krasnoyarsk) and the Russian Far East (Khabarovsk, Vladivostok).
    { iso: 'RU', clip_bbox: [60, 65, 90, 82] },
    { iso: 'RU', clip_bbox: [90, 45, 180, 82] },
  ],

  // Oceania
  oc_australia: [{ iso: 'AU' }],
  oc_new_zealand: [{ iso: 'NZ' }],
  // Now that GlobeMap loads NE 50m admin-0, all small Pacific island states
  // are present and these territories render as proper island clusters.
  oc_micronesia: [
    { iso: 'FM' },
    { iso: 'MH' },
    { iso: 'PW' },
    { iso: 'GU' },
    { iso: 'MP' },
  ],
  oc_polynesia: [
    { iso: 'WS' },
    { iso: 'TO' },
    { iso: 'FJ' },
    { iso: 'KI' },
    { iso: 'TV' },
    { iso: 'NU' },
    { iso: 'CK' },
    { iso: 'PF' },
  ],

  // Coastal Megacities — E China coast: Shanghai + Shandong + Hebei + Tianjin
  // + Beijing corridor. Extended north to lat 38 (was 32) to cover the
  // Beijing/Hebei/Shandong gap that was visible on the globe between
  // megacity_pacific_rim and asia_cosmodrome.
  megacity_pacific_rim: [
    { iso: 'CN', clip_bbox: [115, 24, 125, 38] },
  ],
};

/** Simple territory → ISO codes (no clipping). Used when TERRITORY_GEO_CONFIG has no entry. */
export const TERRITORY_ISO_MAP: Record<string, string[]> = {
  // ═══════════════════════════════════════════════════════════════════════════
  // ANCIENT (entries NOT in TERRITORY_GEO_CONFIG)
  // ═══════════════════════════════════════════════════════════════════════════
  britannia: ['GB'],
  gaul: ['FR', 'BE', 'NL', 'LU', 'CH'],
  hispania: ['ES', 'PT'],
  italia: ['IT'],
  north_africa: ['MA', 'DZ', 'TN', 'LY'],
  greece: ['GR', 'AL', 'MK', 'BA', 'ME', 'RS', 'HR', 'SI', 'BG'],
  anatolia: ['TR'],
  levant: ['SY', 'LB', 'IL', 'JO', 'PS'],
  egypt: ['EG'],
  mesopotamia: ['IQ'],
  persia: ['IR'],
  bactria: ['TJ'],
  arabia: ['SA', 'YE', 'OM', 'AE', 'KW', 'QA', 'BH'],
  pontic_steppe: ['UA', 'MD', 'RO'],
  kushan: ['AF', 'PK'],
  aksum: ['ET', 'ER'],
  // west_africa / central_africa now live in TERRITORY_GEO_CONFIG (clipped to cede
  // their desert north to the `sahara` growth frontier).
  germania: ['DE'],
  sarmatia: ['BY', 'PL'],
  // Era-growth frontier (unlocks at the Medieval era): mainland Southeast Asia
  // (Indochina). Distinct id from the maritime `southeast_asia` so it never
  // collides with the Ancient board's `nusantara` (Indonesia) frontier.
  indochina: ['TH', 'VN', 'KH', 'LA', 'MM'],

  // ═══════════════════════════════════════════════════════════════════════════
  // MEDIEVAL (entries NOT in TERRITORY_GEO_CONFIG)
  // ═══════════════════════════════════════════════════════════════════════════
  england: ['GB'],
  france: ['FR'],
  iberia: ['ES', 'PT'],
  italy_states: ['IT'],
  scandinavia: ['NO', 'SE', 'FI', 'DK'],
  poland_bohemia: ['PL', 'CZ'],
  hungary: ['HU', 'SK', 'HR', 'RS', 'RO'],
  anatolia_med: ['TR'],
  levant_crusader: ['SY', 'LB', 'IL', 'PS'],
  egypt_ayyubid: ['EG'],
  mesopotamia_med: ['IQ'],
  persia_med: ['IR'],
  arabia_med: ['SA', 'YE', 'OM', 'AE', 'KW', 'QA', 'BH'],
  mongolia: ['MN'],
  central_asia: ['KZ', 'UZ', 'TM', 'TJ', 'AF', 'KG'],
  korea_japan: ['KP', 'KR', 'JP'],
  southeast_asia: ['MM', 'TH', 'LA', 'VN', 'KH', 'MY', 'ID', 'BN'],
  mali_empire: ['MR', 'SN', 'GM', 'ML', 'BF', 'GN', 'SL'],
  east_africa_med: ['ET', 'ER', 'DJ', 'SO', 'KE', 'UG'],
  central_africa_med: ['TD', 'CF', 'CM', 'GA', 'CG', 'GQ'],

  // ═══════════════════════════════════════════════════════════════════════════
  // WW2 (entries NOT in TERRITORY_GEO_CONFIG)
  // ═══════════════════════════════════════════════════════════════════════════
  britain_ww2: ['GB'],
  france_ww2: ['FR', 'BE', 'NL', 'LU'],
  germany: ['DE'],
  italy_ww2: ['IT'],
  iberia_ww2: ['ES', 'PT'],
  scandinavia_ww2: ['NO', 'SE', 'FI', 'DK'],
  eastern_europe_ww2: ['PL', 'RO', 'HU', 'BG', 'HR', 'SI', 'BA', 'RS', 'ME', 'MK', 'AL', 'GR', 'CZ', 'SK'],
  ukraine: ['UA'],
  caucasus: ['GE', 'AM', 'AZ'],
  morocco_ww2: ['MA', 'DZ'],
  libya_egypt: ['LY', 'EG'],
  ethiopia_ww2: ['ET', 'ER', 'DJ', 'SO', 'UG', 'KE'],
  west_africa_ww2: ['MR', 'SN', 'GM', 'GN', 'SL', 'LR', 'CI', 'BF', 'GH', 'TG', 'BJ', 'NG', 'NE'],
  turkey_ww2: ['TR'],
  levant_ww2: ['SY', 'LB', 'IL', 'JO', 'IQ', 'PS'],
  iran_ww2: ['IR'],
  arabia_ww2: ['SA', 'YE', 'OM', 'AE', 'KW', 'QA', 'BH'],
  japan_ww2: ['JP'],
  philippines: ['PH'],
  dutch_east_indies: ['ID'],
  australia_ww2: ['AU'],
  pacific_islands: ['FJ', 'PG', 'VU', 'NC', 'SB'],
  burma_indochina: ['MM', 'TH', 'LA', 'VN', 'KH', 'MY', 'BN'],
  india_ww2: ['IN', 'PK', 'BD'],
  caribbean: ['CU', 'HT', 'DO', 'JM', 'TT', 'BS', 'PR', 'BZ', 'GT', 'HN', 'SV', 'NI', 'CR', 'PA'],
  central_africa_ww2: ['TD', 'CF', 'CM', 'GA', 'CG', 'GQ'],
  south_africa_ww2: ['ZA', 'NA', 'BW', 'ZW', 'MZ', 'MW', 'LS', 'SZ'],

  // ═══════════════════════════════════════════════════════════════════════════
  // DISCOVERY (entries NOT in TERRITORY_GEO_CONFIG)
  // ═══════════════════════════════════════════════════════════════════════════
  spain_portugal: ['ES', 'PT'],
  france_disc: ['FR'],
  britain_disc: ['GB'],
  russia_disc: ['RU', 'UA', 'BY', 'KZ'],
  italy_disc: ['IT'],
  anatolia_disc: ['TR'],
  levant_disc: ['SY', 'LB', 'IL', 'JO', 'PS'],
  egypt_disc: ['EG'],
  mesopotamia_disc: ['IQ'],
  persia_disc: ['IR'],
  arabia_disc: ['SA', 'YE', 'OM', 'AE', 'KW', 'QA', 'BH'],
  new_spain: ['MX', 'GT', 'HN', 'SV', 'NI', 'CR', 'PA', 'BZ'],
  new_granada: ['CO', 'VE', 'EC'],
  brazil: ['BR'],
  peru_chile: ['PE', 'CL', 'BO'],
  rio_plata: ['AR', 'UY', 'PY'],
  morocco: ['MA', 'DZ'],
  west_africa_disc: ['MR', 'SN', 'GM', 'GN', 'SL', 'LR', 'CI', 'BF', 'GH', 'TG', 'BJ', 'NG', 'NE'],
  central_africa_disc: ['TD', 'CF', 'CM', 'GA', 'CG', 'GQ'],
  east_africa_disc: ['ET', 'ER', 'DJ', 'SO', 'KE', 'UG', 'TZ'],
  south_africa: ['ZA', 'NA', 'BW', 'ZW', 'MZ', 'MW', 'LS', 'SZ'],
  ceylon_spice: ['LK'],
  japan_disc: ['JP'],
  southeast_asia_disc: ['MM', 'TH', 'LA', 'VN', 'KH', 'MY', 'ID', 'BN'],

  // ═══════════════════════════════════════════════════════════════════════════
  // COLD WAR (entries NOT in TERRITORY_GEO_CONFIG)
  // ═══════════════════════════════════════════════════════════════════════════
  uk_ireland: ['GB', 'IE'],
  france_benelux: ['FR', 'BE', 'NL', 'LU'],
  iberia_cw: ['ES', 'PT'],
  italy_cw: ['IT', 'GR'],
  scandinavia_cw: ['NO', 'SE', 'FI', 'DK'],
  turkey_cw: ['TR'],
  czechoslovakia: ['CZ', 'SK', 'HU'],
  romania_bulgaria: ['RO', 'BG'],
  ukraine_cw: ['UA', 'BY'],
  caucasus_cw: ['GE', 'AM', 'AZ', 'KZ', 'UZ', 'TM', 'TJ', 'KG'],
  mexico_ca: ['MX', 'GT', 'HN', 'SV', 'NI', 'CR', 'PA', 'BZ'],
  caribbean_cw: ['CU', 'HT', 'DO', 'JM', 'TT', 'BS', 'PR'],
  colombia_venezuela: ['CO', 'VE'],
  brazil_cw: ['BR'],
  southern_cone: ['AR', 'CL', 'UY', 'PY', 'BO', 'PE'],
  israel_jordan: ['IL', 'JO', 'PS'],
  egypt_cw: ['EG'],
  iraq_syria: ['IQ', 'SY'],
  iran_cw: ['IR'],
  arabia_cw: ['SA', 'YE', 'OM', 'AE', 'KW', 'QA', 'BH'],
  afghanistan: ['AF'],
  north_africa_cw: ['MA', 'DZ', 'TN', 'LY'],
  west_africa_cw: ['MR', 'SN', 'GM', 'GN', 'SL', 'LR', 'CI', 'BF', 'GH', 'TG', 'BJ', 'NG', 'NE'],
  horn_africa: ['ET', 'ER', 'DJ', 'SO', 'KE'],
  central_africa_cw: ['TD', 'CF', 'CM', 'GA', 'CG', 'GQ'],
  southern_africa_cw: ['ZA', 'NA', 'BW', 'ZW', 'MZ', 'MW', 'LS', 'SZ'],
  india_cw: ['IN', 'PK', 'BD'],
  vietnam_korea: ['VN', 'LA', 'KH', 'TH', 'MM', 'BN'],
  indonesia_cw: ['ID'],
  australia_cw: ['AU', 'NZ'],
  korea_cw: ['KP', 'KR'],
  japan_cw: ['JP'],
  mongolia_cw: ['MN'],

  // ═══════════════════════════════════════════════════════════════════════════
  // MODERN (entries NOT in TERRITORY_GEO_CONFIG)
  // ═══════════════════════════════════════════════════════════════════════════
  canada_mod: ['CA'],
  mexico_mod: ['MX'],
  central_america_mod: ['GT', 'BZ', 'HN', 'SV', 'NI', 'CR', 'PA', 'CU', 'JM', 'HT', 'DO', 'TT', 'BS', 'PR'],
  colombia_mod: ['CO', 'VE', 'GY', 'SR'],
  brazil_mod: ['BR'],
  peru_mod: ['PE', 'EC', 'BO'],
  argentina_mod: ['AR', 'UY'],
  chile_mod: ['CL', 'PY'],
  uk_mod: ['GB', 'IE'],
  france_mod: ['FR', 'BE', 'NL', 'LU'],
  germany_mod: ['DE', 'AT', 'CZ', 'CH'],
  scandinavia_mod: ['NO', 'SE', 'FI', 'DK', 'IS'],
  iberia_mod: ['ES', 'PT'],
  italy_mod: ['IT', 'SI', 'HR'],
  balkans_mod: ['GR', 'AL', 'MK', 'BG', 'RO', 'RS', 'BA', 'ME', 'HU', 'SK'],
  poland_baltics_mod: ['PL', 'LT', 'LV', 'EE'],
  ukraine_mod: ['UA', 'BY', 'MD'],
  central_asia_mod: ['KZ', 'UZ', 'TM', 'KG', 'TJ', 'MN'],
  turkey_mod: ['TR', 'CY'],
  levant_mod: ['IQ', 'SY', 'LB', 'JO', 'IL', 'PS'],
  iran_mod: ['IR'],
  saudi_mod: ['SA', 'AE', 'OM', 'YE', 'KW', 'QA', 'BH'],
  egypt_mod: ['EG'],
  maghreb_mod: ['MA', 'DZ', 'TN', 'LY'],
  west_africa_mod: ['SN', 'GM', 'GN', 'GW', 'SL', 'LR', 'CI', 'GH', 'TG', 'BJ', 'BF', 'ML', 'NE', 'MR'],
  nigeria_mod: ['NG', 'CM', 'GQ'],
  central_africa_mod: ['CD', 'CG', 'GA', 'CF', 'TD', 'AO'],
  sudan_horn_mod: ['SD', 'SS', 'ER', 'DJ', 'SO'],
  east_africa_mod: ['ET', 'KE', 'TZ', 'UG', 'RW', 'BI', 'MG'],
  southern_africa_mod: ['ZA', 'NA', 'BW', 'ZW', 'ZM', 'MW', 'MZ', 'SZ', 'LS'],
  india_mod: ['IN', 'NP', 'BD', 'LK', 'BT'],
  pakistan_afghan_mod: ['PK', 'AF'],
  japan_mod: ['JP'],
  korea_mod: ['KR', 'KP'],
  southeast_asia_mod: ['TH', 'VN', 'KH', 'LA', 'MM', 'MY', 'SG', 'BN'],
  indonesia_mod: ['ID', 'PH', 'TL', 'PG'],
  australia_mod: ['AU', 'NZ', 'FJ'],
};

export function hasGeoMapping(territoryId: string): boolean {
  return territoryId in TERRITORY_GEO_CONFIG || territoryId in TERRITORY_ISO_MAP;
}
