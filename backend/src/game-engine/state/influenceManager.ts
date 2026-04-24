import type { GameMap } from '../../types';
import type { TechNode } from '../eras/types';

export function getInfluenceHopLimit(params: {
  baseHopLimit: number;
  unlockedTechs: string[];
  techTree: TechNode[];
  wonderRangeBonus: number;
}): number {
  const { baseHopLimit, unlockedTechs, techTree, wonderRangeBonus } = params;
  const hasRangeTech = techTree.some(
    (node) =>
      unlockedTechs.includes(node.tech_id) &&
      (node.unlocks_ability === 'propaganda_extended' || node.unlocks_ability === 'expanded_network'),
  );
  return baseHopLimit + (hasRangeTech ? 1 : 0) + wonderRangeBonus;
}

export function isTerritoryReachableWithinHops(params: {
  map: GameMap;
  ownedTerritoryIds: string[];
  targetId: string;
  hopLimit: number;
}): boolean {
  const { map, ownedTerritoryIds, targetId, hopLimit } = params;
  if (hopLimit <= 0 || ownedTerritoryIds.length === 0) return false;
  if (ownedTerritoryIds.includes(targetId)) return true;

  const adjacency = buildAdjacency(map);
  const visited = new Set<string>(ownedTerritoryIds);
  let frontier = [...ownedTerritoryIds];

  for (let hop = 0; hop < hopLimit; hop++) {
    const next: string[] = [];
    for (const tid of frontier) {
      for (const nid of adjacency[tid] ?? []) {
        if (visited.has(nid)) continue;
        visited.add(nid);
        if (nid === targetId) return true;
        next.push(nid);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return false;
}

export function getAdjacentTerritoryIds(map: GameMap, territoryId: string): string[] {
  const adjacency = buildAdjacency(map);
  return adjacency[territoryId] ?? [];
}

function buildAdjacency(map: GameMap): Record<string, string[]> {
  const adjacency: Record<string, string[]> = {};
  for (const conn of map.connections) {
    if (!adjacency[conn.from]) adjacency[conn.from] = [];
    if (!adjacency[conn.to]) adjacency[conn.to] = [];
    adjacency[conn.from].push(conn.to);
    adjacency[conn.to].push(conn.from);
  }
  return adjacency;
}
