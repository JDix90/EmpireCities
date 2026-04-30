import type { RtsMapTerrain, RtsTerritoryTerrain } from './types.js';

export type RtsNodeKey = `${string}::${string}`;

export function nodeKey(territoryId: string, nodeId: string): RtsNodeKey {
  return `${territoryId}::${nodeId}` as RtsNodeKey;
}

export function parseNodeKey(key: RtsNodeKey): { territoryId: string; nodeId: string } {
  const i = key.indexOf('::');
  return { territoryId: key.slice(0, i), nodeId: key.slice(i + 2) };
}

/**
 * All valid one-step node keys from (territoryId, nodeId).
 * Includes internal graph edges and bidirectional cross-border frontiers.
 */
export function getNeighborKeys(
  map: RtsMapTerrain,
  territoryId: string,
  nodeId: string,
  territoryTerrain: RtsTerritoryTerrain,
): RtsNodeKey[] {
  const out: RtsNodeKey[] = [];
  for (const e of territoryTerrain.edges) {
    if (e.from === nodeId) out.push(nodeKey(territoryId, e.to));
    if (e.to === nodeId) out.push(nodeKey(territoryId, e.from));
  }
  for (const [nb, pairs] of Object.entries(territoryTerrain.frontiers)) {
    for (const p of pairs) {
      if (p.thisNode === nodeId) out.push(nodeKey(nb, p.neighborNode));
    }
  }
  for (const [otherTid, tdata] of Object.entries(map.territories)) {
    if (otherTid === territoryId) continue;
    const back = tdata.frontiers[territoryId];
    if (!back) continue;
    for (const p of back) {
      if (p.thisNode === nodeId) out.push(nodeKey(otherTid, p.neighborNode));
    }
  }
  return [...new Set(out)];
}

export function isNeighbor(
  map: RtsMapTerrain,
  territoryId: string,
  nodeId: string,
  toTerritoryId: string,
  toNodeId: string,
  territoryTerrain: RtsTerritoryTerrain,
): boolean {
  const k2 = nodeKey(toTerritoryId, toNodeId);
  return getNeighborKeys(map, territoryId, nodeId, territoryTerrain).some((k) => k === k2);
}
