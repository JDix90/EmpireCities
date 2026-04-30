import type { RtsMapTerrain } from '@erasofempire/rts-shared';

export function parseRtsTerrainFromMapDoc(rts: unknown, mapId: string): RtsMapTerrain {
  if (!rts || typeof rts !== 'object') {
    throw new Error('Map missing rts_terrain');
  }
  const t = rts as RtsMapTerrain;
  if (!t.territories || typeof t.territories !== 'object') {
    throw new Error('rts_terrain.territories required');
  }
  return { mapId: t.mapId ?? mapId, territories: t.territories };
}
