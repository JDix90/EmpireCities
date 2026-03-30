/**
 * Maps ChronoConquest territory IDs to GeoJSON country codes and optional clip regions.
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
  manchuria_ww2: [
    { iso: 'CN', clip_bbox: [118, 38, 135, 55] },
    { iso: 'KP' },
    { iso: 'KR' },
  ],
  north_china_ww2: [{ iso: 'CN', clip_bbox: [105, 32, 125, 42] }],
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
  west_africa: ['MR', 'SN', 'GM', 'GN', 'ML', 'BF', 'NE', 'NG'],
  central_africa: ['TD', 'CF', 'CM', 'GA', 'CG', 'GQ'],
  germania: ['DE'],
  sarmatia: ['BY', 'PL'],

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
