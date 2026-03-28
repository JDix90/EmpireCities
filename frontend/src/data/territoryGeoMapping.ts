/**
 * Maps ChronoConquest territory IDs to GeoJSON country codes and optional clip regions.
 * Used by GlobeMap to render real geographic boundaries.
 *
 * Resolution order:
 * 1. territory.geo_config or (territory.iso_codes + territory.clip_bbox) from map data
 * 2. TERRITORY_GEO_CONFIG or TERRITORY_ISO_MAP (preset lookups)
 * 3. Canvas projection fallback
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
  // DISCOVERY ERA — North America split
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

  // ═══════════════════════════════════════════════════════════════════════════
  // COLD WAR ERA — USA and China splits
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

  // ═══════════════════════════════════════════════════════════════════════════
  // ANCIENT & MEDIEVAL — China region splits
  // ═══════════════════════════════════════════════════════════════════════════
  northern_china: [{ iso: 'CN', clip_bbox: [105, 32, 125, 42] }],
  central_china: [{ iso: 'CN', clip_bbox: [100, 26, 120, 34] }],
  southern_china: [{ iso: 'CN', clip_bbox: [98, 18, 118, 28] }],
  northern_china_med: [{ iso: 'CN', clip_bbox: [105, 32, 125, 42] }],
  song_china: [{ iso: 'CN', clip_bbox: [108, 22, 122, 34] }],
  southern_china_med: [{ iso: 'CN', clip_bbox: [98, 18, 115, 28] }],
  manchuria: [
    { iso: 'CN', clip_bbox: [118, 38, 135, 55] },
    { iso: 'KP' },
    { iso: 'KR' },
  ],
};

/** Simple territory → ISO codes (no clipping). Used when TERRITORY_GEO_CONFIG has no entry. */
export const TERRITORY_ISO_MAP: Record<string, string[]> = {
  // WW2
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

  // Ancient
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
  bactria: ['AF', 'TM', 'UZ', 'TJ'],
  arabia: ['SA', 'YE', 'OM', 'AE', 'KW', 'QA', 'BH'],
  pontic_steppe: ['UA', 'MD', 'RO'],
  central_steppe: ['KZ', 'UZ', 'TM'],
  eastern_steppe: ['KZ', 'MN'],
  kushan: ['AF', 'PK', 'TJ', 'UZ'],
  northern_india: ['IN', 'PK', 'NP'],
  southern_india: ['IN'],
  aksum: ['ET', 'ER'],
  west_africa: ['MR', 'SN', 'GM', 'GN', 'ML', 'BF', 'NE', 'NG'],
  central_africa: ['TD', 'CF', 'CM', 'GA', 'CG', 'GQ'],
  germania: ['DE', 'NL', 'BE', 'PL'],
  sarmatia: ['UA', 'BY', 'PL'],

  // Medieval
  england: ['GB'],
  france: ['FR'],
  iberia: ['ES', 'PT'],
  holy_roman: ['DE', 'CZ', 'AT', 'CH', 'NL', 'BE', 'IT'],
  italy_states: ['IT'],
  scandinavia: ['NO', 'SE', 'FI', 'DK'],
  poland_bohemia: ['PL', 'CZ'],
  kievan_rus: ['UA', 'BY', 'RU'],
  byzantine: ['GR', 'TR', 'BG', 'MK', 'RS', 'BA', 'ME', 'AL', 'CY'],
  hungary: ['HU', 'SK', 'HR', 'RS', 'RO'],
  anatolia_med: ['TR'],
  levant_crusader: ['SY', 'LB', 'IL', 'PS'],
  egypt_ayyubid: ['EG'],
  mesopotamia_med: ['IQ', 'SY'],
  persia_med: ['IR'],
  arabia_med: ['SA', 'YE', 'OM', 'AE', 'KW', 'QA', 'BH'],
  mongolia: ['MN'],
  central_asia: ['KZ', 'UZ', 'TM', 'TJ', 'AF', 'KG'],
  siberia: ['RU'],
  korea_japan: ['KP', 'KR', 'JP'],
  delhi_sultanate: ['IN', 'PK', 'NP', 'BD'],
  south_india_med: ['IN'],
  southeast_asia: ['MM', 'TH', 'LA', 'VN', 'KH', 'MY', 'ID', 'BN'],
  mali_empire: ['MR', 'SN', 'GM', 'ML', 'BF', 'GN', 'SL'],
  east_africa_med: ['ET', 'ER', 'DJ', 'SO', 'KE', 'UG'],
  central_africa_med: ['TD', 'CF', 'CM', 'GA', 'CG', 'GQ'],

  // Discovery (non-split)
  spain_portugal: ['ES', 'PT'],
  france_disc: ['FR'],
  britain_disc: ['GB'],
  holy_roman_disc: ['DE', 'CZ', 'AT', 'CH', 'NL', 'BE', 'IT'],
  russia_disc: ['RU', 'UA', 'BY', 'KZ'],
  italy_disc: ['IT'],
  ottoman_balkans: ['TR', 'GR', 'BG', 'MK', 'RS', 'BA', 'ME', 'AL', 'HR', 'SI'],
  anatolia_disc: ['TR'],
  levant_disc: ['SY', 'LB', 'IL', 'JO', 'PS'],
  egypt_disc: ['EG'],
  mesopotamia_disc: ['IQ', 'SY'],
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
  mughal_north: ['IN', 'PK', 'NP', 'BD'],
  mughal_south: ['IN'],
  ceylon_spice: ['LK', 'ID', 'MY'],
  japan_disc: ['JP'],
  southeast_asia_disc: ['MM', 'TH', 'LA', 'VN', 'KH', 'MY', 'ID', 'BN'],

  // Cold War (non-split)
  uk_ireland: ['GB', 'IE'],
  france_benelux: ['FR', 'BE', 'NL', 'LU'],
  west_germany: ['DE'],
  iberia_cw: ['ES', 'PT'],
  italy_cw: ['IT', 'GR'],
  scandinavia_cw: ['NO', 'SE', 'FI', 'DK'],
  turkey_cw: ['TR'],
  east_germany: ['DE', 'PL'],
  czechoslovakia: ['CZ', 'SK', 'HU'],
  romania_bulgaria: ['RO', 'BG'],
  ukraine_cw: ['UA', 'BY'],
  caucasus_cw: ['GE', 'AM', 'AZ', 'KZ', 'UZ', 'TM', 'TJ', 'KG', 'AF'],
  canada: ['CA'],
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
  vietnam_korea: ['VN', 'LA', 'KH', 'TH', 'MM', 'KP', 'KR', 'BN'],
  indonesia_cw: ['ID'],
  australia_cw: ['AU', 'NZ'],
  korea_cw: ['KP', 'KR'],
  japan_cw: ['JP'],
  mongolia_cw: ['MN'],
};

export function hasGeoMapping(territoryId: string): boolean {
  return territoryId in TERRITORY_GEO_CONFIG || territoryId in TERRITORY_ISO_MAP;
}
