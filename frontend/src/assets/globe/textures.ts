/**
 * The globe's own textures, bundled rather than fetched from jsDelivr at run
 * time: a third-party request on every globe, and where the CDN was blocked
 * the globe rendered as a plain sphere. Vite hashes them into /assets, which
 * nginx caches for a year.
 *
 * - earth-blue-marble.jpg, earth-topology.png: three-globe@2.45.1's example
 *   images (NASA Blue Marble, public domain), byte-identical to the CDN copies.
 * - moon_1024.jpg: three.js r186 examples/textures/planets (MIT).
 */
import earthBlueMarble from './earth-blue-marble.jpg';
import earthTopology from './earth-topology.png';
import moon from './moon_1024.jpg';

export const EARTH_GLOBE_TEXTURE = earthBlueMarble;
export const EARTH_BUMP_TEXTURE = earthTopology;
export const MOON_GLOBE_TEXTURE = moon;
