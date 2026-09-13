/**
 * Client for the admin-guarded Warfront endpoints.
 *
 * Both routes require an admin server-side (`preHandler: [authenticate, requireAdmin]`),
 * and the terrain route additionally 404s while `warfront_enabled` is off. The terrain
 * asset is deliberately NOT served from `frontend/public/`, which every anonymous
 * visitor can read — see the isolation rule in CLAUDE.md.
 */

import { TerrainGrid, type TerrainAsset } from '@borderfall/warfront-sim';
import { api } from './api';

export interface WarfrontTerrainSummary {
  id: string;
  map_id: string;
  generator: string;
  cell_km: number;
  width: number;
  height: number;
  cells: number;
  provinces: number;
  lanes: number;
  checksum: string;
}

export interface WarfrontStatus {
  enabled: boolean;
  flag: string;
  terrain: WarfrontTerrainSummary | null;
  terrain_error: string | null;
}

export async function fetchWarfrontStatus(): Promise<WarfrontStatus> {
  const res = await api.get<WarfrontStatus>('/admin/warfront/status');
  return res.data;
}

/**
 * Fetches and decodes the committed terrain asset. `TerrainGrid.decode` re-verifies the
 * asset's checksum, so a truncated or edited file fails here rather than producing a
 * map that silently disagrees with the one a replay was recorded against.
 */
export async function fetchWarfrontTerrain(): Promise<TerrainGrid> {
  const res = await api.get<TerrainAsset>('/admin/warfront/terrain');
  return TerrainGrid.decode(res.data);
}
