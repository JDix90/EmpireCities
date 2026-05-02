/**
 * Galactic Age — Sol III globe geometry.
 *
 * Reuses the Space Age Earth admin-0 partition (Natural Earth clips) so Sol III
 * renders with real coastlines. Each Sol territory aggregates several Space Age
 * `TERRITORY_GEO_CONFIG` entries; together they tile the planet without overlap.
 */

import type { TerritoryGeoConfig } from './territoryGeoMapping';
import { TERRITORY_GEO_CONFIG } from './territoryGeoMapping';

function mergeConfigs(...keys: (keyof typeof TERRITORY_GEO_CONFIG)[]): TerritoryGeoConfig {
  const out: TerritoryGeoConfig = [];
  for (const k of keys) {
    const chunk = TERRITORY_GEO_CONFIG[k];
    if (chunk?.length) out.push(...chunk);
  }
  return out;
}

/** Atlantic Americas + Atlantic Europe + Caribbean + Maghreb façade + West Africa + Central America arc */
export const GALAXY_SOL_TERRITORY_GEO: Record<string, TerritoryGeoConfig> = {
  sol_atlantic: mergeConfigs(
    'na_eastern_corridor',
    'na_launch_base',
    'euro_british_isles',
    'euro_iberia',
    'la_caribbean',
    'euro_nordic',
    'mena_maghreb',
    'africa_west',
    'na_southern_belt',
  ),
  sol_mediterranean: mergeConfigs(
    'euro_balkan',
    'euro_spaceport',
    'mena_levant',
    'mena_nile',
  ),
  sol_panasian: mergeConfigs(
    'asia_cosmodrome',
    'asia_heartland',
    'asia_coastal',
    'asia_korea_archipelago',
    'asia_japan_islands',
    'asia_indochina',
    'ca_steppe',
    'ca_tien_shan',
    'ca_indus',
    'ca_ganges',
    'ca_deccan',
    'asia_siberia_belt',
    'euro_east',
    'mena_arabia',
    'mena_persia',
    'megacity_pacific_rim',
  ),
  sol_equatorial: mergeConfigs(
    'africa_sahel',
    'africa_congo_basin',
    'africa_horn',
    'africa_east',
    'africa_south',
  ),
  sol_pacific: mergeConfigs(
    'na_arctic_dominion',
    'na_western_states',
    'na_central_plains',
    'asia_malay_archipelago',
    'oc_australia',
    'oc_new_zealand',
    'oc_micronesia',
    'oc_polynesia',
  ),
  sol_antarctic: mergeConfigs('la_amazonia', 'la_andes', 'la_pampas', 'la_patagonia'),
};
