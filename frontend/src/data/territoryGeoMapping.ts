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
 * A bare country reference (no clip_bbox) means the country's HOMELAND. Natural
 * Earth folds integral overseas territory into the parent feature — France
 * carries French Guiana, the Antilles, Mayotte and Réunion — so an unclipped
 * `FR` drew Gaul in South America and the Indian Ocean. COUNTRY_HOMELANDS below
 * trims those pieces off and re-registers them under their conventional codes
 * (`GF`, `GP`, `MQ`, …) so a territory can still claim them by name.
 *
 * Source: Natural Earth ne_50m_admin_0_countries (frontend/public/geo)
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
 * Where a country's homeland is, and which far-flung polygons of its Natural
 * Earth feature belong to a possession that deserves its own ISO code.
 *
 * `homeland`: a polygon of the feature is kept for a bare (unclipped) reference
 * when its bounding box touches ANY of these boxes. Whole polygons are kept or
 * dropped — never cut — so coastlines stay exact and no clipping runs.
 *
 * `possessions`: a dropped polygon whose bbox centre falls in one of these boxes
 * is registered under that code (only if the GeoJSON has no feature for it), so
 * `{ iso: 'GF' }` resolves French Guiana even though the file ships it inside
 * France. The era boards below claim these codes from the NEIGHBOURING
 * territory rather than the colonial parent — that is the whole point of the
 * trim, so Guadeloupe belongs to whoever holds the Caribbean, not to whoever
 * holds Paris. Pieces with no ISO code of their own (the Azores, the Galápagos,
 * Easter Island) are simply dropped.
 *
 * Authored `clip_bbox` references are NOT trimmed: the box already states which
 * part of the country is meant, and community maps rely on that to reach the
 * Antilles through `FR` with a Caribbean box.
 */
export interface CountryHomeland {
  homeland: ClipBbox[];
  possessions?: Record<string, ClipBbox>;
}

export const COUNTRY_HOMELANDS: Record<string, CountryHomeland> = {
  // Metropolitan France + Corsica. Drops the Antilles, French Guiana, Mayotte, Réunion.
  FR: {
    homeland: [[-6, 41, 10, 52]],
    possessions: {
      GP: [-62, 15.8, -61.1, 16.6], // Guadeloupe (Basse-Terre, Grande-Terre, Marie-Galante)
      MQ: [-61.3, 14.3, -60.7, 15], // Martinique
      GF: [-55, 1.5, -51, 6.5], // French Guiana
      YT: [44.5, -13.5, 45.5, -12.5], // Mayotte
      RE: [55, -21.5, 56, -20.5], // Réunion
    },
  },
  // European Netherlands. Drops Bonaire, Saba and Sint Eustatius.
  NL: {
    homeland: [[2, 50, 8, 54]],
    possessions: { BQ: [-69, 11.5, -62.5, 18] }, // Caribbean Netherlands
  },
  // Peninsula + Balearics. Drops the Canaries.
  ES: {
    homeland: [[-10, 35, 5, 44]],
    possessions: { IC: [-19, 27, -13, 30] }, // Canary Islands (ISO 3166-1 reserved code)
  },
  // Mainland. Drops the Azores and Madeira (no ISO 3166-1 codes of their own).
  PT: { homeland: [[-10, 36, -6, 43]] },
  // Mainland + coastal islands. Drops Svalbard, Bear Island and Jan Mayen.
  NO: {
    homeland: [[3, 57, 32, 72]],
    possessions: { SJ: [-10, 70, 36, 81] }, // Svalbard and Jan Mayen
  },
  // North/South Island, the subantarctic islands and the Chathams. Drops Tokelau.
  NZ: {
    homeland: [[165, -53, 180, -33], [-177, -45, -175, -43]],
    possessions: { TK: [-173, -10, -170, -8] }, // Tokelau
  },
  // Continent + Tasmania + Macquarie. Drops Christmas and the Cocos (Keeling) Islands,
  // which Natural Earth ships as a separate "Indian Ocean Ter." feature under AU.
  AU: {
    homeland: [[110, -56, 160, -9]],
    possessions: { CX: [105, -11, 106, -10], CC: [96, -13, 98, -11] },
  },
  // Mainland + Juan Fernández. Drops Easter Island.
  CL: { homeland: [[-82, -57, -65, -17]] },
  // Mainland. Drops the Galápagos.
  EC: { homeland: [[-82, -6, -74, 2]] },
};

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
  // NP ceded to the tibet_nepal frontier (Modern-era unlock).
  northern_india: [
    { iso: 'IN', clip_bbox: [68, 21, 90, 37] },
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
  // Era-growth frontiers of the Ancient board (unlock as the game advances). These
  // ids live ONLY on era_ancient; the Discovery/WWII/Space-Age boards use different
  // ids for the same regions (polar_north, la_amazonia…), so these presets can't
  // collide with them. Real ISO geometry so they render as coastlines instead of the
  // placeholder geo_polygon rectangle (the gray block).
  nippon: [{ iso: 'JP' }],
  greenland: [{ iso: 'GL' }],
  // North America is split into four Discovery-era frontiers. north_america_west and
  // north_america_east REUSE the shared Discovery-board presets below (US+CA to 72°N).
  // `yukon` takes Alaska + the far-NW-Canada strip WEST of -125 that those presets do
  // not cover, so it never double-draws with them. `azteca` is Mexico + Central America.
  yukon: [
    { iso: 'US', clip_bbox: [-170, 51, -130, 72] }, // Alaska (mainland + panhandle)
    { iso: 'CA', clip_bbox: [-141, 49, -125, 72] }, // Yukon/NWT west of the shared -125 clip
  ],
  azteca: [
    { iso: 'MX' }, { iso: 'GT' }, { iso: 'BZ' }, { iso: 'HN' },
    { iso: 'SV' }, { iso: 'NI' }, { iso: 'CR' }, { iso: 'PA' },
  ],
  // South America split: brazil/peru_chile(Andes)/rio_plata REUSE the shared Discovery
  // presets below; gran_colombia (northern SA) is new here.
  gran_colombia: [
    { iso: 'CO' }, { iso: 'VE' }, { iso: 'EC' }, { iso: 'GY' }, { iso: 'SR' }, { iso: 'GF' },
    // Leeward/Windward specks off the same coast; no Caribbean tile is nearer.
    { iso: 'BQ' }, { iso: 'GP' }, { iso: 'MQ' },
  ],
  // SE-Asian archipelago split: philippines REUSES the shared preset below; insulindia
  // (Indonesia) and malaya (Malaysia/Brunei/Singapore) are new. No overlap with the
  // `indochina` frontier (TH/VN/KH/LA/MM).
  insulindia: [{ iso: 'ID' }, { iso: 'CX' }, { iso: 'CC' }],
  malaya: [{ iso: 'MY' }, { iso: 'BN' }, { iso: 'SG' }],
  // SW Pacific / Melanesia — same island set the WWII `pacific_islands` uses (minus
  // PG, which sits west of this frontier's extent). Islands need no clip.
  pacifica: [{ iso: 'FJ' }, { iso: 'VU' }, { iso: 'NC' }, { iso: 'SB' }],
  // Antarctica — four disjoint AQ sectors (the Modern-era frontier continent on the
  // Ancient board). ross_sea needs two clips because its sector crosses the
  // antimeridian. Distinct ids from the WWII/Cold-War Antarctic tiles
  // (antarctica_peninsula, antarctic_west/east…), which live on other maps.
  antarctic_peninsula: [{ iso: 'AQ', clip_bbox: [-110, -90, -45, -60] }],
  queen_maud_land: [{ iso: 'AQ', clip_bbox: [-45, -90, 45, -60] }],
  wilkes_land: [{ iso: 'AQ', clip_bbox: [45, -90, 135, -60] }],
  ross_sea: [
    { iso: 'AQ', clip_bbox: [135, -90, 180, -60] },
    { iso: 'AQ', clip_bbox: [-180, -90, -110, -60] },
  ],
  // Tibet & Nepal — the Himalayan plateau. CN clipped WEST of the Han-China tiles
  // (their clips start at 100°E); NP moves here from northern_india (below).
  tibet_nepal: [
    { iso: 'CN', clip_bbox: [78, 27, 99, 37] },
    { iso: 'NP' },
    { iso: 'BT' },
  ],
  // Hawaii — a mid-Pacific WWII-era frontier. US clipped to the island chain, well
  // clear of the continental/Alaska US clips (yukon, north_america_west/east), so no
  // double-draw.
  hawaii: [{ iso: 'US', clip_bbox: [-161, 18, -154, 23] }],
  // Cuba — Cold-War-era Caribbean frontier. CU is unused elsewhere on the Ancient
  // board (the medieval caribbean_isles preset lives on a different map).
  cuba: [{ iso: 'CU' }],
  // Horn of Africa — WWII-era frontier. Somalia + Djibouti + Kenya; no overlap with
  // aksum (ET/ER) or the southern_africa / central_africa presets on this board.
  horn_of_africa: [{ iso: 'SO' }, { iso: 'DJ' }, { iso: 'KE' }],
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
  // AMERICAN CIVIL WAR — a LAST-DITCH fallback, not the normal path.
  //
  // ACW territories render from real Natural Earth admin-1 state polygons via
  // ACW_TERRITORY_STATES; these boxes are reached only when NONE of a
  // territory's states resolve from the states file. They cannot simply be
  // deleted: era_acw.json has no `projection_bounds`, so with no entry here the
  // map would lose `hasGeoMapping` and fall through to a world-equirectangular
  // projection of an abstract board layout — which would scatter the
  // territories across the globe (the authored canvas is not geographic; New
  // England's centre sits on the canvas's LEFT).
  //
  // Each territory_id MUST map to real geography for that name. Keys are NOT
  // ordered by abstract map grid — never assign “row 0 west→east” boxes to
  // unrelated ids (that put Kentucky in the Rockies and Missouri in the
  // Southwest on the globe).
  //
  // The boxes TILE: they do not overlap, so a territory can never draw over its
  // neighbour and leave the tile flickering between two owners. They used to
  // claim this and not do it — 27 overlapping pairs, and the comment saying
  // otherwise was simply wrong. A territory may use several boxes to make an
  // L or a T; states interlock (the Ohio River, the Georgia/Carolina diagonal)
  // and no rectangle partition matches them exactly, so this trades a little
  // accuracy for no overlap. Measured against real state polygons: 93% of
  // sampled state interior lands in the right territory, against 79% before,
  // with unclaimed points down from 512 to 23.
  // ═══════════════════════════════════════════════════════════════════════════
  acw_far_west: [
    { iso: 'US', clip_bbox: [-125, 40.0, -104, 49.5] },   // MT WY ID + N. Rockies
    { iso: 'US', clip_bbox: [-125, 36.5, -102, 40.0] },   // CO UT NV N.CA (CO's east border is -102)
    { iso: 'US', clip_bbox: [-125, 31.3, -103, 36.5] },   // AZ NM S.CA
  ],
  acw_plains: [
    { iso: 'US', clip_bbox: [-104, 40.0, -95.8, 49.5] },  // ND SD NE (their west border is -104)
    { iso: 'US', clip_bbox: [-102, 36.5, -95.8, 40.0] },  // KS
    { iso: 'US', clip_bbox: [-95.8, 40.6, -90.1, 43.5] }, // IA
    { iso: 'US', clip_bbox: [-103, 34.0, -94.6, 36.5] },  // OK (takes the TX panhandle with it)
  ],
  acw_texas: [{ iso: 'US', clip_bbox: [-103, 25.8, -94.6, 34.0] }], // TX (El Paso falls to far_west)
  acw_louisiana: [
    { iso: 'US', clip_bbox: [-94.6, 28.9, -91.0, 33.0] },
    { iso: 'US', clip_bbox: [-91.0, 28.9, -89.0, 30.2] }, // delta + Gulf coast
  ],
  acw_arkansas:    [{ iso: 'US', clip_bbox: [-94.6, 33.0, -91.0, 36.5] }],
  acw_missouri:    [{ iso: 'US', clip_bbox: [-95.8, 36.5, -89.1, 40.6] }], // MO's south border is 36.5
  acw_mississippi: [{ iso: 'US', clip_bbox: [-91.0, 30.2, -88.3, 35.0] }],
  acw_alabama:     [{ iso: 'US', clip_bbox: [-88.3, 31.0, -85.0, 35.0] }],
  acw_georgia_fl: [
    { iso: 'US', clip_bbox: [-85.0, 24.5, -80.0, 32.0] }, // FL peninsula + S. GA
    { iso: 'US', clip_bbox: [-87.6, 24.5, -85.0, 31.0] }, // FL panhandle
    { iso: 'US', clip_bbox: [-85.0, 32.0, -82.2, 35.0] }, // N. GA
  ],
  acw_tennessee: [{ iso: 'US', clip_bbox: [-91.0, 35.0, -81.7, 36.5] }],
  acw_carolinas: [
    { iso: 'US', clip_bbox: [-82.2, 32.0, -75.4, 35.0] }, // SC + S. NC
    { iso: 'US', clip_bbox: [-81.7, 35.0, -75.4, 36.5] }, // NC beside Tennessee
  ],
  acw_kentucky:    [{ iso: 'US', clip_bbox: [-89.1, 36.5, -82.6, 39.1] }],
  acw_upper_south: [{ iso: 'US', clip_bbox: [-82.6, 36.5, -75.4, 37.9] }], // VA
  acw_appalachia:  [{ iso: 'US', clip_bbox: [-82.6, 37.9, -77.7, 39.7] }], // WV, under the Mason-Dixon line
  acw_mid_atlantic: [
    { iso: 'US', clip_bbox: [-80.5, 39.7, -73.4, 45.1] }, // NY PA (east to the NY/VT border)
    { iso: 'US', clip_bbox: [-77.7, 37.9, -73.4, 39.7] }, // MD DE NJ south of PA
  ],
  acw_new_england:  [{ iso: 'US', clip_bbox: [-73.4, 40.9, -66.9, 47.5] }],
  acw_ohio_indiana: [
    { iso: 'US', clip_bbox: [-88.1, 39.7, -80.5, 41.7] },
    { iso: 'US', clip_bbox: [-88.1, 39.1, -82.6, 39.7] }, // south strip, west of West Virginia
  ],
  acw_great_lakes: [
    { iso: 'US', clip_bbox: [-95.8, 43.5, -82, 49.5] },   // MN WI N.MI
    { iso: 'US', clip_bbox: [-90.1, 41.7, -82, 43.5] },   // S.WI + MI lower peninsula
    { iso: 'US', clip_bbox: [-89.1, 39.3, -88.1, 41.7] }, // IL east of Missouri's box
  ],

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
    { iso: 'BQ' }, { iso: 'GP' }, { iso: 'MQ' }, // Antilles
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
    { iso: 'SJ' }, // Svalbard + Jan Mayen
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
    // E Iraq (Persian Gulf side). Starts at lng 45 where mena_levant's IQ slice
    // ends — the authored canvas puts the Levantine Prefecture at lng 35-45 and
    // the Persian Sun Belt at 45-60, so the seam sits exactly there.
    { iso: 'IQ', clip_bbox: [45, 25, 50, 38] },
    // (Afghanistan is owned entirely by ca_indus to avoid double-claim.)
  ],
  mena_maghreb: [
    { iso: 'MA' },
    { iso: 'DZ' },
    { iso: 'TN' },
    { iso: 'LY', clip_bbox: [-17, 22, 18, 37] },
    { iso: 'EH' },
    { iso: 'MR', clip_bbox: [-17, 22, 0, 28] }, // N Mauritania
    { iso: 'IC' }, // Canaries
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
    // Yemen belongs wholly to mena_arabia. This used to carry
    // { iso: 'YE', clip_bbox: [42, 12, 54, 18] } while mena_arabia claimed YE
    // unclipped, so both territories drew the same country and Yemen flickered
    // between their two owner colours depending on draw order. The authored
    // canvas agrees: Horn of Africa stops at lat 12.5, Arabian Photovoltaic
    // starts at 15 — the peninsula was never meant to be split here.
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
    { iso: 'YT' }, { iso: 'RE' }, // Mayotte + Réunion, with Madagascar
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
    // Starts at lat 22 where ca_deccan's IN slice ends (was 20, which double-
    // claimed the lat 20-22 band). Matches the authored canvas: Ganges
    // Megaregion lat 22-32, Deccan Plateau lat 8-22.
    { iso: 'IN', clip_bbox: [72, 22, 92, 32] },
    { iso: 'NP' },
    { iso: 'BT' },
    { iso: 'BD' },
  ],
  ca_deccan: [
    { iso: 'IN', clip_bbox: [72, 6, 92, 22] },
    { iso: 'LK' },
  ],

  // Asia — China is partitioned across 4 territories: asia_cosmodrome,
  // asia_heartland, asia_coastal and megacity_pacific_rim (defined with the
  // other megacities further down). Their CN clip boxes must tile — territories
  // whose boxes intersect draw the same land twice and the tile flickers
  // between their owners' colours. territoryGeoMapping.test.ts enforces that.
  asia_cosmodrome: [
    // North China + Inner Mongolia + Manchuria (was 73-115, 36-50; expanded
    // east to lng 135 to absorb the Manchuria piece previously stuffed into
    // asia_korea_archipelago, which produced a visible rectangular cut).
    { iso: 'CN', clip_bbox: [73, 38, 135, 54] },
  ],
  asia_heartland: [
    // Central China — Tibet, Yunnan, Sichuan, Hubei, Hunan, Henan inland.
    // Two rectangles because the interior is an L around asia_coastal: the
    // upper band stops at lng 115 where megacity_pacific_rim starts, the lower
    // one stops at lng 100 where asia_coastal starts. The single box this
    // replaced ([73, 22, 115, 38]) reached down to lat 22 across its whole
    // width and so double-claimed lng 100-115 / lat 22-24 with asia_coastal —
    // Guangzhou and Nanning were drawn by both territories.
    { iso: 'CN', clip_bbox: [73, 24, 115, 38] },
    { iso: 'CN', clip_bbox: [73, 18, 100, 24] }, // W/S Yunnan below lat 24
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
    { iso: 'CX' }, { iso: 'CC' }, // Christmas + Cocos (Keeling)
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
    { iso: 'TK' }, // Tokelau
  ],

  // Coastal Megacities — E China coast: Shanghai + Shandong + Hebei + Tianjin
  // + Beijing corridor. Extended north to lat 38 (was 32) to cover the
  // Beijing/Hebei/Shandong gap that was visible on the globe between
  // megacity_pacific_rim and asia_cosmodrome.
  megacity_pacific_rim: [
    { iso: 'CN', clip_bbox: [115, 24, 125, 38] },
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // ERA-GROWTH FRONTIERS (clipped) — real geometry for the land/ice frontiers
  // unlocked as the board grows. Ocean/orbital frontiers stay as authored polygon
  // blocks (no real coastline to use). Antarctic sectors are disjoint AQ clips.
  // ═══════════════════════════════════════════════════════════════════════════
  vinland: [{ iso: 'CA', clip_bbox: [-68, 46, -52, 60] }], // Newfoundland/Labrador (Medieval)
  antarctica_disc: [{ iso: 'AQ', clip_bbox: [-30, -90, 90, -65] }], // Discovery
  antarctica_peninsula: [{ iso: 'AQ', clip_bbox: [-80, -75, -55, -63] }], // WWII
  ross_ice_shelf: [{ iso: 'AQ', clip_bbox: [150, -85, 179, -72] }], // WWII
  antarctic_west: [{ iso: 'AQ', clip_bbox: [-150, -85, -60, -68] }], // Cold War
  antarctic_east: [{ iso: 'AQ', clip_bbox: [20, -85, 160, -68] }], // Cold War
  antarctic_shelf_mod: [{ iso: 'AQ', clip_bbox: [-30, -85, 40, -68] }], // Modern
  antarctic_peninsula_2100: [{ iso: 'AQ', clip_bbox: [-78, -75, -55, -63] }], // Space Age
  antarctic_interior_2100: [{ iso: 'AQ', clip_bbox: [40, -88, 120, -72] }], // Space Age
};

/**
 * Simple territory → ISO codes (no clipping). Used when TERRITORY_GEO_CONFIG has no entry.
 *
 * Possession codes (`GF GP MQ YT RE BQ IC SJ TK CX CC`, see COUNTRY_HOMELANDS)
 * sit on the nearest territory that models their neighbourhood, guarded by
 * territoryPossessions.test.ts. A few stay unclaimed because no era tile is
 * near enough: Réunion outside the Medieval/Modern/2100 boards (the nearest
 * land is ~1700 km away), Tokelau on the Ancient, WWII and Cold War boards,
 * and Mayotte on the Ancient board, whose Southern Africa preset is shared
 * with the Medieval one where Madagascar is the better owner.
 */
export const TERRITORY_ISO_MAP: Record<string, string[]> = {
  // ═══════════════════════════════════════════════════════════════════════════
  // ANCIENT (entries NOT in TERRITORY_GEO_CONFIG)
  // ═══════════════════════════════════════════════════════════════════════════
  britannia: ['GB'],
  gaul: ['FR', 'BE', 'NL', 'LU', 'CH'],
  hispania: ['ES', 'PT'],
  italia: ['IT'],
  north_africa: ['MA', 'DZ', 'TN', 'LY', 'IC'],
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
  scandinavia: ['NO', 'SE', 'FI', 'DK', 'SJ'],
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
  southeast_asia: ['MM', 'TH', 'LA', 'VN', 'KH', 'MY', 'ID', 'BN', 'CX', 'CC'],
  mali_empire: ['MR', 'SN', 'GM', 'ML', 'BF', 'GN', 'SL', 'IC'],
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
  scandinavia_ww2: ['NO', 'SE', 'FI', 'DK', 'SJ'],
  eastern_europe_ww2: ['PL', 'RO', 'HU', 'BG', 'HR', 'SI', 'BA', 'RS', 'ME', 'MK', 'AL', 'GR', 'CZ', 'SK'],
  ukraine: ['UA'],
  caucasus: ['GE', 'AM', 'AZ'],
  morocco_ww2: ['MA', 'DZ', 'IC'],
  libya_egypt: ['LY', 'EG'],
  ethiopia_ww2: ['ET', 'ER', 'DJ', 'SO', 'UG', 'KE'],
  west_africa_ww2: ['MR', 'SN', 'GM', 'GN', 'SL', 'LR', 'CI', 'BF', 'GH', 'TG', 'BJ', 'NG', 'NE'],
  turkey_ww2: ['TR'],
  levant_ww2: ['SY', 'LB', 'IL', 'JO', 'IQ', 'PS'],
  iran_ww2: ['IR'],
  arabia_ww2: ['SA', 'YE', 'OM', 'AE', 'KW', 'QA', 'BH'],
  japan_ww2: ['JP'],
  philippines: ['PH'],
  dutch_east_indies: ['ID', 'CX', 'CC'],
  australia_ww2: ['AU'],
  pacific_islands: ['FJ', 'PG', 'VU', 'NC', 'SB'],
  burma_indochina: ['MM', 'TH', 'LA', 'VN', 'KH', 'MY', 'BN'],
  india_ww2: ['IN', 'PK', 'BD'],
  caribbean: ['CU', 'HT', 'DO', 'JM', 'TT', 'BS', 'PR', 'BZ', 'GT', 'HN', 'SV', 'NI', 'CR', 'PA', 'BQ', 'GP', 'MQ', 'GF'],
  central_africa_ww2: ['TD', 'CF', 'CM', 'GA', 'CG', 'GQ'],
  south_africa_ww2: ['ZA', 'NA', 'BW', 'ZW', 'MZ', 'MW', 'LS', 'SZ', 'YT'],

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
  new_granada: ['CO', 'VE', 'EC', 'BQ', 'GP', 'MQ', 'GF'],
  brazil: ['BR'],
  peru_chile: ['PE', 'CL', 'BO'],
  rio_plata: ['AR', 'UY', 'PY'],
  morocco: ['MA', 'DZ', 'IC'],
  west_africa_disc: ['MR', 'SN', 'GM', 'GN', 'SL', 'LR', 'CI', 'BF', 'GH', 'TG', 'BJ', 'NG', 'NE'],
  central_africa_disc: ['TD', 'CF', 'CM', 'GA', 'CG', 'GQ'],
  east_africa_disc: ['ET', 'ER', 'DJ', 'SO', 'KE', 'UG', 'TZ', 'YT'],
  south_africa: ['ZA', 'NA', 'BW', 'ZW', 'MZ', 'MW', 'LS', 'SZ'],
  ceylon_spice: ['LK'],
  japan_disc: ['JP'],
  southeast_asia_disc: ['MM', 'TH', 'LA', 'VN', 'KH', 'MY', 'ID', 'BN', 'CX', 'CC'],

  // ═══════════════════════════════════════════════════════════════════════════
  // COLD WAR (entries NOT in TERRITORY_GEO_CONFIG)
  // ═══════════════════════════════════════════════════════════════════════════
  uk_ireland: ['GB', 'IE'],
  france_benelux: ['FR', 'BE', 'NL', 'LU'],
  iberia_cw: ['ES', 'PT'],
  italy_cw: ['IT', 'GR'],
  scandinavia_cw: ['NO', 'SE', 'FI', 'DK', 'SJ'],
  turkey_cw: ['TR'],
  czechoslovakia: ['CZ', 'SK', 'HU'],
  romania_bulgaria: ['RO', 'BG'],
  ukraine_cw: ['UA', 'BY'],
  caucasus_cw: ['GE', 'AM', 'AZ', 'KZ', 'UZ', 'TM', 'TJ', 'KG'],
  mexico_ca: ['MX', 'GT', 'HN', 'SV', 'NI', 'CR', 'PA', 'BZ'],
  caribbean_cw: ['CU', 'HT', 'DO', 'JM', 'TT', 'BS', 'PR', 'GP', 'MQ'],
  colombia_venezuela: ['CO', 'VE', 'BQ'],
  brazil_cw: ['BR', 'GF'], // French Guiana shares Brazil's border here
  southern_cone: ['AR', 'CL', 'UY', 'PY', 'BO', 'PE'],
  israel_jordan: ['IL', 'JO', 'PS'],
  egypt_cw: ['EG'],
  iraq_syria: ['IQ', 'SY'],
  iran_cw: ['IR'],
  arabia_cw: ['SA', 'YE', 'OM', 'AE', 'KW', 'QA', 'BH'],
  afghanistan: ['AF'],
  north_africa_cw: ['MA', 'DZ', 'TN', 'LY', 'IC'],
  west_africa_cw: ['MR', 'SN', 'GM', 'GN', 'SL', 'LR', 'CI', 'BF', 'GH', 'TG', 'BJ', 'NG', 'NE'],
  horn_africa: ['ET', 'ER', 'DJ', 'SO', 'KE'],
  central_africa_cw: ['TD', 'CF', 'CM', 'GA', 'CG', 'GQ'],
  southern_africa_cw: ['ZA', 'NA', 'BW', 'ZW', 'MZ', 'MW', 'LS', 'SZ', 'YT'],
  india_cw: ['IN', 'PK', 'BD'],
  vietnam_korea: ['VN', 'LA', 'KH', 'TH', 'MM', 'BN'],
  indonesia_cw: ['ID', 'CX', 'CC'],
  australia_cw: ['AU', 'NZ'],
  korea_cw: ['KP', 'KR'],
  japan_cw: ['JP'],
  mongolia_cw: ['MN'],

  // ═══════════════════════════════════════════════════════════════════════════
  // MODERN (entries NOT in TERRITORY_GEO_CONFIG)
  // ═══════════════════════════════════════════════════════════════════════════
  canada_mod: ['CA'],
  mexico_mod: ['MX'],
  central_america_mod: ['GT', 'BZ', 'HN', 'SV', 'NI', 'CR', 'PA', 'CU', 'JM', 'HT', 'DO', 'TT', 'BS', 'PR', 'GP', 'MQ'],
  colombia_mod: ['CO', 'VE', 'GY', 'SR', 'GF', 'BQ'],
  brazil_mod: ['BR'],
  peru_mod: ['PE', 'EC', 'BO'],
  argentina_mod: ['AR', 'UY'],
  chile_mod: ['CL', 'PY'],
  uk_mod: ['GB', 'IE'],
  france_mod: ['FR', 'BE', 'NL', 'LU'],
  germany_mod: ['DE', 'AT', 'CZ', 'CH'],
  scandinavia_mod: ['NO', 'SE', 'FI', 'DK', 'IS', 'SJ'],
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
  maghreb_mod: ['MA', 'DZ', 'TN', 'LY', 'IC'],
  west_africa_mod: ['SN', 'GM', 'GN', 'GW', 'SL', 'LR', 'CI', 'GH', 'TG', 'BJ', 'BF', 'ML', 'NE', 'MR'],
  nigeria_mod: ['NG', 'CM', 'GQ'],
  central_africa_mod: ['CD', 'CG', 'GA', 'CF', 'TD', 'AO'],
  sudan_horn_mod: ['SD', 'SS', 'ER', 'DJ', 'SO'],
  east_africa_mod: ['ET', 'KE', 'TZ', 'UG', 'RW', 'BI', 'MG', 'YT', 'RE'],
  southern_africa_mod: ['ZA', 'NA', 'BW', 'ZW', 'ZM', 'MW', 'MZ', 'SZ', 'LS'],
  india_mod: ['IN', 'NP', 'BD', 'LK', 'BT'],
  pakistan_afghan_mod: ['PK', 'AF'],
  japan_mod: ['JP'],
  korea_mod: ['KR', 'KP'],
  southeast_asia_mod: ['TH', 'VN', 'KH', 'LA', 'MM', 'MY', 'SG', 'BN'],
  indonesia_mod: ['ID', 'PH', 'TL', 'PG', 'CX', 'CC'],
  australia_mod: ['AU', 'NZ', 'FJ', 'TK'], // NZ administers Tokelau

  // ═══════════════════════════════════════════════════════════════════════════
  // ERA-GROWTH FRONTIERS (real land/island geometry). Shared ids (australia,
  // southern_africa) also upgrade those frontiers on any other era that uses them.
  // ═══════════════════════════════════════════════════════════════════════════
  caribbean_isles: ['CU', 'DO', 'HT', 'JM', 'BS', 'PR', 'TT', 'BQ', 'GP', 'MQ', 'GF'], // Medieval
  southern_africa: ['ZA', 'NA', 'BW', 'ZW', 'MZ', 'LS', 'SZ', 'AO', 'ZM'], // Medieval (+Ancient)
  madagascar: ['MG', 'MU', 'SC', 'KM', 'YT', 'RE'], // Medieval
  australia: ['AU'], // Medieval + Discovery
  polynesia: ['PF', 'WS', 'TO', 'CK', 'NU', 'TV', 'TK'], // Medieval
  micronesia: ['FM', 'MH', 'PW', 'GU', 'MP', 'KI', 'TK'], // Discovery
  new_zealand: ['NZ'], // Discovery
  polar_north: ['GL', 'SJ'], // Discovery (Greenland + Svalbard)
  falklands_ww2: ['FK', 'GS'], // WWII
};

export function hasGeoMapping(territoryId: string): boolean {
  return territoryId in TERRITORY_GEO_CONFIG || territoryId in TERRITORY_ISO_MAP;
}
