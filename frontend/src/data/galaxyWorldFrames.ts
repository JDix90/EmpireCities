/**
 * Galactic Age world frames: the one fixed point each designed world is laid
 * out around. The world generator (`scripts/galaxy/worldSpecs.ts`) places land
 * relative to it and the globe painter (`utils/proceduralPlanet.ts`) paints the
 * sea relative to it, so the two can never disagree about where day is.
 */

/** Verdan Reach is tidally locked: the Eye sits at the substellar point, [lng, lat]. */
export const VERDAN_SUBSTELLAR: [number, number] = [0, 50];
