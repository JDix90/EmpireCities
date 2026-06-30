/**
 * Board-transform TRIGGER (Phase 2b).
 *
 * Called at the global after-advance sites (a player or AI just advanced an era).
 * Mirrors the growth model's "first-to-reach" rule: when the global era floor
 * (the highest era any living player has reached) crosses past the era the board
 * currently reflects, the shared board recomposes onto the next era's map — one
 * step at a time up to the floor, composing the lineage transitions.
 *
 * No-op (returns null) unless `era_advancement_board_transform` is enabled and the
 * floor has actually moved, so it's safe to call after every advance. The caller
 * (gameSocket) re-resolves room.map, re-emits game:map, and fires the morph event
 * from the returned summaries.
 */
import type { GameMap, GameState } from '../../types';
import { globalEraFloor } from './territoryUnlock';
import { getSpineEraIdAtIndex } from './spines';
import { getEraTransition } from './eraLineage';
import { executeBoardTransform, type BoardTransformResult } from './boardTransform';

export interface BoardTransformOutcome {
  map: GameMap;
  summaries: BoardTransformResult[];
}

export async function transformBoardOnAdvance(
  state: GameState,
  currentMap: GameMap,
  resolveNextMap: (mapId: string) => Promise<GameMap | null>,
  rng: () => number,
): Promise<BoardTransformOutcome | null> {
  if (state.settings.era_advancement_board_transform !== true) return null;

  const targetEra = globalEraFloor(state);
  let boardEra = state.board_era_index ?? 0;
  if (targetEra <= boardEra) return null; // board already at/ahead of the floor

  let map = currentMap;
  const summaries: BoardTransformResult[] = [];
  // Step the board forward one era at a time so a multi-era jump still composes
  // each lineage transition (ancient→medieval→discovery…) in order.
  while (boardEra < targetEra) {
    const fromEraId = getSpineEraIdAtIndex(state, boardEra);
    const toEraId = getSpineEraIdAtIndex(state, boardEra + 1);
    if (toEraId === fromEraId) break; // clamped at the end of the spine

    const transition = getEraTransition(fromEraId);
    // Guard against any spine/lineage mismatch: only transform when the lineage's
    // own successor map matches the spine's next era.
    if (!transition || transition.to_map !== `era_${toEraId}`) break;

    const nextMap = await resolveNextMap(`era_${toEraId}`);
    if (!nextMap) break; // arriving map unavailable — leave the board untouched

    const inPlayTargets = new Set(nextMap.territories.map((t) => t.territory_id));
    summaries.push(executeBoardTransform(state, nextMap, boardEra + 1, transition, inPlayTargets, rng));
    map = nextMap;
    boardEra += 1;
  }

  return summaries.length > 0 ? { map, summaries } : null;
}
