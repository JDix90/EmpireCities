/**
 * How each designed world looks as a disc on the galaxy chart: a radial
 * gradient in the world's own palette plus one signature mark, so a node reads
 * as that planet rather than as a hashed colour. The palettes match the globe
 * painters in `utils/proceduralPlanet.ts`. Worlds not listed here (a custom
 * galaxy map) get `null` and keep the chart's hashed body colour.
 */

export type WorldChartMark = 'twilight_ring' | 'rift' | 'gate' | 'continents' | 'craters';

export interface WorldChartArt {
  /** Radial gradient stops from the lit centre outward: [offset 0..1, colour]. */
  stops: Array<[number, string]>;
  mark: WorldChartMark;
  /** Colour of the signature mark. */
  markColor: string;
}

const ART: Record<string, WorldChartArt> = {
  sol: {
    stops: [[0, '#5fa0c8'], [0.55, '#2f6fae'], [1, '#0c2549']],
    mark: 'continents',
    markColor: '#3f7a47',
  },
  earth: {
    stops: [[0, '#5fa0c8'], [0.55, '#2f6fae'], [1, '#0c2549']],
    mark: 'continents',
    markColor: '#3f7a47',
  },
  moon: {
    stops: [[0, '#b9bcc4'], [0.6, '#7d818c'], [1, '#3a3d45']],
    mark: 'craters',
    markColor: '#5a5d66',
  },
  // Tidally locked: the Brilliance at the centre, night ice at the rim, the
  // canopy ring in the twilight between.
  verdan: {
    stops: [[0, '#fff4d2'], [0.38, '#f7dc85'], [0.62, '#1a5c56'], [1, '#101a33']],
    mark: 'twilight_ring',
    markColor: '#3f9a5c',
  },
  rust: {
    stops: [[0, '#c8773d'], [0.6, '#7a3417'], [1, '#381910']],
    mark: 'rift',
    markColor: '#ff6b1a',
  },
  nexus_station: {
    stops: [[0, '#8d92b3'], [0.55, '#3a3f5c'], [1, '#07071a']],
    mark: 'gate',
    markColor: '#c9a3ff',
  },
};

export function worldChartArt(worldId: string): WorldChartArt | null {
  return ART[worldId] ?? null;
}
