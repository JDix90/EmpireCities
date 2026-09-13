import { readFile } from 'fs/promises';
import path from 'path';
import { featureFlags } from '../../config/featureFlags';

/**
 * Warfront admin surface, step 1 of Slice A (docs/WARFRONT_RTS_MODE.md).
 *
 * Everything Warfront is admin-only until further notice, enforced server-side by
 * `preHandler: [authenticate, requireAdmin]` on every route in admin.routes.ts — the
 * client hiding a tab is never the gate. On top of that the `warfront_enabled` flag
 * (OFF by default, `WARFRONT_ENABLED=true` or the Admin → Config override) gates the
 * functional endpoints: `/warfront/status` always answers an admin so the tab can say
 * "flag is off, flip it in Config"; `/warfront/terrain` is 404 until the flag is on.
 *
 * The terrain asset is read from database/warfront/ (the same directory convention the
 * map documents use) — deliberately NOT from frontend/public/, which is served to every
 * anonymous visitor. See packages/warfront-sim/README.md for the decision.
 */

export const WARFRONT_TERRAIN_ID = 'western_twenty';

/** Header fields of the committed asset; the rows themselves are omitted. */
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
  flag: 'warfront_enabled';
  terrain: WarfrontTerrainSummary | null;
  /** Set when the asset is missing or unreadable — the tab shows it instead of a summary. */
  terrain_error: string | null;
}

interface TerrainAssetHeader {
  format?: string;
  version?: number;
  map_id?: string;
  generator?: string;
  cell_km?: number;
  width?: number;
  height?: number;
  provinces?: unknown[];
  lanes?: unknown[];
  checksum?: string;
}

/** Resolves like the map loaders do: relative to this module, up to the repo's database/ directory. */
export function warfrontTerrainPath(id: string = WARFRONT_TERRAIN_ID): string {
  return path.resolve(__dirname, '../../../../database/warfront', `${id}.terrain.json`);
}

let cached: { text: string; parsed: TerrainAssetHeader } | null = null;

/** Raw asset text (what /warfront/terrain serves) plus its parsed header, read once per process. */
export async function loadWarfrontTerrain(): Promise<{ text: string; header: TerrainAssetHeader }> {
  if (!cached) {
    const text = await readFile(warfrontTerrainPath(), 'utf8');
    const parsed = JSON.parse(text) as TerrainAssetHeader;
    if (parsed.format !== 'warfront-terrain' || parsed.version !== 1) {
      throw new Error('database/warfront asset is not a warfront-terrain v1 file');
    }
    cached = { text, parsed };
  }
  return { text: cached.text, header: cached.parsed };
}

/** Drops the process cache (tests, and a future admin "reload asset" action). */
export function resetWarfrontTerrainCacheForTests(): void {
  cached = null;
}

export function summarizeWarfrontTerrain(header: TerrainAssetHeader): WarfrontTerrainSummary {
  const width = Number(header.width ?? 0);
  const height = Number(header.height ?? 0);
  return {
    id: WARFRONT_TERRAIN_ID,
    map_id: String(header.map_id ?? ''),
    generator: String(header.generator ?? ''),
    cell_km: Number(header.cell_km ?? 0),
    width,
    height,
    cells: width * height,
    provinces: Array.isArray(header.provinces) ? header.provinces.length : 0,
    lanes: Array.isArray(header.lanes) ? header.lanes.length : 0,
    checksum: String(header.checksum ?? ''),
  };
}

export async function buildWarfrontStatus(): Promise<WarfrontStatus> {
  const enabled = featureFlags.warfrontEnabled;
  try {
    const { header } = await loadWarfrontTerrain();
    return { enabled, flag: 'warfront_enabled', terrain: summarizeWarfrontTerrain(header), terrain_error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { enabled, flag: 'warfront_enabled', terrain: null, terrain_error: message };
  }
}
