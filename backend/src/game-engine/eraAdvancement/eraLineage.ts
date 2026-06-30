/**
 * Era→era territory LINEAGE loader.
 *
 * The full-transform feature recomposes the board when a game advances eras. The
 * geographic correspondence between a territory and its successors on the next
 * era's board is precomputed (offline, by real-geometry overlap) and committed to
 * `database/era-lineage.json`; see `frontend/scripts/computeEraLineage.ts`.
 *
 * Phase 1 ships the data + this read-only accessor. The transition engine
 * (Phase 2) consumes `getEraTransition` / `getPrimarySuccessor` to decide each
 * player's retained seed and to drive the morph animation.
 */
import { readFileSync } from 'fs';
import path from 'path';
import type { EraId } from '../../types';

export interface EraLineageEdge {
  /** Target territory_id on the next era's map. */
  to: string;
  /** Fraction of the SOURCE territory's area covered by this target (0 for manual edges). */
  overlap: number;
  /** Fraction of the TARGET territory's area covered by the source (0 for manual edges). */
  target_overlap: number;
  /** Marks the dominant successor (largest overlap). */
  primary?: true;
  /** Set when the edge came from the hand-authored overrides file. */
  manual?: true;
}

export interface EraTransition {
  from_map: string;
  to_map: string;
  /** source territory_id → successor edges (sorted by overlap desc). */
  lineage: Record<string, EraLineageEdge[]>;
  /** source territories whose footprint isn't covered by any target (leave play). */
  no_successor: string[];
  /** target territories with no source parent — spawn as fresh neutral frontiers. */
  new_land: string[];
}

export interface EraLineageData {
  version: number;
  method: string;
  overlap_threshold: number;
  parent_threshold: number;
  sequence: EraId[];
  /** keyed `${fromEraId}->${toEraId}` along the canonical sequence. */
  transitions: Record<string, EraTransition>;
}

// database/era-lineage.json — runtime layout mirrors src (backend/dist/game-engine/eraAdvancement → repo/database).
const LINEAGE_PATH = path.resolve(__dirname, '../../../../database/era-lineage.json');

let cache: EraLineageData | null = null;

export function loadEraLineage(): EraLineageData {
  if (!cache) cache = JSON.parse(readFileSync(LINEAGE_PATH, 'utf8')) as EraLineageData;
  return cache;
}

/** Test-only: drop the memoized data so a test can reload after editing the file. */
export function __resetEraLineageCache(): void {
  cache = null;
}

/** The transition that fires when a game advances OUT of `fromEraId` (null at the end of the line). */
export function getEraTransition(fromEraId: EraId): EraTransition | null {
  const data = loadEraLineage();
  const i = data.sequence.indexOf(fromEraId);
  if (i < 0 || i >= data.sequence.length - 1) return null;
  return data.transitions[`${fromEraId}->${data.sequence[i + 1]}`] ?? null;
}

/**
 * The dominant successor of `territoryId` on the next era's board — used to pick
 * the seed territory a player retains through the recomposition. Null when the
 * territory has no successor (its land leaves play).
 */
export function getPrimarySuccessor(transition: EraTransition, territoryId: string): string | null {
  const edges = transition.lineage[territoryId];
  if (!edges || edges.length === 0) return null;
  return (edges.find((e) => e.primary) ?? edges[0]).to;
}
