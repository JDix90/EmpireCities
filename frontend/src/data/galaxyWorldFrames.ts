/**
 * Galactic Age world frames: the one fixed point each designed world is laid
 * out around. The world generator (`scripts/galaxy/worldSpecs.ts`) places land
 * relative to it and the globe painter (`utils/proceduralPlanet.ts`) paints the
 * sea relative to it, so the two can never disagree about where day is.
 */

/** Verdan Reach is tidally locked: the Eye sits at the substellar point, [lng, lat]. */
export const VERDAN_SUBSTELLAR: [number, number] = [0, 50];

/**
 * The Rust Belt's Marineris Rift, as two great-circle polylines of [lng, lat]:
 * the northern arm down to the Noctis isthmus, and the southern arm from the
 * isthmus through the rift lake round the Tether Anchorage to the south polar
 * sea. The generator cuts the rift out of the land; the painter makes it glow.
 */
export const RUST_RIFT_NORTH: Array<[number, number]> = [[-122, 44], [-108, 22], [-99, 11]];
export const RUST_RIFT_SOUTH: Array<[number, number]> = [[-89, 2], [-72, -8], [-58, -16], [-47, -30], [-45, -48], [-54, -72]];

/**
 * Nexus Station's Gate crater, [lng, lat]: the Vault's Gate Ring circles it and
 * the shell's shards radiate from it. It sits on the equator so the shell,
 * which reaches ~75° from the Gate, clears both poles.
 */
export const NEXUS_GATE: [number, number] = [8, 0];
