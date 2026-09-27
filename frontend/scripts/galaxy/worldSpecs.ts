/**
 * Galactic Age world specs — the single authored source for every world on the
 * `era_galaxy` board (and, through `backend/scripts/buildAscensionGalaxyMap.ts`,
 * for the far worlds on Space to Stars).
 *
 * A spec says what a world IS: its territories and which region each belongs
 * to, the regions and their bonuses, and the hyperspace lanes. The generator
 * (`generateGalaxyWorlds.ts`) turns specs into geometry and writes the map. The
 * map file itself is output — hand edits to it are overwritten on the next run,
 * which is how the 16-region split went missing from the old generator.
 *
 * Nothing here is a design change: these specs reproduce the shipped board
 * exactly, and a drift test (`src/data/galaxyWorldsDrift.test.ts`) fails if the
 * committed files ever stop matching them.
 */

export type LngLat = [number, number];

export interface GalaxyRegionSpec {
  region_id: string;
  name: string;
  bonus: number;
}

export interface GalaxyTerritorySpec {
  name: string;
  region_id: string;
}

/**
 * A far world laid out as a seeded Voronoi over most of the sphere (the shipped
 * layout). Territories are listed in seed order: seed `i` becomes territory
 * `territories[i]`, so reordering this list moves every border.
 */
export interface VoronoiWorldSpec {
  kind: 'voronoi';
  world_id: string;
  /** Territory ids are `${prefix}_${slug(name)}`. */
  prefix: string;
  seed: number;
  regions: GalaxyRegionSpec[];
  territories: GalaxyTerritorySpec[];
}

export type FarWorldSpec = VoronoiWorldSpec;

/** One Sol III territory: a group of Natural Earth building blocks, so coastlines stay real. */
export interface SolTerritorySpec {
  id: string;
  name: string;
  region_id: string;
  /** `TERRITORY_GEO_CONFIG` keys merged into this territory's globe geometry. */
  keys: string[];
  /** Centre of the 2D/strategic footprint blob. */
  centroid: LngLat;
}

export interface SolWorldSpec {
  world_id: 'sol';
  regions: GalaxyRegionSpec[];
  territories: SolTerritorySpec[];
}

/** An authored hyperspace lane between gateway systems on two different worlds. */
export interface GalaxyLaneSpec {
  from: string;
  to: string;
}

export interface GalaxySpecs {
  sol: SolWorldSpec;
  farWorlds: FarWorldSpec[];
  lanes: GalaxyLaneSpec[];
}

const SOL: SolWorldSpec = {
  world_id: 'sol',
  regions: [
    { region_id: 'sol_americas', name: 'Sol — Western Hemisphere', bonus: 3 },
    { region_id: 'sol_atlantic_arc', name: 'Sol — Atlantic Arc', bonus: 3 },
    { region_id: 'sol_crescent', name: 'Sol — Crescent Reach', bonus: 3 },
    { region_id: 'sol_asian_rim', name: 'Sol — Asian Rim', bonus: 3 },
  ],
  territories: [
    { id: 'sol_columbia', name: 'Columbia Reach', region_id: 'sol_americas', keys: ['na_eastern_corridor', 'na_launch_base', 'na_southern_belt', 'la_caribbean'], centroid: [-82, 36] },
    { id: 'sol_pacifica', name: 'Pacifica Shelf', region_id: 'sol_americas', keys: ['na_western_states', 'na_central_plains', 'na_arctic_dominion'], centroid: [-112, 50] },
    { id: 'sol_atlantic_europe', name: 'Atlantic Europe', region_id: 'sol_atlantic_arc', keys: ['euro_british_isles', 'euro_iberia', 'euro_nordic'], centroid: [-4, 52] },
    { id: 'sol_eastern_reach', name: 'Eastern Reach', region_id: 'sol_crescent', keys: ['euro_balkan', 'euro_spaceport', 'euro_east'], centroid: [28, 52] },
    { id: 'sol_maghreb', name: 'Maghreb Span', region_id: 'sol_crescent', keys: ['mena_maghreb', 'mena_nile', 'mena_levant'], centroid: [20, 28] },
    { id: 'sol_arabia', name: 'Arabian Gate', region_id: 'sol_crescent', keys: ['mena_arabia', 'mena_persia'], centroid: [50, 27] },
    { id: 'sol_guinea', name: 'Guinea Coast', region_id: 'sol_atlantic_arc', keys: ['africa_west', 'africa_sahel'], centroid: [0, 12] },
    { id: 'sol_equatoria', name: 'Equatorial Reach', region_id: 'sol_atlantic_arc', keys: ['africa_congo_basin', 'africa_horn', 'africa_east'], centroid: [28, 2] },
    { id: 'sol_austral', name: 'Austral Cape', region_id: 'sol_atlantic_arc', keys: ['africa_south'], centroid: [25, -28] },
    { id: 'sol_turkestan', name: 'Turkestan Steppe', region_id: 'sol_crescent', keys: ['ca_steppe', 'ca_tien_shan', 'asia_siberia_belt'], centroid: [78, 56] },
    { id: 'sol_hindustan', name: 'Hindustan', region_id: 'sol_asian_rim', keys: ['ca_indus', 'ca_ganges', 'ca_deccan'], centroid: [78, 22] },
    { id: 'sol_cathay', name: 'Cathay', region_id: 'sol_asian_rim', keys: ['asia_cosmodrome', 'asia_heartland', 'asia_coastal'], centroid: [104, 36] },
    { id: 'sol_pacific_rim', name: 'Pacific Rim', region_id: 'sol_asian_rim', keys: ['asia_korea_archipelago', 'asia_japan_islands', 'asia_indochina', 'asia_malay_archipelago', 'megacity_pacific_rim'], centroid: [128, 22] },
    { id: 'sol_oceania', name: 'Oceania', region_id: 'sol_asian_rim', keys: ['oc_australia', 'oc_new_zealand', 'oc_micronesia', 'oc_polynesia'], centroid: [140, -26] },
    { id: 'sol_amazonia', name: 'Amazon Basin', region_id: 'sol_americas', keys: ['la_amazonia', 'la_andes'], centroid: [-66, -8] },
    { id: 'sol_southern_cone', name: 'Southern Cone', region_id: 'sol_americas', keys: ['la_pampas', 'la_patagonia'], centroid: [-63, -38] },
  ],
};

const VERDAN: VoronoiWorldSpec = {
  kind: 'voronoi',
  world_id: 'verdan',
  prefix: 'verdan',
  seed: 4404,
  regions: [
    { region_id: 'verdan_sporefields', name: 'Verdan — Spore Fields', bonus: 3 },
    { region_id: 'verdan_mirelands', name: 'Verdan — Mirelands', bonus: 3 },
    { region_id: 'verdan_lumen_crown', name: 'Verdan — Lumen Crown', bonus: 3 },
    { region_id: 'verdan_stormbelts', name: 'Verdan — Storm Belts', bonus: 3 },
  ],
  territories: [
    { name: 'Spore Reach', region_id: 'verdan_sporefields' },
    { name: 'Glowmire Shelf', region_id: 'verdan_mirelands' },
    { name: 'Cinder Bloom', region_id: 'verdan_lumen_crown' },
    { name: 'Mistveil Hollow', region_id: 'verdan_stormbelts' },
    { name: 'Chlorophage Span', region_id: 'verdan_sporefields' },
    { name: 'Saffron Mire', region_id: 'verdan_mirelands' },
    { name: 'Verdigris Span', region_id: 'verdan_mirelands' },
    { name: 'Thundercrown Belt', region_id: 'verdan_stormbelts' },
    { name: 'Lumen Bog', region_id: 'verdan_sporefields' },
    { name: 'Photic Crown', region_id: 'verdan_lumen_crown' },
    { name: 'Sulphur Drift', region_id: 'verdan_stormbelts' },
    { name: 'Pollen Sea', region_id: 'verdan_lumen_crown' },
    { name: 'Emberleaf Basin', region_id: 'verdan_sporefields' },
    { name: 'Mycel Deep', region_id: 'verdan_mirelands' },
    { name: 'Witchlight Fen', region_id: 'verdan_lumen_crown' },
    { name: 'Greenfire Vault', region_id: 'verdan_stormbelts' },
  ],
};

const RUST: VoronoiWorldSpec = {
  kind: 'voronoi',
  world_id: 'rust',
  prefix: 'rust',
  seed: 7711,
  regions: [
    { region_id: 'rust_slag_wastes', name: 'Rust — Slag Wastes', bonus: 3 },
    { region_id: 'rust_foundry_core', name: 'Rust — Foundry Core', bonus: 3 },
    { region_id: 'rust_ironstorm', name: 'Rust — Ironstorm Belt', bonus: 3 },
    { region_id: 'rust_anchor_works', name: 'Rust — Anchor Works', bonus: 3 },
  ],
  territories: [
    { name: 'Slag Reach', region_id: 'rust_slag_wastes' },
    { name: 'Ferro Span', region_id: 'rust_anchor_works' },
    { name: 'Cinderworks', region_id: 'rust_foundry_core' },
    { name: 'Oxide Flats', region_id: 'rust_foundry_core' },
    { name: 'Tailing Drift', region_id: 'rust_slag_wastes' },
    { name: 'Anvil Basin', region_id: 'rust_ironstorm' },
    { name: 'Smelter Crown', region_id: 'rust_anchor_works' },
    { name: 'Ironstorm Belt', region_id: 'rust_ironstorm' },
    { name: 'Caldera Foundry', region_id: 'rust_slag_wastes' },
    { name: 'Tether Anchorage', region_id: 'rust_anchor_works' },
    { name: 'Bessemer Cut', region_id: 'rust_ironstorm' },
    { name: 'Dross Hollow', region_id: 'rust_foundry_core' },
    { name: 'Hematite Span', region_id: 'rust_slag_wastes' },
    { name: 'Crucible Deep', region_id: 'rust_anchor_works' },
    { name: 'Scoria Flats', region_id: 'rust_ironstorm' },
    { name: 'Furnace Marches', region_id: 'rust_foundry_core' },
  ],
};

const NEXUS: VoronoiWorldSpec = {
  kind: 'voronoi',
  world_id: 'nexus_station',
  prefix: 'nexus',
  seed: 9021,
  regions: [
    { region_id: 'nexus_gate_ring', name: 'Nexus — Gate Ring', bonus: 3 },
    { region_id: 'nexus_vault_ward', name: 'Nexus — Vault Ward', bonus: 3 },
    { region_id: 'nexus_spire_walk', name: 'Nexus — Spire Walk', bonus: 3 },
    { region_id: 'nexus_berth_ring', name: 'Nexus — Berth Ring', bonus: 3 },
  ],
  territories: [
    { name: 'Gate Threshold', region_id: 'nexus_gate_ring' },
    { name: 'Halo Span', region_id: 'nexus_berth_ring' },
    { name: 'Custodian Quarter', region_id: 'nexus_vault_ward' },
    { name: 'Basin Mandate', region_id: 'nexus_gate_ring' },
    { name: 'Resonance Vault', region_id: 'nexus_vault_ward' },
    { name: 'Lodgeway', region_id: 'nexus_spire_walk' },
    { name: 'Toll Crater', region_id: 'nexus_berth_ring' },
    { name: 'Antenna Spire', region_id: 'nexus_spire_walk' },
    { name: 'Echo Concourse', region_id: 'nexus_gate_ring' },
    { name: 'Lattice Berth', region_id: 'nexus_berth_ring' },
    { name: 'Quietude Basin', region_id: 'nexus_spire_walk' },
    { name: 'Vault Approach', region_id: 'nexus_vault_ward' },
    { name: 'Harmonic Rim', region_id: 'nexus_gate_ring' },
    { name: 'Waystation Loni', region_id: 'nexus_berth_ring' },
    { name: 'Cordon March', region_id: 'nexus_spire_walk' },
    { name: 'Beacon Hollow', region_id: 'nexus_vault_ward' },
  ],
};

/**
 * The authored ring sol–verdan–rust–nexus–sol, two lanes per neighbouring pair,
 * no tile on more than one lane. Listed explicitly: the old generator picked the
 * ids that sorted 1st, 5th, 9th and 13th on each world, so a rename moved a lane.
 * On Space to Stars the Moon takes Sol's place (buildAscensionGalaxyMap.ts).
 */
const LANES: GalaxyLaneSpec[] = [
  { from: 'sol_guinea', to: 'verdan_chlorophage_span' },
  { from: 'sol_pacific_rim', to: 'verdan_greenfire_vault' },
  { from: 'verdan_photic_crown', to: 'rust_anvil_basin' },
  { from: 'verdan_sulphur_drift', to: 'rust_crucible_deep' },
  { from: 'rust_hematite_span', to: 'nexus_antenna_spire' },
  { from: 'rust_slag_reach', to: 'nexus_custodian_quarter' },
  { from: 'nexus_harmonic_rim', to: 'sol_amazonia' },
  { from: 'nexus_resonance_vault', to: 'sol_cathay' },
];

export const GALAXY_SPECS: GalaxySpecs = {
  sol: SOL,
  farWorlds: [VERDAN, RUST, NEXUS],
  lanes: LANES,
};
