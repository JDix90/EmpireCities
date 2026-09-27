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
 * A drift test (`src/data/galaxyWorldsDrift.test.ts`) fails if the committed
 * files ever stop matching these specs.
 */

import { NEXUS_GATE, RUST_RIFT_NORTH, RUST_RIFT_SOUTH, VERDAN_SUBSTELLAR } from '../../src/data/galaxyWorldFrames';
import { polar } from './sphere';

export type LngLat = [number, number];

export interface GalaxyRegionSpec {
  region_id: string;
  name: string;
  bonus: number;
}

/**
 * A region of land (or water, in `cut`): a disc, a ring, a thick great-circle
 * polyline (optionally tapered, one radius per point), an ellipse in the
 * tangent plane, or a convex spherical polygon. Sizes in degrees; headings
 * from north, clockwise.
 */
export type SkeletonShape =
  | { kind: 'cap'; center: LngLat; radius: number }
  | { kind: 'band'; center: LngLat; mid: number; half: number }
  | { kind: 'capsule'; points: LngLat[]; radius: number; radii?: number[] }
  | { kind: 'ellipse'; center: LngLat; a: number; b: number; heading: number }
  | { kind: 'polygon'; points: LngLat[] };

export interface SkeletonTerritorySpec {
  id: string;
  name: string;
  region_id: string;
  /** A point on land; each land cell goes to the nearest seed by path through land. */
  at: LngLat;
  /** Below 1 gives the seed a late start, so the territory comes out smaller. */
  weight?: number;
}

/**
 * A far world built from an authored landmass skeleton (see `skeletonWorld.ts`).
 * The graph is part of the design: the generator fails unless the geometry
 * produces exactly `landBorders`, and every `seaLinks` pair crosses real water.
 */
export interface SkeletonWorldSpec {
  kind: 'skeleton';
  world_id: string;
  seed: number;
  /** Land is `add`, minus `cut`, plus `restore` (an island inside a cut). */
  land: { add: SkeletonShape[]; cut: SkeletonShape[]; restore?: SkeletonShape[] };
  /** Coastline roughness: amplitude in degrees, base frequency on the unit sphere. */
  noise: { amp: number; freq: number };
  /** Domain warp that bends the skeleton's shapes before they are evaluated. */
  warp: { amp: number; freq: number };
  /** Cost noise in the partition, which makes borders meander. */
  border: { freq: number; noise: number };
  regions: GalaxyRegionSpec[];
  territories: SkeletonTerritorySpec[];
  landBorders: Array<[string, string]>;
  seaLinks: Array<[string, string]>;
  /** Widest water a sea link may cross, in degrees. */
  maxSeaGap: number;
  /** Smallest tile, in percent of the sphere, so every tile stays tappable on a phone. */
  minTileArea: number;
}

export type FarWorldSpec = SkeletonWorldSpec;

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

/**
 * Verdan Reach — the Twilight Ring.
 *
 * Verdan is tidally locked. Its day side is the Brilliance, a white-hot sea of
 * sulphur cloud turning round a permanent storm, the Eye; its night side is
 * black ice. The canopy lives only in the twilight between: two crescent
 * continents of glowing fen, broken at each end by a storm strait, with a chain
 * of isles running across the Brilliance through the Eye.
 *
 * The world is a loop: every region has two land fronts and no rear. Sol's
 * lanes come down on the Dawn crescent, Rust's on the Dusk crescent, so
 * crossing Verdan means going round the ring, over a strait, or through the
 * Eye. Storms cap every stack at 12, so nobody plugs the Eye with one army.
 *
 * Everything is placed relative to the substellar point, so the design moves
 * rigidly with it. It sits at 50°N so the ring clears both poles and its north
 * storm strait lies on the antimeridian, where no territory may cross.
 */
const VERDAN_SUN: LngLat = VERDAN_SUBSTELLAR;
const vr = (azimuth: number, dist: number): LngLat => polar(VERDAN_SUN, azimuth, dist);
const VERDAN_RING = 80; // ring centre-line distance from the substellar point

const VERDAN: SkeletonWorldSpec = {
  kind: 'skeleton',
  world_id: 'verdan',
  seed: 4404,
  land: {
    add: [
      { kind: 'band', center: VERDAN_SUN, mid: VERDAN_RING, half: 17 }, // the twilight ring
      { kind: 'cap', center: VERDAN_SUN, radius: 11 }, // the Eye
      { kind: 'capsule', points: [vr(90, 29), vr(90, 43)], radius: 8.5 }, // Mycel Deep
      { kind: 'capsule', points: [vr(270, 29), vr(270, 43)], radius: 8.5 }, // Pollen Sea
      { kind: 'capsule', points: [vr(116, 92), vr(116, 110)], radius: 7.5 }, // Lumen Bog, the night-side cape
    ],
    cut: [
      { kind: 'capsule', points: [vr(0, 55), vr(0, 105)], radius: 3.4 }, // north storm strait
      { kind: 'capsule', points: [vr(180, 55), vr(180, 105)], radius: 5.5 }, // south storm strait
    ],
  },
  noise: { amp: 5, freq: 3.4 },
  warp: { amp: 0.07, freq: 2.2 },
  border: { freq: 4, noise: 1.6 },
  regions: [
    { region_id: 'verdan_sporefields', name: 'Verdan — Dawnrim', bonus: 3 },
    { region_id: 'verdan_mirelands', name: 'Verdan — Emberfen', bonus: 2 },
    { region_id: 'verdan_lumen_crown', name: 'Verdan — Duskrim', bonus: 2 },
    { region_id: 'verdan_stormbelts', name: 'Verdan — Storm Belts', bonus: 2 },
    { region_id: 'verdan_brilliance', name: 'Verdan — Brilliance Isles', bonus: 3 },
  ],
  territories: [
    // Dawn crescent: the Sol / Luna front.
    { id: 'verdan_spore_reach', name: 'Spore Reach', region_id: 'verdan_sporefields', at: vr(34, 72) },
    { id: 'verdan_verdigris_span', name: 'Verdigris Span', region_id: 'verdan_sporefields', at: vr(40, 90) },
    { id: 'verdan_saffron_mire', name: 'Saffron Mire', region_id: 'verdan_sporefields', at: vr(84, 70) },
    { id: 'verdan_chlorophage_span', name: 'Chlorophage Span', region_id: 'verdan_sporefields', at: vr(92, 90) },
    { id: 'verdan_glowmire_shelf', name: 'Glowmire Shelf', region_id: 'verdan_mirelands', at: vr(136, 72) },
    { id: 'verdan_greenfire_vault', name: 'Greenfire Vault', region_id: 'verdan_mirelands', at: vr(142, 90) },
    { id: 'verdan_lumen_bog', name: 'Lumen Bog', region_id: 'verdan_mirelands', at: vr(116, 104), weight: 0.85 },
    // Dusk crescent: the Rust front.
    { id: 'verdan_photic_crown', name: 'Photic Crown', region_id: 'verdan_lumen_crown', at: vr(326, 72) },
    { id: 'verdan_thundercrown_belt', name: 'Thundercrown Belt', region_id: 'verdan_lumen_crown', at: vr(318, 90) },
    { id: 'verdan_witchlight_fen', name: 'Witchlight Fen', region_id: 'verdan_lumen_crown', at: vr(276, 71) },
    { id: 'verdan_mistveil_hollow', name: 'Mistveil Hollow', region_id: 'verdan_stormbelts', at: vr(268, 90) },
    { id: 'verdan_cinder_bloom', name: 'Cinder Bloom', region_id: 'verdan_stormbelts', at: vr(224, 72) },
    { id: 'verdan_sulphur_drift', name: 'Sulphur Drift', region_id: 'verdan_stormbelts', at: vr(218, 90) },
    // The Brilliance Isles, across the day side through the Eye. The Eye keeps
    // its old id so saved games, tests and lore keys survive the rename.
    { id: 'verdan_mycel_deep', name: 'Mycel Deep', region_id: 'verdan_brilliance', at: vr(90, 36), weight: 0.8 },
    { id: 'verdan_emberleaf_basin', name: 'The Eye', region_id: 'verdan_brilliance', at: VERDAN_SUN, weight: 0.8 },
    { id: 'verdan_pollen_sea', name: 'Pollen Sea', region_id: 'verdan_brilliance', at: vr(270, 36), weight: 0.8 },
  ],
  landBorders: [
    // Dawnrim and Emberfen
    ['verdan_spore_reach', 'verdan_verdigris_span'],
    ['verdan_spore_reach', 'verdan_saffron_mire'],
    ['verdan_verdigris_span', 'verdan_saffron_mire'],
    ['verdan_verdigris_span', 'verdan_chlorophage_span'],
    ['verdan_saffron_mire', 'verdan_chlorophage_span'],
    ['verdan_saffron_mire', 'verdan_glowmire_shelf'],
    ['verdan_chlorophage_span', 'verdan_glowmire_shelf'],
    ['verdan_chlorophage_span', 'verdan_lumen_bog'],
    ['verdan_glowmire_shelf', 'verdan_greenfire_vault'],
    ['verdan_glowmire_shelf', 'verdan_lumen_bog'],
    ['verdan_greenfire_vault', 'verdan_lumen_bog'],
    // Duskrim and the Storm Belts
    ['verdan_photic_crown', 'verdan_thundercrown_belt'],
    ['verdan_photic_crown', 'verdan_witchlight_fen'],
    ['verdan_thundercrown_belt', 'verdan_witchlight_fen'],
    ['verdan_thundercrown_belt', 'verdan_mistveil_hollow'],
    ['verdan_witchlight_fen', 'verdan_mistveil_hollow'],
    ['verdan_witchlight_fen', 'verdan_cinder_bloom'],
    ['verdan_mistveil_hollow', 'verdan_cinder_bloom'],
    ['verdan_mistveil_hollow', 'verdan_sulphur_drift'],
    ['verdan_cinder_bloom', 'verdan_sulphur_drift'],
  ],
  seaLinks: [
    ['verdan_spore_reach', 'verdan_photic_crown'], // north storm strait
    ['verdan_glowmire_shelf', 'verdan_cinder_bloom'], // south storm strait
    ['verdan_saffron_mire', 'verdan_mycel_deep'], // the chord through the Eye
    ['verdan_mycel_deep', 'verdan_emberleaf_basin'],
    ['verdan_emberleaf_basin', 'verdan_pollen_sea'],
    ['verdan_pollen_sea', 'verdan_witchlight_fen'],
  ],
  maxSeaGap: 14,
  minTileArea: 0.6,
};

/**
 * The Rust Belt — the Sundered Plate.
 *
 * One red supercontinent, torn almost in two by the Marineris Rift, a scar of
 * molten slag. The Tharsis plate to the west carries the volcano foundries;
 * the Hesperia–Hellas plate to the east carries the deep mines. Three places
 * cross the rift: the Noctis isthmus (Bessemer Cut), the Tether Anchorage
 * island where the elevator comes down, and the southern narrows. North lies
 * the slag sea with two island platforms; the far side is the Oxide Ocean.
 *
 * A fortress world: Verdan's lanes come down on the west plate, Nexus's on the
 * east, so crossing Rust means taking a crossing, and the Anchor Works (the
 * isthmus and the anchorage, two tiles worth 3) is the prize.
 */
const RUST: SkeletonWorldSpec = {
  kind: 'skeleton',
  world_id: 'rust',
  seed: 7711,
  land: {
    add: [
      { kind: 'ellipse', center: [-138, -8], a: 40, b: 34, heading: 10 }, // Tharsis, the west plate
      { kind: 'ellipse', center: [-120, 14], a: 26, b: 22, heading: 60 }, // the Tharsis bulge
      { kind: 'ellipse', center: [-72, -22], a: 30, b: 26, heading: 90 }, // Margaritifer, the rift country
      { kind: 'ellipse', center: [-10, -18], a: 42, b: 34, heading: 90 }, // Arabia–Hellas, the east plate
      { kind: 'ellipse', center: [48, -6], a: 30, b: 26, heading: 20 }, // the Syrtis shoulder
      { kind: 'ellipse', center: [-45, 10], a: 24, b: 14, heading: 80 }, // the Chryse shelf
      { kind: 'ellipse', center: [-90, 6], a: 20, b: 16, heading: 60 }, // the Noctis highlands
      { kind: 'capsule', points: [[-165, -48], [-110, -56], [-50, -56], [10, -54], [55, -42]], radius: 14 }, // southern highlands
      { kind: 'cap', center: [-22, 44], radius: 11 }, // Acidalia platform
      { kind: 'ellipse', center: [22, 36], a: 14, b: 9, heading: 80 }, // Utopia platform
    ],
    cut: [
      { kind: 'capsule', points: RUST_RIFT_NORTH, radius: 4 },
      { kind: 'capsule', points: RUST_RIFT_SOUTH, radius: 0, radii: [4, 7, 15.5, 6.5, 4.5, 5] },
      { kind: 'capsule', points: [[100, 34], [132, 4], [156, -34]], radius: 19 }, // the Oxide Ocean
      { kind: 'capsule', points: [[180, 70], [180, -70]], radius: 3 }, // keep the antimeridian at sea
    ],
    // The anchorage island in the rift lake, larger than the prototype's so it
    // stays a comfortable tap target on a phone.
    restore: [{ kind: 'cap', center: [-57, -16], radius: 9 }],
  },
  noise: { amp: 5.5, freq: 3 },
  warp: { amp: 0.07, freq: 2.2 },
  border: { freq: 4, noise: 1.6 },
  regions: [
    { region_id: 'rust_slag_wastes', name: 'Rust — Slag Wastes', bonus: 1 },
    { region_id: 'rust_foundry_core', name: 'Rust — Tharsis Foundries', bonus: 2 },
    { region_id: 'rust_ironstorm', name: 'Rust — Argyre Marches', bonus: 2 },
    { region_id: 'rust_anchor_works', name: 'Rust — Anchor Works', bonus: 3 },
    { region_id: 'rust_hellas_deeps', name: 'Rust — Hellas Deeps', bonus: 2 },
    { region_id: 'rust_hesperia', name: 'Rust — Hesperia', bonus: 2 },
  ],
  territories: [
    // West plate, Tharsis: the Verdan front.
    { id: 'rust_caldera_foundry', name: 'Caldera Foundry', region_id: 'rust_foundry_core', at: [-150, 14] }, // Olympus
    { id: 'rust_crucible_deep', name: 'Crucible Deep', region_id: 'rust_foundry_core', at: [-128, -6] }, // Pavonis
    { id: 'rust_smelter_crown', name: 'Smelter Crown', region_id: 'rust_foundry_core', at: [-118, 20] }, // Ascraeus
    { id: 'rust_furnace_marches', name: 'Furnace Marches', region_id: 'rust_ironstorm', at: [-160, -24] },
    { id: 'rust_oxide_flats', name: 'Oxide Flats', region_id: 'rust_ironstorm', at: [-100, -22] },
    { id: 'rust_anvil_basin', name: 'Anvil Basin', region_id: 'rust_ironstorm', at: [-128, -48] }, // Argyre
    // The crossings.
    { id: 'rust_bessemer_cut', name: 'Bessemer Cut', region_id: 'rust_anchor_works', at: [-93, 8], weight: 0.55 }, // Noctis
    { id: 'rust_tether_anchorage', name: 'Tether Anchorage', region_id: 'rust_anchor_works', at: [-57, -16] }, // the elevator
    // East plate, Hesperia–Hellas: the Nexus front.
    { id: 'rust_cinderworks', name: 'Cinderworks', region_id: 'rust_hellas_deeps', at: [-26, -22] },
    { id: 'rust_ironstorm_belt', name: 'Ironstorm Belt', region_id: 'rust_hellas_deeps', at: [-20, -52] },
    { id: 'rust_dross_hollow', name: 'Dross Hollow', region_id: 'rust_hellas_deeps', at: [26, -40] }, // Hellas
    { id: 'rust_scoria_flats', name: 'Scoria Flats', region_id: 'rust_hesperia', at: [-50, 16] }, // Chryse
    { id: 'rust_hematite_span', name: 'Hematite Span', region_id: 'rust_hesperia', at: [2, 8] }, // Arabia
    { id: 'rust_ferro_span', name: 'Ferro Span', region_id: 'rust_hesperia', at: [52, -6] }, // Syrtis
    // Borealis slag-sea platforms.
    { id: 'rust_slag_reach', name: 'Slag Reach', region_id: 'rust_slag_wastes', at: [-22, 44], weight: 0.8 }, // Acidalia
    { id: 'rust_tailing_drift', name: 'Tailing Drift', region_id: 'rust_slag_wastes', at: [22, 36], weight: 0.8 }, // Utopia
  ],
  landBorders: [
    // West plate
    ['rust_caldera_foundry', 'rust_crucible_deep'],
    ['rust_caldera_foundry', 'rust_furnace_marches'],
    ['rust_caldera_foundry', 'rust_smelter_crown'],
    ['rust_crucible_deep', 'rust_anvil_basin'],
    ['rust_crucible_deep', 'rust_furnace_marches'],
    ['rust_crucible_deep', 'rust_oxide_flats'],
    ['rust_crucible_deep', 'rust_smelter_crown'],
    ['rust_furnace_marches', 'rust_anvil_basin'],
    ['rust_oxide_flats', 'rust_anvil_basin'],
    // The Noctis isthmus: the only land crossing of the rift
    ['rust_crucible_deep', 'rust_bessemer_cut'],
    ['rust_oxide_flats', 'rust_bessemer_cut'],
    ['rust_smelter_crown', 'rust_bessemer_cut'],
    ['rust_bessemer_cut', 'rust_scoria_flats'],
    // East plate
    ['rust_cinderworks', 'rust_dross_hollow'],
    ['rust_cinderworks', 'rust_hematite_span'],
    ['rust_cinderworks', 'rust_ironstorm_belt'],
    ['rust_cinderworks', 'rust_scoria_flats'],
    ['rust_dross_hollow', 'rust_ferro_span'],
    ['rust_dross_hollow', 'rust_hematite_span'],
    ['rust_hematite_span', 'rust_ferro_span'],
    ['rust_ironstorm_belt', 'rust_dross_hollow'],
    ['rust_scoria_flats', 'rust_hematite_span'],
  ],
  seaLinks: [
    ['rust_tether_anchorage', 'rust_oxide_flats'], // anchorage ferry, west bank
    ['rust_tether_anchorage', 'rust_cinderworks'], // anchorage ferry, east bank
    ['rust_anvil_basin', 'rust_ironstorm_belt'], // the southern narrows
    ['rust_slag_reach', 'rust_scoria_flats'], // the Borealis chain
    ['rust_slag_reach', 'rust_tailing_drift'],
    ['rust_tailing_drift', 'rust_hematite_span'],
    ['rust_tailing_drift', 'rust_ferro_span'],
  ],
  maxSeaGap: 14,
  minTileArea: 0.6,
};

/**
 * Nexus Station — the Shattered Shell.
 *
 * A built world, a hollow shell the size of Sol's moon, broken when the Gate
 * woke. The Gate crater sits at the centre of the near side, ringed by the four
 * segments of the Gate Ring (the Vault). Around it the shell has cracked into
 * three spokes of angular shards, joined by bridges over glowing void, and the
 * outer shards form a broken crown; the far hemisphere is gone, a breach into
 * the Pathfinder lattice.
 *
 * A hub world: every inner shard bridges into the Gate Ring, and every lane
 * lands on the outer crown, so the Vault has to be fought for from inside.
 * Bridges are `sea` links: they draw as crossings and fight like land (galaxy
 * games run with naval rules off).
 *
 * Laid out in the Gate's own frame (bearing, distance). The prototype's crown
 * reached 104° from the Gate, and a cap that wide always contains a pole; here
 * the crown sits 58–74° out, so with the Gate on the equator the shell clears
 * both poles. Every shard keeps its bearing and its neighbours, so the graph is
 * the one measured.
 */
/** A shard of shell between two bearings and two distances from the Gate. */
const shard = (az0: number, az1: number, d0: number, d1: number): SkeletonShape => ({
  kind: 'polygon',
  points: [nr(az0, d0), nr(az1, d0), nr(az1, d1), nr(az0, d1)],
});
const nr = (azimuth: number, dist: number): LngLat => polar(NEXUS_GATE, azimuth, dist);
const fracture = (azimuth: number): SkeletonShape => ({ kind: 'capsule', points: [nr(azimuth, 6), nr(azimuth, 26)], radius: 2.2 });

const NEXUS: SkeletonWorldSpec = {
  kind: 'skeleton',
  world_id: 'nexus_station',
  seed: 9021,
  land: {
    add: [
      { kind: 'band', center: NEXUS_GATE, mid: 15.5, half: 7 }, // the Gate Ring
      // Inner shards, 28–52° out: Spire Walk (north), Berth Ring (south-east,
      // one slab split between Halo Span and Toll Crater), Vault Ward (south-west).
      shard(320, 354, 28, 52), shard(2, 38, 28, 52),
      { kind: 'polygon', points: [nr(88, 28), nr(158, 31), nr(158, 52), nr(88, 52)] }, // tilted away from the ring at Toll Crater
      shard(200, 236, 28, 52), shard(244, 282, 28, 52),
      // Halo Span's land bridge onto the Gate Ring.
      { kind: 'capsule', points: [nr(102, 20), nr(102, 30)], radius: 2.5 },
      // The broken crown, 58–74° out: six outer shards, each a short bridge
      // from the next.
      shard(306, 350, 58, 74), shard(2, 62, 58, 74),
      shard(70, 122, 58, 74), shard(126, 178, 58, 74),
      shard(188, 240, 58, 74), shard(246, 300, 58, 74),
    ],
    cut: [
      fracture(0), fracture(90), fracture(180), fracture(270), // the Gate Ring's four segments
      { kind: 'cap', center: NEXUS_GATE, radius: 7.5 }, // the Gate crater
    ],
  },
  noise: { amp: 1.2, freq: 7 },
  warp: { amp: 0.01, freq: 2.2 },
  border: { freq: 3, noise: 1.6 },
  regions: [
    { region_id: 'nexus_gate_ring', name: 'Nexus — Gate Ring', bonus: 3 },
    { region_id: 'nexus_vault_ward', name: 'Nexus — Vault Ward', bonus: 3 },
    { region_id: 'nexus_spire_walk', name: 'Nexus — Spire Walk', bonus: 3 },
    { region_id: 'nexus_berth_ring', name: 'Nexus — Berth Ring', bonus: 3 },
  ],
  territories: [
    // The Gate Ring — the Vault.
    { id: 'nexus_harmonic_rim', name: 'Harmonic Rim', region_id: 'nexus_gate_ring', at: nr(45, 15) },
    { id: 'nexus_gate_threshold', name: 'Gate Threshold', region_id: 'nexus_gate_ring', at: nr(150, 15) },
    { id: 'nexus_echo_concourse', name: 'Echo Concourse', region_id: 'nexus_gate_ring', at: nr(225, 15) },
    { id: 'nexus_basin_mandate', name: 'Basin Mandate', region_id: 'nexus_gate_ring', at: nr(315, 15) },
    // Spire Walk.
    { id: 'nexus_cordon_march', name: 'Cordon March', region_id: 'nexus_spire_walk', at: nr(342, 40) },
    { id: 'nexus_quietude_basin', name: 'Quietude Basin', region_id: 'nexus_spire_walk', at: nr(18, 40) },
    { id: 'nexus_antenna_spire', name: 'Antenna Spire', region_id: 'nexus_spire_walk', at: nr(328, 66) },
    { id: 'nexus_lodgeway', name: 'Lodgeway', region_id: 'nexus_spire_walk', at: nr(26, 66) },
    // Berth Ring.
    { id: 'nexus_halo_span', name: 'Halo Span', region_id: 'nexus_berth_ring', at: nr(106, 40) },
    { id: 'nexus_toll_crater', name: 'Toll Crater', region_id: 'nexus_berth_ring', at: nr(142, 40) },
    { id: 'nexus_waystation_loni', name: 'Waystation Loni', region_id: 'nexus_berth_ring', at: nr(100, 66) },
    { id: 'nexus_lattice_berth', name: 'Lattice Berth', region_id: 'nexus_berth_ring', at: nr(146, 66) },
    // Vault Ward.
    { id: 'nexus_vault_approach', name: 'Vault Approach', region_id: 'nexus_vault_ward', at: nr(222, 40) },
    { id: 'nexus_beacon_hollow', name: 'Beacon Hollow', region_id: 'nexus_vault_ward', at: nr(262, 40) },
    { id: 'nexus_resonance_vault', name: 'Resonance Vault', region_id: 'nexus_vault_ward', at: nr(220, 66) },
    { id: 'nexus_custodian_quarter', name: 'Custodian Quarter', region_id: 'nexus_vault_ward', at: nr(268, 66) },
  ],
  landBorders: [
    ['nexus_gate_threshold', 'nexus_halo_span'], // Halo Span touches the ring directly
    ['nexus_halo_span', 'nexus_toll_crater'],
  ],
  seaLinks: [
    // The Gate Ring's four segments, bridged across their fractures.
    ['nexus_harmonic_rim', 'nexus_gate_threshold'],
    ['nexus_gate_threshold', 'nexus_echo_concourse'],
    ['nexus_echo_concourse', 'nexus_basin_mandate'],
    ['nexus_basin_mandate', 'nexus_harmonic_rim'],
    // Moat bridges: each inner shard reaches the ring.
    ['nexus_cordon_march', 'nexus_basin_mandate'],
    ['nexus_quietude_basin', 'nexus_harmonic_rim'],
    ['nexus_halo_span', 'nexus_harmonic_rim'],
    ['nexus_toll_crater', 'nexus_gate_threshold'],
    ['nexus_vault_approach', 'nexus_echo_concourse'],
    ['nexus_beacon_hollow', 'nexus_echo_concourse'],
    // Each spoke is a loop of four shards.
    ['nexus_cordon_march', 'nexus_quietude_basin'],
    ['nexus_antenna_spire', 'nexus_lodgeway'],
    ['nexus_cordon_march', 'nexus_antenna_spire'],
    ['nexus_quietude_basin', 'nexus_lodgeway'],
    ['nexus_waystation_loni', 'nexus_lattice_berth'],
    ['nexus_halo_span', 'nexus_waystation_loni'],
    ['nexus_toll_crater', 'nexus_lattice_berth'],
    ['nexus_vault_approach', 'nexus_beacon_hollow'],
    ['nexus_resonance_vault', 'nexus_custodian_quarter'],
    ['nexus_vault_approach', 'nexus_resonance_vault'],
    ['nexus_beacon_hollow', 'nexus_custodian_quarter'],
    // The broken crown: bridges between the spokes' outer shards.
    ['nexus_lattice_berth', 'nexus_resonance_vault'],
    ['nexus_custodian_quarter', 'nexus_antenna_spire'],
    ['nexus_lodgeway', 'nexus_waystation_loni'],
  ],
  maxSeaGap: 14,
  minTileArea: 0.6,
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
  { from: 'verdan_sulphur_drift', to: 'rust_furnace_marches' },
  { from: 'rust_ferro_span', to: 'nexus_antenna_spire' },
  { from: 'rust_slag_reach', to: 'nexus_waystation_loni' },
  { from: 'nexus_lodgeway', to: 'sol_amazonia' },
  { from: 'nexus_resonance_vault', to: 'sol_cathay' },
];

export const GALAXY_SPECS: GalaxySpecs = {
  sol: SOL,
  farWorlds: [VERDAN, RUST, NEXUS],
  lanes: LANES,
};
